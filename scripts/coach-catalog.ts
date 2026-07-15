import { appendFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { curatedExercismProblems } from '../src/features/algorithm-coach/catalog/curated-exercism-problems';
import {
  discoveryDraftGeneratorFromEnv,
  generateDiscoveryReport,
} from '../src/features/algorithm-coach/catalog/discovery-enrichment';
import {
  evaluateCatalogDiscoveryAnomalies,
  type CatalogDiscoveryMonitorState,
} from '../src/features/algorithm-coach/catalog/discovery-monitor';
import {
  ExercismCatalogAdapter,
  type ExercismDiscoveryPreviousState,
  type ExercismRecordedEvidence,
} from '../src/features/algorithm-coach/catalog/exercism-adapter';
import { exercismSnapshotFixture } from '../src/features/algorithm-coach/catalog/fixtures/exercism-snapshot.fixture';
import { emitCatalogOperationalEvent } from '../src/features/algorithm-coach/catalog/operational-events';
import {
  applyExercismSnapshot,
  approveCatalogCandidates,
  markCatalogNotModified,
  publishCatalogCandidates,
  rollbackCatalogRelease,
  validateCatalogCandidates,
} from '../src/features/algorithm-coach/catalog/pipeline';
import type {
  CatalogBootstrapSummary,
  ExercismDiscoveryArtifact,
  ExercismDiscoveryNotModifiedReport,
  RawCatalogProblem,
} from '../src/features/algorithm-coach/catalog/raw-types';
import { validateCatalogBatch } from '../src/features/algorithm-coach/catalog/validation';
import {
  readCatalogWorkspace,
  writeCatalogWorkspace,
} from '../src/features/algorithm-coach/catalog/workspace-store';

type Command =
  | 'bootstrap'
  | 'discover'
  | 'monitor'
  | 'dry-run'
  | 'sync'
  | 'validate'
  | 'approve'
  | 'publish'
  | 'rollback';

interface CliOptions {
  command: Command;
  workspacePath?: string;
  fixture: boolean;
  ingest: boolean;
  candidateIds: string[];
  reviewer?: string;
  outputPath?: string;
  maxExercises?: number;
  releaseId?: string;
  problemSlug?: string;
  revisionVersion?: number;
  trigger: 'manual' | 'scheduled';
}

function optionValue(args: string[], name: string): string | undefined {
  const equalArgument = args.find((argument) =>
    argument.startsWith(`${name}=`)
  );
  if (equalArgument) return equalArgument.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(args: string[]): CliOptions {
  const command = args[0] as Command | undefined;
  if (
    !command ||
    ![
      'bootstrap',
      'discover',
      'monitor',
      'dry-run',
      'sync',
      'validate',
      'approve',
      'publish',
      'rollback',
    ].includes(command)
  ) {
    throw new Error(
      'Usage: coach-catalog <bootstrap|discover|monitor|dry-run|sync|validate|approve|publish|rollback> [options]'
    );
  }
  const candidates = args
    .flatMap((argument, index) =>
      argument === '--candidate'
        ? [args[index + 1]]
        : argument.startsWith('--candidate=')
          ? [argument.slice('--candidate='.length)]
          : []
    )
    .filter(Boolean)
    .flatMap((value) => value.split(','));

  const workspace = optionValue(args, '--workspace');
  const output = optionValue(args, '--output');
  const revision = optionValue(args, '--revision');
  const maximum =
    optionValue(args, '--max') ?? process.env.CATALOG_DISCOVERY_MAX_EXERCISES;
  if (args.includes('--fixture') && !workspace) {
    throw new Error('--fixture requires an explicit --workspace path.');
  }
  if (command === 'discover' && !output) {
    throw new Error('discover requires an explicit --output <path>.');
  }
  if (revision && (!/^\d+$/.test(revision) || Number(revision) < 1)) {
    throw new Error('--revision must be a positive integer.');
  }
  if (
    maximum &&
    (!/^\d+$/.test(maximum) || Number(maximum) < 1 || Number(maximum) > 50)
  ) {
    throw new Error('--max must be an integer between 1 and 50.');
  }
  return {
    command,
    workspacePath: workspace ? path.resolve(workspace) : undefined,
    fixture: args.includes('--fixture'),
    ingest: args.includes('--ingest'),
    candidateIds: candidates,
    reviewer: optionValue(args, '--reviewer'),
    outputPath: output ? path.resolve(output) : undefined,
    maxExercises: maximum ? Number(maximum) : undefined,
    releaseId: optionValue(args, '--release'),
    problemSlug: optionValue(args, '--problem'),
    revisionVersion: revision ? Number(revision) : undefined,
    trigger:
      optionValue(args, '--trigger') === 'scheduled' ? 'scheduled' : 'manual',
  };
}

interface BootstrapCatalogStore {
  bootstrapExercism(
    curatedProblems: RawCatalogProblem[],
    adapter: ExercismCatalogAdapter,
    actor: string
  ): Promise<CatalogBootstrapSummary>;
}

interface DiscoveryCatalogStore {
  recordedExercismEvidence(): Promise<ExercismRecordedEvidence[]>;
  discoveryState(): Promise<
    ExercismDiscoveryPreviousState & CatalogDiscoveryMonitorState
  >;
  recordDiscoveryFailure(
    actor: string,
    errorCode: string,
    errorMessage: string,
    trigger?: 'manual' | 'scheduled'
  ): Promise<{ runId: string }>;
  ingestDiscoveryReport(
    report: Awaited<ReturnType<typeof generateDiscoveryReport>>,
    actor: string
  ): Promise<{
    ingested: number;
    alreadyPresent: number;
    candidateIds: string[];
  }>;
}

function positiveIntegerEnv(
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(
      'CATALOG_ANOMALY_DELTA_THRESHOLD must be a positive integer.'
    );
  }
  return Number(value);
}

function githubCommandValue(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

async function monitorCatalog(): Promise<void> {
  const threshold = positiveIntegerEnv(
    process.env.CATALOG_ANOMALY_DELTA_THRESHOLD,
    25
  );
  const { CatalogDatabaseStore } = await import(
    '../src/features/algorithm-coach/catalog/catalog-store.server'
  );
  const store = new CatalogDatabaseStore() as unknown as Partial<
    Pick<DiscoveryCatalogStore, 'discoveryState'>
  >;
  if (typeof store.discoveryState !== 'function') {
    throw new Error(
      'CatalogDatabaseStore.discoveryState is not available in this build.'
    );
  }
  const state = await store.discoveryState();
  const anomalies = evaluateCatalogDiscoveryAnomalies(state, threshold);
  const summary = [
    '## AlgoCoach catalog anomaly monitor',
    '',
    `- Consecutive failures: ${state.consecutiveFailures}`,
    `- Tree delta threshold: ${threshold}`,
    `- Result: ${anomalies.length === 0 ? 'pass' : 'fail'}`,
    ...anomalies.map((item) => `- ${item.code}: ${item.message}`),
    '',
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
  }
  for (const anomaly of anomalies) {
    console.error(
      `::error title=${githubCommandValue(anomaly.code)}::${githubCommandValue(
        anomaly.message
      )}`
    );
  }
  console.log(
    JSON.stringify(
      {
        command: 'monitor',
        threshold,
        status: anomalies.length === 0 ? 'passed' : 'failed',
        anomalies,
      },
      null,
      2
    )
  );
  if (anomalies.length > 0) {
    throw new Error(
      `Catalog anomaly monitor detected ${anomalies.length} issue(s).`
    );
  }
}

async function writeDiscoveryReport(
  outputPath: string,
  report: ExercismDiscoveryArtifact
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function discoverCatalog(options: CliOptions): Promise<void> {
  if (process.env.CATALOG_DISCOVERY_ENABLED !== 'true') {
    throw new Error(
      'Live catalog discovery requires CATALOG_DISCOVERY_ENABLED=true.'
    );
  }
  if (!options.outputPath) {
    throw new Error('Catalog discovery requires an output path.');
  }
  const actor = options.reviewer?.trim();
  let store: DiscoveryCatalogStore | undefined;
  if (options.ingest) {
    if (process.env.CATALOG_DISCOVERY_INGEST_ENABLED !== 'true') {
      throw new Error(
        'Discovery ingestion requires CATALOG_DISCOVERY_INGEST_ENABLED=true.'
      );
    }
    if (!actor) {
      throw new Error('discover --ingest requires --reviewer <identity>.');
    }
    const { CatalogDatabaseStore } = await import(
      '../src/features/algorithm-coach/catalog/catalog-store.server'
    );
    const databaseStore = new CatalogDatabaseStore();
    const candidateStore =
      databaseStore as unknown as Partial<DiscoveryCatalogStore>;
    if (
      typeof candidateStore.recordedExercismEvidence !== 'function' ||
      typeof candidateStore.discoveryState !== 'function' ||
      typeof candidateStore.recordDiscoveryFailure !== 'function' ||
      typeof candidateStore.ingestDiscoveryReport !== 'function'
    ) {
      throw new Error(
        'CatalogDatabaseStore discovery ingestion contract is not available in this build.'
      );
    }
    store = candidateStore as DiscoveryCatalogStore;
  }

  try {
    const adapter = new ExercismCatalogAdapter({
      token:
        process.env.EXERCISM_GITHUB_TOKEN?.trim() ||
        process.env.GITHUB_TOKEN?.trim(),
    });
    const [recordedEvidence, previous] = store
      ? await Promise.all([
          store.recordedExercismEvidence(),
          store.discoveryState(),
        ])
      : [[], undefined];
    const fetched = await adapter.fetchDiscovery(curatedExercismProblems, {
      maxExercises: options.maxExercises,
      recordedEvidence,
      previous,
    });
    if (fetched.notModified || !fetched.snapshot) {
      const report: ExercismDiscoveryNotModifiedReport = {
        schemaVersion: 1,
        notModified: true,
        generatedAt: new Date().toISOString(),
        revision: fetched.revision,
        etag: fetched.etag,
        repository: 'exercism/problem-specifications',
        drafts: [],
      };
      await writeDiscoveryReport(options.outputPath, report);
      console.log(
        JSON.stringify(
          {
            command: 'discover',
            mode: 'review-artifact',
            notModified: true,
            persistedToDatabase: false,
            output: options.outputPath,
            revision: report.revision,
          },
          null,
          2
        )
      );
      return;
    }
    const snapshot = fetched.snapshot;
    const report = await generateDiscoveryReport(
      snapshot,
      discoveryDraftGeneratorFromEnv()
    );
    await writeDiscoveryReport(options.outputPath, report);
    const ingestion =
      store && actor
        ? await store.ingestDiscoveryReport(report, actor)
        : undefined;
    console.log(
      JSON.stringify(
        {
          command: 'discover',
          mode: 'review-artifact',
          notModified: false,
          persistedToDatabase: ingestion !== undefined,
          output: options.outputPath,
          revision: report.revision,
          counts: report.counts,
          reviewable: report.drafts.filter(
            (draft) => draft.status === 'needs_human_review'
          ).length,
          rejected: report.drafts.filter((draft) => draft.status === 'rejected')
            .length,
          ingestion,
        },
        null,
        2
      )
    );
  } catch (error) {
    if (store && actor) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await store.recordDiscoveryFailure(
          actor,
          /license|MIT allowlist|SPDX/i.test(message)
            ? 'license_changed'
            : 'discovery_failed',
          message,
          options.trigger
        );
      } catch (recordError) {
        const recordMessage =
          recordError instanceof Error
            ? recordError.message
            : String(recordError);
        console.error(
          `::error title=discovery_failure_record_failed::${githubCommandValue(recordMessage)}`
        );
      }
    }
    throw error;
  } finally {
    if (store) {
      const { closeDb } = await import('../src/core/db');
      await closeDb();
    }
  }
}

function summary(
  options: CliOptions,
  workspace: Awaited<ReturnType<typeof readCatalogWorkspace>>,
  extra: Record<string, unknown> = {}
) {
  const states = Object.fromEntries(
    [
      'discovered',
      'quarantined',
      'validated',
      'approved',
      'published',
      'rejected',
      'archived',
    ].map((state) => [
      state,
      workspace.candidates.filter((candidate) => candidate.state === state)
        .length,
    ])
  );
  console.log(
    JSON.stringify(
      {
        command: options.command,
        workspace: options.workspacePath,
        sourceRevision: workspace.source.revision,
        candidates: states,
        releases: workspace.releases.length,
        activeReleaseId: workspace.activeReleaseId,
        ...extra,
      },
      null,
      2
    )
  );
}

async function synchronizeWorkspace(options: CliOptions) {
  if (!options.workspacePath) throw new Error('Workspace path is required.');
  const workspace = await readCatalogWorkspace(options.workspacePath);
  const checkedAt = new Date().toISOString();
  try {
    const fetched = options.fixture
      ? {
          notModified:
            workspace.source.revision === exercismSnapshotFixture.revision &&
            workspace.source.localContentFingerprint ===
              exercismSnapshotFixture.localContentFingerprint,
          revision: exercismSnapshotFixture.revision,
          etag: exercismSnapshotFixture.etag,
          localContentFingerprint:
            exercismSnapshotFixture.localContentFingerprint,
          snapshot: exercismSnapshotFixture,
        }
      : await new ExercismCatalogAdapter({
          token:
            process.env.EXERCISM_GITHUB_TOKEN?.trim() ||
            process.env.GITHUB_TOKEN?.trim(),
        }).fetchSnapshot(curatedExercismProblems, workspace.source);
    const result =
      fetched.notModified || !fetched.snapshot
        ? markCatalogNotModified(
            workspace,
            checkedAt,
            'catalog-sync',
            fetched.localContentFingerprint
          )
        : applyExercismSnapshot(
            workspace,
            curatedExercismProblems,
            fetched.snapshot
          );
    if (options.command !== 'dry-run') {
      await writeCatalogWorkspace(options.workspacePath, result.workspace);
    }
    emitCatalogOperationalEvent('catalog_sync_completed', {
      mode: 'workspace',
      outcome: 'succeeded',
      revision: fetched.revision,
      discovered: result.discoveredCandidateIds.length,
      notModified: result.notModified,
    });
    summary(options, result.workspace, {
      notModified: result.notModified,
      discoveredCandidateIds: result.discoveredCandidateIds,
      persisted: options.command !== 'dry-run',
    });
  } catch (error) {
    emitCatalogOperationalEvent('catalog_sync_completed', {
      mode: 'workspace',
      outcome: 'failed',
      discovered: 0,
      errorCode: 'upstream_sync_failed',
    });
    throw error;
  }
}

function assertCuratedCatalog() {
  const curatedValidation = validateCatalogBatch(curatedExercismProblems);
  const invalidCurated = [...curatedValidation.entries()].filter(
    ([, result]) => !result.valid
  );
  if (invalidCurated.length > 0) {
    throw new Error(
      `Curated catalog validation failed: ${JSON.stringify(invalidCurated)}`
    );
  }
}

async function runDatabaseCommand(options: CliOptions) {
  if (
    ['dry-run', 'sync', 'validate'].includes(options.command) &&
    process.env.CATALOG_SYNC_ENABLED !== 'true'
  ) {
    throw new Error(
      'Database catalog sync commands require CATALOG_SYNC_ENABLED=true.'
    );
  }
  const { CatalogDatabaseStore } = await import(
    '../src/features/algorithm-coach/catalog/catalog-store.server'
  );
  const store = new CatalogDatabaseStore();
  const adapter = new ExercismCatalogAdapter({
    token:
      process.env.EXERCISM_GITHUB_TOKEN?.trim() ||
      process.env.GITHUB_TOKEN?.trim(),
  });

  if (options.command === 'bootstrap') {
    if (process.env.CATALOG_BOOTSTRAP_ENABLED !== 'true') {
      throw new Error(
        'Catalog bootstrap requires CATALOG_BOOTSTRAP_ENABLED=true.'
      );
    }
    const actor = options.reviewer?.trim();
    if (!actor) {
      throw new Error('bootstrap requires --reviewer <identity>.');
    }
    const bootstrap = (store as unknown as Partial<BootstrapCatalogStore>)
      .bootstrapExercism;
    if (typeof bootstrap !== 'function') {
      throw new Error(
        'CatalogDatabaseStore.bootstrapExercism is not available in this build.'
      );
    }
    const result = await bootstrap.call(
      store,
      curatedExercismProblems,
      adapter,
      actor
    );
    console.log(
      JSON.stringify(
        { command: options.command, mode: 'database-bootstrap', ...result },
        null,
        2
      )
    );
    return;
  }

  if (options.command === 'dry-run') {
    const previous = await store.sourceState();
    const fetched = await adapter.fetchSnapshot(
      curatedExercismProblems,
      previous
    );
    console.log(
      JSON.stringify(
        {
          command: options.command,
          mode: 'database-dry-run',
          persisted: false,
          previous,
          notModified: fetched.notModified,
          sourceRevision: fetched.revision ?? previous.revision,
          upstreamProblems: fetched.snapshot?.problems.length ?? 0,
        },
        null,
        2
      )
    );
    emitCatalogOperationalEvent('catalog_sync_completed', {
      mode: 'database',
      outcome: 'succeeded',
      revision: fetched.revision ?? previous.revision,
      discovered: fetched.snapshot?.problems.length ?? 0,
      notModified: fetched.notModified,
    });
    return;
  }
  if (options.command === 'sync') {
    const result = await store.syncExercism(
      curatedExercismProblems,
      adapter,
      options.trigger
    );
    console.log(
      JSON.stringify(
        { command: options.command, mode: 'database', ...result },
        null,
        2
      )
    );
    return;
  }
  if (options.command === 'validate') {
    const result = await store.validateCandidates(
      options.candidateIds.length > 0 ? options.candidateIds : undefined
    );
    console.log(
      JSON.stringify(
        { command: options.command, mode: 'database', ...result },
        null,
        2
      )
    );
    return;
  }
  if (options.command === 'approve') {
    if (!options.reviewer) {
      throw new Error('approve requires --reviewer <identity>.');
    }
    if (options.candidateIds.length === 0) {
      throw new Error('approve requires one or more --candidate <id> values.');
    }
    const result = await store.approveCandidates(
      options.candidateIds,
      options.reviewer
    );
    console.log(
      JSON.stringify(
        { command: options.command, mode: 'database', ...result },
        null,
        2
      )
    );
    return;
  }
  if (options.command === 'publish') {
    if (!options.reviewer) {
      throw new Error('publish requires --reviewer <identity>.');
    }
    if (options.candidateIds.length === 0) {
      throw new Error('publish requires one or more --candidate <id> values.');
    }
    const result = await store.publishCandidates(
      options.candidateIds,
      options.reviewer
    );
    console.log(
      JSON.stringify(
        { command: options.command, mode: 'database', ...result },
        null,
        2
      )
    );
    return;
  }

  const reviewer = options.reviewer ?? process.env.GITHUB_ACTOR;
  if (!reviewer) throw new Error('rollback requires --reviewer <identity>.');
  if (!options.problemSlug || !options.revisionVersion) {
    throw new Error(
      'database rollback requires --problem <slug> --revision <number>.'
    );
  }
  const result = await store.rollbackProblem(
    options.problemSlug,
    options.revisionVersion,
    reviewer
  );
  console.log(
    JSON.stringify(
      { command: options.command, mode: 'database', ...result },
      null,
      2
    )
  );
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  assertCuratedCatalog();
  if (options.command === 'discover') {
    await discoverCatalog(options);
    return;
  }
  if (options.command === 'monitor') {
    try {
      await monitorCatalog();
    } finally {
      const { closeDb } = await import('../src/core/db');
      await closeDb();
    }
    return;
  }
  if (!options.workspacePath) {
    try {
      await runDatabaseCommand(options);
    } finally {
      const { closeDb } = await import('../src/core/db');
      await closeDb();
    }
    return;
  }
  if (options.command === 'dry-run' || options.command === 'sync') {
    await synchronizeWorkspace(options);
    return;
  }

  const workspace = await readCatalogWorkspace(options.workspacePath);
  if (options.command === 'validate') {
    const beforeStates = new Map(
      workspace.candidates.map((candidate) => [candidate.id, candidate.state])
    );
    const next = validateCatalogCandidates(
      workspace,
      options.candidateIds.length > 0 ? options.candidateIds : undefined
    );
    await writeCatalogWorkspace(options.workspacePath, next);
    for (const candidate of next.candidates) {
      if (
        candidate.state === 'rejected' &&
        beforeStates.get(candidate.id) !== 'rejected'
      ) {
        emitCatalogOperationalEvent('catalog_candidate_rejected', {
          mode: 'workspace',
          outcome: 'rejected',
          candidateId: candidate.id,
          issueCodes: [
            ...new Set(
              candidate.validation?.issues.map((item) => item.code) ?? []
            ),
          ],
        });
      }
    }
    summary(options, next);
    return;
  }

  if (options.command === 'approve') {
    if (!options.reviewer) {
      throw new Error('approve requires --reviewer <identity>.');
    }
    if (options.candidateIds.length === 0) {
      throw new Error('approve requires one or more --candidate <id> values.');
    }
    const next = approveCatalogCandidates(
      workspace,
      options.candidateIds,
      options.reviewer
    );
    await writeCatalogWorkspace(options.workspacePath, next);
    summary(options, next);
    return;
  }

  if (options.command === 'publish') {
    if (!options.reviewer) {
      throw new Error('publish requires --reviewer <identity>.');
    }
    if (options.candidateIds.length === 0) {
      throw new Error('publish requires one or more --candidate <id> values.');
    }
    const next = publishCatalogCandidates(
      workspace,
      options.candidateIds,
      options.reviewer
    );
    await writeCatalogWorkspace(options.workspacePath, next);
    const release =
      next.releases.length > workspace.releases.length
        ? next.releases.at(-1)
        : undefined;
    if (release) {
      for (const candidateId of release.candidateIds) {
        const problemSlug = next.candidates.find(
          (candidate) => candidate.id === candidateId
        )?.problem.slug;
        emitCatalogOperationalEvent('catalog_revision_published', {
          mode: 'workspace',
          outcome: 'published',
          problemSlug,
          releaseId: release.id,
        });
      }
    } else {
      for (const candidateId of options.candidateIds) {
        const candidate = next.candidates.find(
          (item) => item.id === candidateId
        );
        if (candidate?.state === 'published') {
          emitCatalogOperationalEvent('catalog_revision_published', {
            mode: 'workspace',
            outcome: 'already_published',
            problemSlug: candidate.problem.slug,
          });
        }
      }
    }
    summary(options, next);
    return;
  }

  const actor = options.reviewer ?? process.env.GITHUB_ACTOR;
  if (!actor) throw new Error('rollback requires --reviewer <identity>.');
  const next = rollbackCatalogRelease(workspace, actor, options.releaseId);
  await writeCatalogWorkspace(options.workspacePath, next);
  emitCatalogOperationalEvent('catalog_revision_rolled_back', {
    mode: 'workspace',
    outcome: 'rolled_back',
    releaseId: next.activeReleaseId,
  });
  summary(options, next);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/license|MIT allowlist|SPDX/i.test(message)) {
    console.error(
      `::error title=license_changed::${githubCommandValue(message)}`
    );
  }
  console.error(`[catalog] ${message}`);
  process.exitCode = 1;
});
