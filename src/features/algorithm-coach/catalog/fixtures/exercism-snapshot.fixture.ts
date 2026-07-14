import {
  calculateCanonicalDataHash,
  calculateCatalogContentFingerprint,
  sha256,
} from '../content-hash';
import {
  curatedExercismProblems,
  EXERCISM_FIXTURE_REVISION,
} from '../curated-exercism-problems';
import type { ExercismSnapshot } from '../raw-types';

export const EXERCISM_FIXTURE_ETAG =
  '"algocoach-exercism-4d18823c6abd89a60f2df65345d970a31fa12e49"';

export const exercismSnapshotFixture: ExercismSnapshot = {
  provider: 'exercism',
  repository: 'exercism/problem-specifications',
  revision: EXERCISM_FIXTURE_REVISION,
  etag: EXERCISM_FIXTURE_ETAG,
  licenseSpdx: 'MIT',
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
    return {
      externalId: problem.origin.externalId,
      upstreamUrl: problem.origin.upstreamUrl,
      statementPath: problem.origin.statementPath,
      statementMarkdown,
      statementHash: sha256(statementMarkdown),
      canonicalData,
      canonicalDataHash: calculateCanonicalDataHash(canonicalData),
      canonicalDataStatus: 'available' as const,
    };
  }),
};
