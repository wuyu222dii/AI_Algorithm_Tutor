import {
  calculateCanonicalDataHash,
  calculateCatalogContentFingerprint,
  sha256,
} from './content-hash';
import type {
  CatalogJsonValue,
  ExercismSnapshot,
  ExercismUpstreamProblem,
  RawCatalogProblem,
} from './raw-types';

const REPOSITORY = 'exercism/problem-specifications' as const;
const COMMIT_URL = `https://api.github.com/repos/${REPOSITORY}/commits/main`;
const LICENSE_URL = `https://api.github.com/repos/${REPOSITORY}/license`;
const RAW_ROOT = `https://raw.githubusercontent.com/${REPOSITORY}`;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface ExercismFetchResult {
  notModified: boolean;
  revision?: string;
  etag?: string;
  localContentFingerprint: string;
  snapshot?: ExercismSnapshot;
}

export interface ExercismAdapterOptions {
  fetch?: typeof fetch;
  token?: string;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`Exercism returned invalid JSON (${response.status}).`);
  }
}

export class ExercismCatalogAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: ExercismAdapterOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.token = options.token;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
  }

  private headers(etag?: string): HeadersInit {
    return {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AlgoCoach-Catalog-Sync/1.0',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(etag ? { 'If-None-Match': etag } : {}),
    };
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetchImpl(url, init);
      lastResponse = response;
      if (!RETRYABLE_STATUS.has(response.status) || attempt === 2) {
        return response;
      }
      const retryAfter = response.headers.get('retry-after');
      const retryAfterSeconds =
        retryAfter === null ? Number.NaN : Number(retryAfter);
      const waitMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? Math.min(retryAfterSeconds * 1000, 5_000)
          : 250 * 2 ** attempt;
      await this.sleep(waitMs);
    }
    return lastResponse!;
  }

  async fetchSnapshot(
    problems: RawCatalogProblem[],
    previous?: {
      etag?: string;
      revision?: string;
      localContentFingerprint?: string;
    }
  ): Promise<ExercismFetchResult> {
    const localContentFingerprint =
      calculateCatalogContentFingerprint(problems);
    const commitResponse = await this.request(COMMIT_URL, {
      headers: this.headers(previous?.etag),
    });

    let revision: string;
    let etag: string;
    if (commitResponse.status === 304) {
      if (!previous?.revision) {
        throw new Error(
          'Exercism returned 304 without a previously resolved revision.'
        );
      }
      revision = previous.revision;
      etag = previous.etag ?? `\"${revision}\"`;
      if (previous.localContentFingerprint === localContentFingerprint) {
        return {
          notModified: true,
          revision,
          etag,
          localContentFingerprint,
        };
      }
    } else {
      if (!commitResponse.ok) {
        throw new Error(
          `Unable to resolve the Exercism revision (${commitResponse.status}).`
        );
      }
      const commit = (await readJson(commitResponse)) as { sha?: unknown };
      if (
        typeof commit.sha !== 'string' ||
        !/^[a-f0-9]{40}$/.test(commit.sha)
      ) {
        throw new Error('Exercism commit response did not include a full SHA.');
      }
      revision = commit.sha;
      etag = commitResponse.headers.get('etag') ?? `\"${revision}\"`;
      if (
        revision === previous?.revision &&
        previous.localContentFingerprint === localContentFingerprint
      ) {
        return {
          notModified: true,
          revision,
          etag,
          localContentFingerprint,
        };
      }
    }

    const licenseResponse = await this.request(
      `${LICENSE_URL}?ref=${revision}`,
      {
        headers: this.headers(),
      }
    );
    if (!licenseResponse.ok) {
      throw new Error(
        `Unable to verify the Exercism license (${licenseResponse.status}).`
      );
    }
    const license = (await readJson(licenseResponse)) as {
      license?: { spdx_id?: unknown };
    };
    if (license.license?.spdx_id !== 'MIT') {
      throw new Error('Exercism source is not covered by the MIT allowlist.');
    }

    const upstreamProblems: ExercismUpstreamProblem[] = [];
    for (const problem of problems) {
      const statementResponse = await this.request(
        `${RAW_ROOT}/${revision}/${problem.origin.statementPath}`,
        { headers: this.headers() }
      );
      if (!statementResponse.ok) {
        throw new Error(
          `Unable to fetch ${problem.origin.statementPath} (${statementResponse.status}).`
        );
      }
      const statementMarkdown = await statementResponse.text();
      const canonicalPath = `exercises/${problem.origin.externalId}/canonical-data.json`;
      const canonicalResponse = await this.request(
        `${RAW_ROOT}/${revision}/${canonicalPath}`,
        { headers: this.headers() }
      );
      let canonicalData: CatalogJsonValue = null;
      let canonicalDataStatus: ExercismUpstreamProblem['canonicalDataStatus'];
      if (canonicalResponse.status === 404) {
        canonicalDataStatus = 'missing';
      } else if (!canonicalResponse.ok) {
        throw new Error(
          `Unable to fetch ${canonicalPath} (${canonicalResponse.status}).`
        );
      } else {
        try {
          canonicalData = JSON.parse(
            await canonicalResponse.text()
          ) as CatalogJsonValue;
          canonicalDataStatus = 'available';
        } catch {
          canonicalDataStatus = 'parse_error';
        }
      }

      upstreamProblems.push({
        externalId: problem.origin.externalId,
        upstreamUrl: `https://github.com/${REPOSITORY}/tree/${revision}/exercises/${problem.origin.externalId}`,
        statementPath: problem.origin.statementPath,
        statementMarkdown,
        statementHash: sha256(statementMarkdown),
        canonicalData,
        canonicalDataHash: calculateCanonicalDataHash(canonicalData),
        canonicalDataStatus,
      });
    }

    return {
      notModified: false,
      revision,
      etag,
      localContentFingerprint,
      snapshot: {
        provider: 'exercism',
        repository: REPOSITORY,
        revision,
        etag,
        licenseSpdx: 'MIT',
        localContentFingerprint,
        fetchedAt: this.now().toISOString(),
        problems: upstreamProblems,
      },
    };
  }
}
