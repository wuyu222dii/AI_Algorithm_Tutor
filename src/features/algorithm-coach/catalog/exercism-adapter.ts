import { createHash } from 'node:crypto';

import {
  calculateCanonicalDataHash,
  calculateCatalogContentFingerprint,
  sha256,
} from './content-hash';
import type {
  CatalogJsonValue,
  ExercismDiscoveredExercise,
  ExercismDiscoverySnapshot,
  ExercismGitTreeEntry,
  ExercismLicenseEvidence,
  ExercismSnapshot,
  ExercismUpstreamProblem,
  RawCatalogProblem,
} from './raw-types';

const REPOSITORY = 'exercism/problem-specifications' as const;
const COMMIT_URL = `https://api.github.com/repos/${REPOSITORY}/commits/main`;
const LICENSE_URL = `https://api.github.com/repos/${REPOSITORY}/license`;
const TREE_ROOT = `https://api.github.com/repos/${REPOSITORY}/git/trees`;
const RAW_ROOT = `https://raw.githubusercontent.com/${REPOSITORY}`;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export const EXERCISM_REQUEST_TIMEOUT_MS = 10_000;
export const EXERCISM_MAX_STATEMENT_BYTES = 256 * 1024;
export const EXERCISM_MAX_CANONICAL_BYTES = 2 * 1024 * 1024;
export const EXERCISM_MAX_JSON_DEPTH = 32;
export const EXERCISM_MAX_LICENSE_BYTES = 64 * 1024;
const MAX_GITHUB_METADATA_BYTES = 64 * 1024;
const MAX_GITHUB_TREE_BYTES = 16 * 1024 * 1024;

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
  timeoutMs?: number;
}

export interface ExercismDiscoveryOptions {
  maxExercises?: number;
  knownExternalIds?: Iterable<string>;
  recordedEvidence?: Iterable<ExercismRecordedEvidence>;
}

export interface ExercismRecordedEvidence {
  externalId: string;
  sourceRevision: string;
  statementBlobSha?: string;
  canonicalBlobSha?: string;
  rawContentHash?: string;
  originOnly: boolean;
}

export interface ExercismDiscoveryPreviousState {
  etag?: string;
  revision?: string;
  backlogComplete: boolean;
}

export interface ExercismDiscoveryFetchOptions
  extends ExercismDiscoveryOptions {
  previous?: ExercismDiscoveryPreviousState;
}

export interface ExercismDiscoveryFetchResult {
  notModified: boolean;
  revision: string;
  etag: string;
  snapshot?: ExercismDiscoverySnapshot;
}

interface ResolvedRevision {
  revision: string;
  etag: string;
  conditionalNotModified: boolean;
}

interface GitTreeResponse {
  sha?: unknown;
  truncated?: unknown;
  tree?: unknown;
}

