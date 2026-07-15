import { describe, expect, it } from 'vitest';

import {
  catalogReviewDraftV2Schema,
  catalogSourceProvenanceV1Schema,
  safeParseCatalogReviewDraftV2,
  type CatalogReviewDraftV2,
} from './admin-contracts';
import {
  canonicalInputToArgs,
  createDefaultCanonicalSelections,
  flattenCanonicalCases,
  listCanonicalCaseOptions,
  mapCanonicalSelectionsToTests,
} from './canonical-mapping';
import { calculateCanonicalDataHash, sha256 } from './content-hash';
import type { CatalogJsonValue, ExercismDiscoveryDraft } from './raw-types';
import {
  assessCatalogReviewDraftV2,
  CATALOG_RUNTIME_CONTRACTS,
  catalogSourceProvenanceFromDiscoveryDraft,
  generateCatalogReviewStarterTemplates,
  materializeCatalogReviewDraftV2,
  normalizeCatalogReviewDraftV2,
  type CatalogReviewRawCandidateFactsV1,
} from './review-draft';

const REVISION = 'a'.repeat(40);
const STATEMENT_BLOB = 'b'.repeat(40);
const CANONICAL_BLOB = 'c'.repeat(40);
const LICENSE_BLOB = 'd'.repeat(40);

function discoveryDraftFixture(): ExercismDiscoveryDraft {
  const statementMarkdown = '# Increment\n\nReturn the next integer.';
  const licenseText = 'MIT fixture license';
  const canonicalData: CatalogJsonValue = {
    exercise: 'increment',
    cases: [
      {
        description: 'basic cases',
        cases: [
          {
            uuid: 'canonical-1',
            description: 'increments one',
            input: { value: 1 },
            expected: 2,
          },
          {
            uuid: 'canonical-2',
            input: { args: [4] },
            expected: 5,
          },
          {
            uuid: 'canonical-3',
            input: 0,
            expected: 1,
          },
        ],
      },
    ],
  };
  const upstream = {
    externalId: 'increment',
    upstreamUrl: `https://github.com/exercism/problem-specifications/tree/${REVISION}/exercises/increment`,
    statementPath: 'exercises/increment/instructions.md',
    statementMarkdown,
    statementHash: sha256(statementMarkdown),
    statementBlobSha: STATEMENT_BLOB,
    canonicalPath: 'exercises/increment/canonical-data.json',
    canonicalBlobSha: CANONICAL_BLOB,
    canonicalData,
    canonicalDataHash: calculateCanonicalDataHash(canonicalData),
    canonicalDataStatus: 'available' as const,
  };
  return {
    schemaVersion: 1,
    externalId: 'increment',
    discoveryContentHash: sha256('discovery'),
    status: 'needs_human_review',
    publishable: false,
    upstream,
    source: {
      provider: 'exercism',
      repository: 'exercism/problem-specifications',
      revision: REVISION,
      upstreamUrl: upstream.upstreamUrl,
      statementPath: upstream.statementPath,
      statementHash: upstream.statementHash,
      statementBlobSha: upstream.statementBlobSha,
      canonicalPath: upstream.canonicalPath,
      canonicalDataHash: upstream.canonicalDataHash,
      canonicalBlobSha: upstream.canonicalBlobSha,
      licenseSpdx: 'MIT',
      licenseText,
      licenseGitBlobSha: LICENSE_BLOB,
      licenseContentHash: sha256(licenseText),
      attribution: 'Adapted from Exercism under the MIT License.',
    },
    proposed: {
      title: { zh: '递增', en: 'Increment' },
      description: {
        zh: '返回下一个整数。',
        en: 'Return the next integer.',
      },
      difficulty: 'easy',
      topics: ['array-hash'],
      learningObjectives: [{ zh: '映射输入', en: 'Map canonical inputs' }],
      functionSignature: {
        entryPoint: 'increment',
        parameters: [{ name: 'value', type: { kind: 'integer' } }],
        returns: { kind: 'integer' },
      },
      starterTemplates: {
        javascript: 'function increment(value) { return value + 1; }',
        python: 'def increment(value):\n    return value + 1',
        typescript:
          'function increment(value: number): number { return value + 1; }',
      },
      tests: [],
    },
    warnings: ['Human review required.'],
  };
}

