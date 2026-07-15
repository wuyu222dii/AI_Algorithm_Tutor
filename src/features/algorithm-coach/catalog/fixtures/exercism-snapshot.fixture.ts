import {
  calculateCanonicalDataHash,
  calculateCatalogContentFingerprint,
  sha256,
} from '../content-hash';
import {
  curatedExercismProblems,
  EXERCISM_FIXTURE_REVISION,
} from '../curated-exercism-problems';
import { calculateGitBlobSha } from '../exercism-adapter';
import type { ExercismSnapshot } from '../raw-types';
import {
  EXERCISM_MIT_LICENSE_CONTENT_HASH,
  EXERCISM_MIT_LICENSE_GIT_BLOB_SHA,
  EXERCISM_MIT_LICENSE_TEXT,
} from './exercism-license.fixture';

export const EXERCISM_FIXTURE_ETAG =
  '"algocoach-exercism-4d18823c6abd89a60f2df65345d970a31fa12e49"';

export const exercismSnapshotFixture: ExercismSnapshot = {
  provider: 'exercism',
  repository: 'exercism/problem-specifications',
  revision: EXERCISM_FIXTURE_REVISION,
  etag: EXERCISM_FIXTURE_ETAG,
  licenseSpdx: 'MIT',
  license: {
    path: 'LICENSE',
    spdx: 'MIT',
    text: EXERCISM_MIT_LICENSE_TEXT,
    gitBlobSha: EXERCISM_MIT_LICENSE_GIT_BLOB_SHA,
    contentHash: EXERCISM_MIT_LICENSE_CONTENT_HASH,
  },
  localContentFingerprint: calculateCatalogContentFingerprint(
    curatedExercismProblems
  ),
  fetchedAt: '2026-07-14T00:00:00.000Z',
  problems: curatedExercismProblems.map((problem) => {
    const statementMarkdown = `# ${problem.title.en}\n\n${problem.description.en}\n`;
    const canonicalData = {
      exercise: problem.origin.externalId,
      cases: problem.tests.map((test) => ({
        uuid: test.id,
        description: `Deterministic fixture case ${test.id}`,
        input: { args: test.args },
        expected: test.expected,
      })),
    };
    const canonicalSource = JSON.stringify(canonicalData);
    return {
      externalId: problem.origin.externalId,
      upstreamUrl: problem.origin.upstreamUrl,
      statementPath: problem.origin.statementPath,
      statementMarkdown,
      statementHash: sha256(statementMarkdown),
      statementBlobSha: calculateGitBlobSha(statementMarkdown),
      canonicalPath: `exercises/${problem.origin.externalId}/canonical-data.json`,
      canonicalBlobSha: calculateGitBlobSha(canonicalSource),
      canonicalData,
      canonicalDataHash: calculateCanonicalDataHash(canonicalData),
      canonicalDataStatus: 'available' as const,
    };
  }),
};
