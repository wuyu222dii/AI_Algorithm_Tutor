import path from 'node:path';

import { curatedExercismProblems } from '../src/features/algorithm-coach/catalog/curated-exercism-problems';
import { ExercismCatalogAdapter } from '../src/features/algorithm-coach/catalog/exercism-adapter';
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
import { validateCatalogBatch } from '../src/features/algorithm-coach/catalog/validation';
import {
  readCatalogWorkspace,
  writeCatalogWorkspace,
} from '../src/features/algorithm-coach/catalog/workspace-store';

type Command =
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
  candidateIds: string[];
  reviewer?: string;
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
    !['dry-run', 'sync', 'validate', 'approve', 'publish', 'rollback'].includes(
      command
    )
  ) {
    throw new Error(
      'Usage: coach-catalog <dry-run|sync|validate|approve|publish|rollback> [options]'
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
  const revision = optionValue(args, '--revision');
  if (args.includes('--fixture') && !workspace) {
    throw new Error('--fixture requires an explicit --workspace path.');
  }
  if (revision && (!/^\d+$/.test(revision) || Number(revision) < 1)) {
    throw new Error('--revision must be a positive integer.');
  }
  return {
    command,
    workspacePath: workspace ? path.resolve(workspace) : undefined,
    fixture: args.includes('--fixture'),
    candidateIds: candidates,
    reviewer: optionValue(args, '--reviewer'),
    releaseId: optionValue(args, '--release'),
    problemSlug: optionValue(args, '--problem'),
    revisionVersion: revision ? Number(revision) : undefined,
    trigger:
      optionValue(args, '--trigger') === 'scheduled' ? 'scheduled' : 'manual',
  };
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
  console.error(
    `[catalog] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