function completeDraft(): CatalogReviewDraftV2 {
  return {
    schemaVersion: 2,
    id: 'ex-101',
    slug: 'exercism-increment',
    title: { zh: '递增', en: 'Increment' },
    description: { zh: '返回下一个整数。', en: 'Return the next integer.' },
    difficulty: 'easy',
    topics: ['array-hash'],
    learningObjectives: [{ zh: '映射输入', en: 'Map inputs' }],
    prerequisiteTopics: [],
    solutionPatterns: ['direct mapping'],
    constraints: [{ zh: '输入为整数。', en: 'Input is an integer.' }],
    hints: [
      { zh: '读取输入。', en: 'Read the input.' },
      { zh: '加一。', en: 'Add one.' },
      { zh: '返回结果。', en: 'Return the result.' },
    ],
    reviewPoints: [{ zh: '检查返回值。', en: 'Check the return value.' }],
    estimatedMinutes: 10,
    functionProtocol: {
      signature: {
        parameters: [{ name: 'value', type: { kind: 'integer' } }],
        returns: { kind: 'integer' },
      },
      entryPoints: {
        javascript: 'increment',
        python: 'increment',
        typescript: 'increment',
      },
      templates: {
        javascript: 'function increment(value) { return value + 1; }',
        python: 'def increment(value):\n    return value + 1',
        typescript:
          'function increment(value: number): number { return value + 1; }',
      },
    },
    canonicalSelections: [
      { sourceTestUuid: 'canonical-1', id: 'inc-1', isSample: true },
      { sourceTestUuid: 'canonical-2', id: 'inc-2', isSample: false },
      { sourceTestUuid: 'canonical-3', id: 'inc-3', isSample: false },
    ],
    manualTests: [
      {
        id: 'inc-manual',
        args: [-1],
        expected: 0,
        isSample: false,
        reviewNote: 'Reviewer-added negative boundary.',
      },
    ],
  };
}

describe('catalog admin review contracts', () => {
  it('strictly rejects source, runtime, and canonical vector injection', () => {
    const draft = completeDraft();
    expect(
      safeParseCatalogReviewDraftV2({
        ...draft,
        origin: { sourceRevision: 'attacker-controlled' },
      }).success
    ).toBe(false);
    expect(
      safeParseCatalogReviewDraftV2({
        ...draft,
        canonicalSelections: [
          {
            ...draft.canonicalSelections[0],
            args: [999],
            expected: 999,
          },
        ],
      }).success
    ).toBe(false);
    expect(
      safeParseCatalogReviewDraftV2({
        ...draft,
        functionProtocol: {
          ...draft.functionProtocol,
          runtimeVersion: 'client-selected-runtime',
        },
      }).success
    ).toBe(false);
  });

  it('returns a frozen, redacted provenance DTO', () => {
    const provenance = catalogSourceProvenanceFromDiscoveryDraft(
      discoveryDraftFixture()
    );

    expect(Object.isFrozen(provenance)).toBe(true);
    expect(provenance).toEqual(
      expect.objectContaining({
        provider: 'exercism',
        externalId: 'increment',
        sourceRevision: REVISION,
      })
    );
    expect(provenance).not.toHaveProperty('licenseText');
    expect(provenance).not.toHaveProperty('canonicalData');
    expect(
      catalogSourceProvenanceV1Schema.safeParse({
        ...provenance,
        licenseText: 'must not cross the DTO boundary',
      }).success
    ).toBe(false);
  });
});