interface FixedTreeEvidence {
  entries: ExercismGitTreeEntry[];
  byPath: Map<string, ExercismGitTreeEntry>;
  license: ExercismLicenseEvidence;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function contentLength(response: Response): number | undefined {
  const value = response.headers.get('content-length');
  if (value === null || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
  label: string
): Promise<string> {
  const declaredLength = contentLength(response);
  if (declaredLength !== undefined && declaredLength > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes}-byte limit.`);
  }

  if (!response.body) {
    const value = await response.text();
    if (new TextEncoder().encode(value).byteLength > maximumBytes) {
      throw new Error(`${label} exceeds the ${maximumBytes}-byte limit.`);
    }
    return value;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`${label} exceeds the ${maximumBytes}-byte limit.`);
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  label: string
): Promise<unknown> {
  const source = await readBoundedText(response, maximumBytes, label);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`${label} returned invalid JSON (${response.status}).`);
  }
}

export function assertJsonDepth(
  value: CatalogJsonValue,
  maximumDepth = EXERCISM_MAX_JSON_DEPTH
): void {
  const pending: Array<{ value: CatalogJsonValue; depth: number }> = [
    { value, depth: 0 },
  ];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > maximumDepth) {
      throw new Error(`canonical-data.json exceeds depth ${maximumDepth}.`);
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
    } else if (current.value !== null && typeof current.value === 'object') {
      for (const item of Object.values(current.value)) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
    }
  }
}

function parseCanonicalData(source: string): {
  data: CatalogJsonValue;
  hash: string;
  status: ExercismUpstreamProblem['canonicalDataStatus'];
} {
  let data: CatalogJsonValue;
  try {
    data = JSON.parse(source) as CatalogJsonValue;
  } catch {
    return {
      data: null,
      hash: calculateCanonicalDataHash(null),
      status: 'parse_error',
    };
  }
  assertJsonDepth(data);
  return {
    data,
    hash: calculateCanonicalDataHash(data),
    status: 'available',
  };
}

export function calculateGitBlobSha(content: string): string {
  const bytes = new TextEncoder().encode(content);
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
}

export function isExercismLicenseEvidenceValid(input: {
  path: string;
  spdx: string;
  text: string;
  gitBlobSha: string;
  contentHash: string;
}): input is ExercismLicenseEvidence {
  return (
    input.path === 'LICENSE' &&
    input.spdx === 'MIT' &&
    new TextEncoder().encode(input.text).byteLength <=
      EXERCISM_MAX_LICENSE_BYTES &&
    /^(?:The )?MIT License(?: \(MIT\))?\r?$/m.test(input.text) &&
    input.text.includes('Permission is hereby granted, free of charge') &&
    calculateGitBlobSha(input.text) === input.gitBlobSha &&
    sha256(input.text) === input.contentHash
  );
}

function parseTreeEntries(value: unknown): ExercismGitTreeEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('Exercism Git tree did not include an entries array.');
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Exercism Git tree entry ${index} is malformed.`);
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.path !== 'string' ||
      typeof item.mode !== 'string' ||
      (item.type !== 'blob' && item.type !== 'tree') ||
      typeof item.sha !== 'string' ||
      !/^[a-f0-9]{40}$/.test(item.sha) ||
      (item.size !== undefined &&
        (!Number.isInteger(item.size) || Number(item.size) < 0))
    ) {
      throw new Error(`Exercism Git tree entry ${index} is malformed.`);
    }
    return {
      path: item.path,
      mode: item.mode,
      type: item.type,
      sha: item.sha,
      ...(typeof item.size === 'number' ? { size: item.size } : {}),
    };
  });
}

function boundedMaximumExercises(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error('Discovery maxExercises must be between 1 and 50.');
  }
  return value;
}