describe('canonical case mapping', () => {
  it('flattens nested groups and supports named, args-wrapper, and scalar inputs', () => {
    const source = discoveryDraftFixture();
    const flattened = flattenCanonicalCases(source.upstream.canonicalData);
    const signature = completeDraft().functionProtocol.signature!;

    expect(flattened.map((item) => item.sourceTestUuid)).toEqual([
      'canonical-1',
      'canonical-2',
      'canonical-3',
    ]);
    expect(flattened[0]?.path).toBe('canonicalData.cases.0.cases.0');
    expect(canonicalInputToArgs({ value: 3 }, signature)).toEqual([3]);
    expect(canonicalInputToArgs({ args: [3] }, signature)).toEqual([3]);
    expect(canonicalInputToArgs(3, signature)).toEqual([3]);
    expect(canonicalInputToArgs('3', signature)).toBeUndefined();
  });

  it('derives vectors solely from canonical UUID selections', () => {
    const source = discoveryDraftFixture();
    const draft = completeDraft();
    const result = mapCanonicalSelectionsToTests(
      draft.canonicalSelections,
      source.upstream.canonicalData,
      draft.functionProtocol.signature!
    );

    expect(result.blockers).toEqual([]);
    expect(result.tests).toEqual([
      {
        id: 'inc-1',
        args: [1],
        expected: 2,
        isSample: true,
        sourceKind: 'canonical',
        sourceTestUuid: 'canonical-1',
      },
      {
        id: 'inc-2',
        args: [4],
        expected: 5,
        isSample: false,
        sourceKind: 'canonical',
        sourceTestUuid: 'canonical-2',
      },
      {
        id: 'inc-3',
        args: [0],
        expected: 1,
        isSample: false,
        sourceKind: 'canonical',
        sourceTestUuid: 'canonical-3',
      },
    ]);
  });

  it('lists mapped and unmappable options in source order and defaults to 12', () => {
    const canonicalData: CatalogJsonValue = {
      cases: [
        ...Array.from({ length: 14 }, (_, index) => ({
          uuid: `case-${index + 1}`,
          input: index,
          expected: index + 1,
        })),
        { uuid: 'missing-input', expected: 0 },
      ],
    };
    const signature = completeDraft().functionProtocol.signature!;
    const options = listCanonicalCaseOptions(canonicalData, signature);
    const selections = createDefaultCanonicalSelections(options);

    expect(options).toHaveLength(15);
    expect(options[0]).toEqual(
      expect.objectContaining({
        sourceTestUuid: 'case-1',
        sourceOrder: 0,
        status: 'mapped',
        args: [0],
        expected: 1,
      })
    );
    expect(options[14]).toEqual(
      expect.objectContaining({
        sourceOrder: 14,
        status: 'unmappable',
        reason: 'canonical_input_missing',
      })
    );
    expect(selections).toHaveLength(12);
    expect(selections[0]).toEqual({
      sourceTestUuid: 'case-1',
      id: 'canonical-1',
      isSample: true,
    });
    expect(selections.slice(1).every((item) => !item.isSample)).toBe(true);
    expect(selections.at(-1)?.sourceTestUuid).toBe('case-12');
  });

  it('rejects canonical expected values that do not match the return TypeSpec', () => {
    const source = discoveryDraftFixture();
    const draft = completeDraft();
    const canonicalData = structuredClone(source.upstream.canonicalData) as {
      cases: Array<{ cases: Array<{ expected: CatalogJsonValue }> }>;
    };
    canonicalData.cases[0]!.cases[0]!.expected = '2';

    expect(
      listCanonicalCaseOptions(
        canonicalData,
        draft.functionProtocol.signature
      )[0]
    ).toEqual(
      expect.objectContaining({
        status: 'unmappable',
        reason: 'canonical_expected_type_mismatch',
      })
    );
    expect(
      mapCanonicalSelectionsToTests(
        draft.canonicalSelections,
        canonicalData,
        draft.functionProtocol.signature!
      ).blockers
    ).toContainEqual(
      expect.objectContaining({
        code: 'canonical_expected_type_mismatch',
        path: 'canonicalSelections.0.sourceTestUuid',
      })
    );
  });
});

describe('CatalogReviewDraftV2 domain helpers', () => {
  it('generates three starter templates from shared types and per-language entry points', () => {
    const templates = generateCatalogReviewStarterTemplates(
      completeDraft().functionProtocol.signature!,
      {
        javascript: 'increment',
        python: 'increment_value',
        typescript: 'increment',
      }
    );

    expect(templates.javascript).toContain('function increment(value)');
    expect(templates.python).toContain('def increment_value(value):');
    expect(templates.typescript).toContain(
      'function increment(value: number): number'
    );
  });

  it('accepts six-digit ids but requires three canonical selections', () => {
    const draft = completeDraft();
    draft.id = 'ex-123456';
    draft.canonicalSelections = draft.canonicalSelections.slice(0, 2);
    draft.manualTests.push(
      {
        id: 'manual-2',
        args: [20],
        expected: 21,
        isSample: false,
        reviewNote: 'Additional reviewed boundary.',
      },
      {
        id: 'manual-3',
        args: [30],
        expected: 31,
        isSample: false,
        reviewNote: 'Additional reviewed boundary.',
      }
    );

    const blockers = assessCatalogReviewDraftV2(draft);

    expect(blockers).not.toContainEqual(
      expect.objectContaining({ path: 'id' })
    );
    expect(blockers).toContainEqual(
      expect.objectContaining({
        code: 'insufficient_tests',
        path: 'canonicalSelections',
      })
    );
  });

  it('normalizes a discovery proposal into an editable V2 draft with blockers', () => {
    const source = discoveryDraftFixture();
    const result = normalizeCatalogReviewDraftV2(source);

    expect(catalogReviewDraftV2Schema.safeParse(result.draft).success).toBe(
      true
    );
    expect(result.draft).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        slug: 'exercism-increment',
        difficulty: 'easy',
        estimatedMinutes: null,
        canonicalSelections: [],
        manualTests: [],
      })
    );
    expect(result.draft).not.toHaveProperty('source');
    expect(result.draft).not.toHaveProperty('origin');
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'id' }),
        expect.objectContaining({ path: 'estimatedMinutes' }),
        expect.objectContaining({ code: 'insufficient_tests' }),
      ])
    );
  });

  it('rejects manual arguments and expected values that violate the signature', () => {
    const draft = completeDraft();
    draft.manualTests[0]!.args = ['-1'];
    draft.manualTests[0]!.expected = '0';

    expect(assessCatalogReviewDraftV2(draft)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'manual_test_argument_type_mismatch',
          path: 'manualTests.0.args.0',
        }),
        expect.objectContaining({
          code: 'manual_test_expected_type_mismatch',
          path: 'manualTests.0.expected',
        }),
      ])
    );
    expect(
      materializeCatalogReviewDraftV2(draft, discoveryDraftFixture()).problem
    ).toBeUndefined();
  });

  it('returns blockers instead of throwing for a malformed legacy problem', () => {
    const result = normalizeCatalogReviewDraftV2({
      languageConfigs: {},
      tests: [],
    });

    expect(result.draft.schemaVersion).toBe(2);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: 'invalid_contract' })
    );
  });

  it('materializes authoritative vectors, runtime contracts, hashes, and origin', () => {
    const source = discoveryDraftFixture();
    const sourceBefore = structuredClone(source);
    const draft = completeDraft();
    const result = materializeCatalogReviewDraftV2(draft, source);

    expect(result.blockers).toEqual([]);
    expect(result.problem?.tests).toEqual([
      expect.objectContaining({
        id: 'inc-1',
        args: [1],
        expected: 2,
        sourceTestUuid: 'canonical-1',
      }),
      expect.objectContaining({
        id: 'inc-2',
        args: [4],
        expected: 5,
        sourceTestUuid: 'canonical-2',
      }),
      expect.objectContaining({
        id: 'inc-3',
        args: [0],
        expected: 1,
        sourceTestUuid: 'canonical-3',
      }),
      expect.objectContaining({
        id: 'inc-manual',
        sourceKind: 'manual',
        reviewNote: 'Reviewer-added negative boundary.',
      }),
    ]);
    expect(result.problem?.languageConfigs.javascript).toEqual(
      expect.objectContaining(CATALOG_RUNTIME_CONTRACTS.javascript)
    );
    expect(result.problem?.languageConfigs.python).toEqual(
      expect.objectContaining(CATALOG_RUNTIME_CONTRACTS.python)
    );
    expect(result.problem?.origin).toEqual(
      expect.objectContaining({
        externalId: source.externalId,
        sourceRevision: source.source.revision,
        upstreamUrl: source.source.upstreamUrl,
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      })
    );
    expect(result.provenance).not.toHaveProperty('licenseText');
    expect(source).toEqual(sourceBefore);

    const roundTrip = normalizeCatalogReviewDraftV2(result.problem);
    expect(Object.keys(roundTrip.draft.canonicalSelections[0]!).sort()).toEqual(
      ['id', 'isSample', 'sourceTestUuid']
    );
  });

  it('omits empty optional learning objectives from the raw problem', () => {
    const draft = completeDraft();
    draft.learningObjectives = [];

    const result = materializeCatalogReviewDraftV2(
      draft,
      discoveryDraftFixture()
    );

    expect(result.blockers).toEqual([]);
    expect(result.problem).not.toHaveProperty('learningObjectives');
  });

  it('blocks materialization when persisted facts disagree with raw evidence', () => {
    const source = discoveryDraftFixture();
    const facts: CatalogReviewRawCandidateFactsV1 = {
      externalId: source.externalId,
      upstreamUrl: source.source.upstreamUrl,
      sourceRevision: 'f'.repeat(40),
      licenseSpdx: source.source.licenseSpdx,
      attribution: source.source.attribution,
      rawPayload: source,
    };

    const result = materializeCatalogReviewDraftV2(completeDraft(), facts);

    expect(result.problem).toBeUndefined();
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: 'immutable_source_mismatch' })
    );
  });
});