export class ExercismCatalogAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(options: ExercismAdapterOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.token = options.token;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? EXERCISM_REQUEST_TIMEOUT_MS;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > EXERCISM_REQUEST_TIMEOUT_MS
    ) {
      throw new Error(
        `Exercism timeout must be between 1 and ${EXERCISM_REQUEST_TIMEOUT_MS}ms.`
      );
    }
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
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const signal = init?.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal;
      let response: Response;
      try {
        response = await this.fetchImpl(url, { ...init, signal });
      } catch (error) {
        if (signal.aborted) {
          throw new Error(
            `Exercism request timed out after ${this.timeoutMs}ms.`
          );
        }
        throw error;
      }
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

  private async resolveRevision(previous?: {
    etag?: string;
    revision?: string;
  }): Promise<ResolvedRevision> {
    const response = await this.request(COMMIT_URL, {
      headers: this.headers(previous?.etag),
    });
    if (response.status === 304) {
      if (!previous?.revision) {
        throw new Error(
          'Exercism returned 304 without a previously resolved revision.'
        );
      }
      return {
        revision: previous.revision,
        etag: previous.etag ?? `"${previous.revision}"`,
        conditionalNotModified: true,
      };
    }
    if (!response.ok) {
      throw new Error(
        `Unable to resolve the Exercism revision (${response.status}).`
      );
    }
    const commit = (await readBoundedJson(
      response,
      MAX_GITHUB_METADATA_BYTES,
      'Exercism commit response'
    )) as { sha?: unknown };
    if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/.test(commit.sha)) {
      throw new Error('Exercism commit response did not include a full SHA.');
    }
    return {
      revision: commit.sha,
      etag: response.headers.get('etag') ?? `"${commit.sha}"`,
      conditionalNotModified: false,
    };
  }

  private async verifyMitSpdx(revision: string): Promise<void> {
    const response = await this.request(`${LICENSE_URL}?ref=${revision}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(
        `Unable to verify the Exercism license (${response.status}).`
      );
    }
    const license = (await readBoundedJson(
      response,
      MAX_GITHUB_METADATA_BYTES,
      'Exercism license response'
    )) as { license?: { spdx_id?: unknown } };
    if (license.license?.spdx_id !== 'MIT') {
      throw new Error('Exercism source is not covered by the MIT allowlist.');
    }
  }

  private async fetchFixedBlob(
    revision: string,
    entry: ExercismGitTreeEntry,
    maximumBytes: number,
    label: string
  ): Promise<string> {
    if (entry.type !== 'blob') throw new Error(`${label} is not a Git blob.`);
    if (entry.size !== undefined && entry.size > maximumBytes) {
      throw new Error(`${label} exceeds the ${maximumBytes}-byte limit.`);
    }
    const response = await this.request(
      `${RAW_ROOT}/${revision}/${entry.path}`,
      { headers: this.headers() }
    );
    if (!response.ok) {
      throw new Error(`Unable to fetch ${entry.path} (${response.status}).`);
    }
    const source = await readBoundedText(response, maximumBytes, label);
    if (calculateGitBlobSha(source) !== entry.sha) {
      throw new Error(`${label} does not match its fixed Git blob SHA.`);
    }
    return source;
  }

  private async fetchFixedTreeEvidence(
    revision: string
  ): Promise<FixedTreeEvidence> {
    const treeResponse = await this.request(
      `${TREE_ROOT}/${revision}?recursive=1`,
      { headers: this.headers() }
    );
    if (!treeResponse.ok) {
      throw new Error(
        `Unable to fetch the Exercism Git tree (${treeResponse.status}).`
      );
    }
    const treePayload = (await readBoundedJson(
      treeResponse,
      MAX_GITHUB_TREE_BYTES,
      'Exercism Git tree'
    )) as GitTreeResponse;
    if (
      typeof treePayload.sha !== 'string' ||
      !/^[a-f0-9]{40}$/.test(treePayload.sha) ||
      treePayload.truncated === true
    ) {
      throw new Error(
        'Exercism returned an incomplete or mismatched Git tree.'
      );
    }
    const entries = parseTreeEntries(treePayload.tree);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    const licenseEntry = byPath.get('LICENSE');
    if (!licenseEntry) {
      throw new Error('Exercism Git tree does not contain LICENSE.');
    }
    const licenseText = await this.fetchFixedBlob(
      revision,
      licenseEntry,
      EXERCISM_MAX_LICENSE_BYTES,
      'Exercism LICENSE'
    );
    const license: ExercismLicenseEvidence = {
      path: 'LICENSE',
      spdx: 'MIT',
      text: licenseText,
      gitBlobSha: licenseEntry.sha,
      contentHash: sha256(licenseText),
    };
    if (!isExercismLicenseEvidenceValid(license)) {
      throw new Error('Exercism LICENSE blob is not recognizable as MIT.');
    }
    return {
      entries,
      byPath,
      license,
    };
  }

  private async fetchResolvedSnapshot(
    problems: RawCatalogProblem[],
    resolved: Pick<ResolvedRevision, 'revision' | 'etag'>,
    localContentFingerprint: string
  ): Promise<ExercismFetchResult> {
    await this.verifyMitSpdx(resolved.revision);
    const fixedTree = await this.fetchFixedTreeEvidence(resolved.revision);
    const upstreamProblems: ExercismUpstreamProblem[] = [];
    for (const problem of problems) {
      const statementEntry = fixedTree.byPath.get(problem.origin.statementPath);
      if (!statementEntry) {
        throw new Error(
          `Exercism Git tree does not contain ${problem.origin.statementPath}.`
        );
      }
      const statementMarkdown = await this.fetchFixedBlob(
        resolved.revision,
        statementEntry,
        EXERCISM_MAX_STATEMENT_BYTES,
        `${problem.origin.externalId} statement`
      );
      const canonicalPath = `exercises/${problem.origin.externalId}/canonical-data.json`;
      const canonicalEntry = fixedTree.byPath.get(canonicalPath);
      const canonical = canonicalEntry
        ? parseCanonicalData(
            await this.fetchFixedBlob(
              resolved.revision,
              canonicalEntry,
              EXERCISM_MAX_CANONICAL_BYTES,
              `${problem.origin.externalId} canonical-data.json`
            )
          )
        : {
            data: null,
            hash: calculateCanonicalDataHash(null),
            status: 'missing' as const,
          };
      upstreamProblems.push({
        externalId: problem.origin.externalId,
        upstreamUrl: `https://github.com/${REPOSITORY}/tree/${resolved.revision}/exercises/${problem.origin.externalId}`,
        statementPath: problem.origin.statementPath,
        statementMarkdown,
        statementHash: sha256(statementMarkdown),
        statementBlobSha: statementEntry.sha,
        canonicalPath,
        ...(canonicalEntry ? { canonicalBlobSha: canonicalEntry.sha } : {}),
        canonicalData: canonical.data,
        canonicalDataHash: canonical.hash,
        canonicalDataStatus: canonical.status,
      });
    }

    return {
      notModified: false,
      revision: resolved.revision,
      etag: resolved.etag,
      localContentFingerprint,
      snapshot: {
        provider: 'exercism',
        repository: REPOSITORY,
        revision: resolved.revision,
        etag: resolved.etag,
        licenseSpdx: 'MIT',
        license: fixedTree.license,
        localContentFingerprint,
        fetchedAt: this.now().toISOString(),
        problems: upstreamProblems,
      },
    };
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
    const resolved = await this.resolveRevision(previous);
    if (
      resolved.conditionalNotModified &&
      previous?.localContentFingerprint === localContentFingerprint
    ) {
      return {
        notModified: true,
        revision: resolved.revision,
        etag: resolved.etag,
        localContentFingerprint,
      };
    }
    if (
      resolved.revision === previous?.revision &&
      previous.localContentFingerprint === localContentFingerprint
    ) {
      return {
        notModified: true,
        revision: resolved.revision,
        etag: resolved.etag,
        localContentFingerprint,
      };
    }

    return this.fetchResolvedSnapshot(
      problems,
      resolved,
      localContentFingerprint
    );
  }

  async fetchSnapshotAtRevision(
    problems: RawCatalogProblem[],
    revision: string
  ): Promise<ExercismFetchResult> {
    if (!/^[a-f0-9]{40}$/.test(revision)) {
      throw new Error('A full Exercism commit SHA is required.');
    }
    return this.fetchResolvedSnapshot(
      problems,
      { revision, etag: `"${revision}"` },
      calculateCatalogContentFingerprint(problems)
    );
  }

  async fetchDiscovery(
    knownProblems: RawCatalogProblem[],
    options: ExercismDiscoveryFetchOptions = {}
  ): Promise<ExercismDiscoveryFetchResult> {
    const maximumExercises = boundedMaximumExercises(options.maxExercises);
    const conditionalState = options.previous?.backlogComplete
      ? options.previous
      : undefined;
    const resolved = await this.resolveRevision(conditionalState);
    if (
      conditionalState &&
      (resolved.conditionalNotModified ||
        resolved.revision === conditionalState.revision)
    ) {
      return {
        notModified: true,
        revision: resolved.revision,
        etag: resolved.etag,
      };
    }
    await this.verifyMitSpdx(resolved.revision);

    const fixedTree = await this.fetchFixedTreeEvidence(resolved.revision);
    const { byPath, entries, license } = fixedTree;

    const statements = new Map<
      string,
      {
        instructions?: ExercismGitTreeEntry;
        description?: ExercismGitTreeEntry;
      }
    >();
    for (const entry of entries) {
      if (entry.type !== 'blob') continue;
      const match =
        /^exercises\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(instructions|description)\.md$/.exec(
          entry.path
        );
      if (!match) continue;
      const externalId = match[1];
      const statement = statements.get(externalId) ?? {};
      statement[match[2] as 'instructions' | 'description'] = entry;
      statements.set(externalId, statement);
    }

    const recordedEvidence = new Map<string, ExercismRecordedEvidence>();
    for (const evidence of options.recordedEvidence ?? []) {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(evidence.externalId) ||
        (evidence.statementBlobSha !== undefined &&
          !/^[a-f0-9]{40}$/.test(evidence.statementBlobSha)) ||
        (evidence.canonicalBlobSha !== undefined &&
          !/^[a-f0-9]{40}$/.test(evidence.canonicalBlobSha)) ||
        recordedEvidence.has(evidence.externalId)
      ) {
        throw new Error(
          `Invalid or duplicate recorded Exercism evidence: ${evidence.externalId}`
        );
      }
      recordedEvidence.set(evidence.externalId, evidence);
    }
    // Static fixtures can identify an existing exercise, but only persisted blob
    // evidence is strong enough to decide that its upstream content is unchanged.
    const legacyExcluded = new Set<string>();
    for (const problem of knownProblems) {
      if (!recordedEvidence.has(problem.origin.externalId)) {
        legacyExcluded.add(problem.origin.externalId);
      }
    }
    for (const externalId of options.knownExternalIds ?? []) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(externalId)) {
        throw new Error(`Invalid known Exercism external ID: ${externalId}`);
      }
      if (!recordedEvidence.has(externalId)) {
        legacyExcluded.add(externalId);
      }
    }
    const allExternalIds = [...statements.keys()].sort();
    const newExercises: string[] = [];
    const changedExercises: string[] = [];
    const unchangedExercises: string[] = [];
    for (const externalId of allExternalIds) {
      if (legacyExcluded.has(externalId)) continue;
      const evidence = recordedEvidence.get(externalId);
      if (!evidence) {
        newExercises.push(externalId);
        continue;
      }
      const statementEntries = statements.get(externalId)!;
      const statementEntry =
        statementEntries.instructions ?? statementEntries.description!;
      const canonicalEntry = byPath.get(
        `exercises/${externalId}/canonical-data.json`
      );
      if (
        !evidence.originOnly &&
        evidence.statementBlobSha === statementEntry.sha &&
        evidence.canonicalBlobSha === canonicalEntry?.sha
      ) {
        unchangedExercises.push(externalId);
      } else {
        changedExercises.push(externalId);
      }
    }
    const candidates = [...newExercises, ...changedExercises];
    const selected = candidates.slice(0, maximumExercises);
    const exercises: ExercismDiscoveredExercise[] = [];

    for (const externalId of selected) {
      const statementEntries = statements.get(externalId)!;
      const statementEntry =
        statementEntries.instructions ?? statementEntries.description!;
      const statementMarkdown = await this.fetchFixedBlob(
        resolved.revision,
        statementEntry,
        EXERCISM_MAX_STATEMENT_BYTES,
        `${externalId} statement`
      );
      const canonicalPath = `exercises/${externalId}/canonical-data.json`;
      const canonicalEntry = byPath.get(canonicalPath);
      let canonicalData: CatalogJsonValue = null;
      let canonicalDataHash = calculateCanonicalDataHash(null);
      let canonicalDataStatus: ExercismUpstreamProblem['canonicalDataStatus'] =
        'missing';
      if (canonicalEntry) {
        const source = await this.fetchFixedBlob(
          resolved.revision,
          canonicalEntry,
          EXERCISM_MAX_CANONICAL_BYTES,
          `${externalId} canonical-data.json`
        );
        const parsed = parseCanonicalData(source);
        canonicalData = parsed.data;
        canonicalDataHash = parsed.hash;
        canonicalDataStatus = parsed.status;
      }
      exercises.push({
        externalId,
        upstreamUrl: `https://github.com/${REPOSITORY}/tree/${resolved.revision}/exercises/${externalId}`,
        statementPath: statementEntry.path,
        statementMarkdown,
        statementHash: sha256(statementMarkdown),
        statementBlobSha: statementEntry.sha,
        canonicalPath,
        ...(canonicalEntry ? { canonicalBlobSha: canonicalEntry.sha } : {}),
        canonicalData,
        canonicalDataHash,
        canonicalDataStatus,
      });
    }

    return {
      notModified: false,
      revision: resolved.revision,
      etag: resolved.etag,
      snapshot: {
        schemaVersion: 1,
        provider: 'exercism',
        repository: REPOSITORY,
        revision: resolved.revision,
        etag: resolved.etag,
        fetchedAt: this.now().toISOString(),
        license,
        treeExerciseCount: allExternalIds.length,
        knownExerciseCount: allExternalIds.filter(
          (externalId) =>
            legacyExcluded.has(externalId) || recordedEvidence.has(externalId)
        ).length,
        newExerciseCount: newExercises.length,
        changedExerciseCount: changedExercises.length,
        unchangedExerciseCount: unchangedExercises.length,
        undiscoveredExerciseCount: candidates.length,
        selectedExerciseCount: exercises.length,
        selectionTruncated: candidates.length > exercises.length,
        exercises,
      },
    };
  }

  async discoverExercises(
    knownProblems: RawCatalogProblem[],
    options: ExercismDiscoveryOptions = {}
  ): Promise<ExercismDiscoverySnapshot> {
    const result = await this.fetchDiscovery(knownProblems, options);
    if (!result.snapshot) {
      throw new Error('Unconditional Exercism discovery returned no snapshot.');
    }
    return result.snapshot;
  }
}
