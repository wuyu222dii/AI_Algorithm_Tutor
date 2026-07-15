import {
  CATALOG_REVIEW_DRAFT_SCHEMA_VERSION,
  catalogFunctionSignatureSchema,
  catalogReviewDraftV2Schema,
  catalogSourceProvenanceV1Schema,
  type CatalogFunctionSignature,
  type CatalogReviewDraftV2,
  type CatalogSourceProvenanceV1,
} from './admin-contracts';
import {
  mapCanonicalSelectionsToTests,
  valueMatchesCatalogTypeSpec,
  type CanonicalMappingBlocker,
} from './canonical-mapping';
import {
  calculateCanonicalDataHash,
  sha256,
  withContentHash,
} from './content-hash';
import { generateDiscoveryStarterTemplates } from './discovery-enrichment';
import type {
  CatalogLanguage,
  CatalogLanguageConfig,
  CatalogLocalizedText,
  CatalogTestCase,
  ExercismDiscoveryDraft,
  ExercismUpstreamProblem,
  RawCatalogProblem,
} from './raw-types';

const EMPTY_LOCALIZED_TEXT: CatalogLocalizedText = { zh: '', en: '' };
const PROBLEM_ID = /^ex-\d{3,6}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const BLOCKED_IDENTIFIERS = new Set([
  'Function',
  '__proto__',
  'constructor',
  'eval',
  'import',
  'prototype',
  'require',
]);

export const CATALOG_RUNTIME_CONTRACTS = Object.freeze({
  javascript: Object.freeze({
    monacoId: 'javascript',
    runner: 'quickjs',
    runtimeVersion: 'quickjs-emscripten@0.32.0',
  }),
  python: Object.freeze({
    monacoId: 'python',
    runner: 'pyodide',
    runtimeVersion: 'pyodide@314.0.2',
  }),
  typescript: Object.freeze({
    monacoId: 'typescript',
    runner: 'typescript-quickjs',
    runtimeVersion: 'typescript@5.9.2 / quickjs-emscripten@0.32.0',
  }),
} satisfies Record<
  CatalogLanguage,
  Pick<CatalogLanguageConfig, 'monacoId' | 'runner' | 'runtimeVersion'>
>);

export interface CatalogReviewBlocker {
  code:
    | 'invalid_contract'
    | 'missing_required_field'
    | 'invalid_identifier'
    | 'duplicate_test_id'
    | 'duplicate_canonical_selection'
    | 'manual_test_note_required'
    | 'manual_test_arity_mismatch'
    | 'manual_test_argument_type_mismatch'
    | 'manual_test_expected_type_mismatch'
    | 'insufficient_tests'
    | 'sample_test_required'
    | 'immutable_source_invalid'
    | 'immutable_source_mismatch'
    | CanonicalMappingBlocker['code'];
  path: string;
  message: string;
}

export interface CatalogReviewDraftNormalizationResult {
  draft: CatalogReviewDraftV2;
  blockers: CatalogReviewBlocker[];
}

export interface CatalogReviewRawCandidateFactsV1 {
  candidateId?: string;
  externalId: string;
  upstreamUrl: string;
  sourceRevision: string;
  licenseSpdx: string;
  attribution: string;
  rawPayload: ExercismDiscoveryDraft;
}

export type CatalogReviewImmutableSource =
  | ExercismDiscoveryDraft
  | CatalogReviewRawCandidateFactsV1;

export interface CatalogReviewMaterializationResult {
  problem?: RawCatalogProblem;
  upstream?: ExercismUpstreamProblem;
  provenance?: CatalogSourceProvenanceV1;
  blockers: CatalogReviewBlocker[];
}

function emptyReviewDraft(): CatalogReviewDraftV2 {
  return {
    schemaVersion: CATALOG_REVIEW_DRAFT_SCHEMA_VERSION,
    id: '',
    slug: '',
    title: { ...EMPTY_LOCALIZED_TEXT },
    description: { ...EMPTY_LOCALIZED_TEXT },
    difficulty: null,
    topics: [],
    learningObjectives: [],
    prerequisiteTopics: [],
    solutionPatterns: [],
    constraints: [],
    hints: [],
    reviewPoints: [],
    estimatedMinutes: null,
    functionProtocol: {
      signature: null,
      entryPoints: { javascript: '', python: '', typescript: '' },
      templates: { javascript: '', python: '', typescript: '' },
    },
    canonicalSelections: [],
    manualTests: [],
  };
}

export function createEmptyCatalogReviewDraftV2(): CatalogReviewDraftV2 {
  return structuredClone(emptyReviewDraft());
}

export function generateCatalogReviewStarterTemplates(
  signature: CatalogFunctionSignature,
  entryPoints: Record<CatalogLanguage, string>
): Record<CatalogLanguage, string> {
  const javascript = generateDiscoveryStarterTemplates({
    ...signature,
    entryPoint: entryPoints.javascript,
  });
  const python = generateDiscoveryStarterTemplates({
    ...signature,
    entryPoint: entryPoints.python,
  });
  return {
    javascript: javascript.javascript,
    python: python.python,
    typescript: javascript.typescript,
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function localizedText(value: unknown): CatalogLocalizedText {
  const record = objectValue(value);
  return {
    zh: typeof record?.zh === 'string' ? record.zh : '',
    en: typeof record?.en === 'string' ? record.en : '',
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function localizedArray(value: unknown): CatalogLocalizedText[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => objectValue(item) !== undefined)
    .map(localizedText);
}

function normalizedSignature(value: unknown): CatalogFunctionSignature | null {
  const record = objectValue(value);
  const parsed = catalogFunctionSignatureSchema.safeParse(
    record ? { parameters: record.parameters, returns: record.returns } : value
  );
  return parsed.success ? parsed.data : null;
}

function languageValue(value: unknown, language: CatalogLanguage): string {
  const record = objectValue(value);
  return typeof record?.[language] === 'string'
    ? (record[language] as string)
    : '';
}

function normalizeProblem(problem: RawCatalogProblem): CatalogReviewDraftV2 {
  const canonicalSelections: CatalogReviewDraftV2['canonicalSelections'] = [];
  const manualTests: CatalogReviewDraftV2['manualTests'] = [];
  for (const test of problem.tests) {
    if (test.sourceKind === 'canonical' && test.sourceTestUuid?.trim()) {
      canonicalSelections.push({
        sourceTestUuid: test.sourceTestUuid.trim(),
        id: test.id,
        isSample: test.isSample,
      });
    } else {
      manualTests.push({
        id: test.id,
        args: structuredClone(test.args),
        expected: structuredClone(test.expected),
        isSample: test.isSample,
        reviewNote: test.reviewNote?.trim() ?? '',
      });
    }
  }

  return {
    schemaVersion: CATALOG_REVIEW_DRAFT_SCHEMA_VERSION,
    id: problem.id,
    slug: problem.slug,
    title: structuredClone(problem.title),
    description: structuredClone(problem.description),
    difficulty: problem.difficulty,
    topics: [...problem.topics],
    learningObjectives: structuredClone(problem.learningObjectives ?? []),
    prerequisiteTopics: [...(problem.prerequisiteTopics ?? [])],
    solutionPatterns: [...(problem.solutionPatterns ?? [])],
    constraints: structuredClone(problem.constraints),
    hints: problem.hints.zh.map((zh, index) => ({
      zh,
      en: problem.hints.en[index] ?? '',
    })),
    reviewPoints: structuredClone(problem.reviewPoints),
    estimatedMinutes: problem.estimatedMinutes,
    functionProtocol: {
      signature: structuredClone(problem.languageConfigs.javascript.signature),
      entryPoints: {
        javascript: problem.languageConfigs.javascript.entryPoint,
        python: problem.languageConfigs.python.entryPoint,
        typescript: problem.languageConfigs.typescript.entryPoint,
      },
      templates: {
        javascript: problem.languageConfigs.javascript.template,
        python: problem.languageConfigs.python.template,
        typescript: problem.languageConfigs.typescript.template,
      },
    },
    canonicalSelections,
    manualTests,
  };
}

function normalizeProposedDraft(
  proposed: Record<string, unknown>,
  source?: ExercismDiscoveryDraft
): CatalogReviewDraftV2 {
  const functionSignature = objectValue(proposed.functionSignature);
  const entryPoint =
    typeof functionSignature?.entryPoint === 'string'
      ? functionSignature.entryPoint
      : '';
  return {
    ...emptyReviewDraft(),
    slug: source?.externalId ? `exercism-${source.externalId}` : '',
    title: localizedText(proposed.title),
    description: localizedText(proposed.description),
    difficulty: ['easy', 'medium', 'hard'].includes(String(proposed.difficulty))
      ? (proposed.difficulty as CatalogReviewDraftV2['difficulty'])
      : null,
    topics: stringArray(proposed.topics),
    learningObjectives: localizedArray(proposed.learningObjectives),
    functionProtocol: {
      signature: normalizedSignature(proposed.functionSignature),
      entryPoints: {
        javascript: entryPoint,
        python: entryPoint,
        typescript: entryPoint,
      },
      templates: {
        javascript: languageValue(proposed.starterTemplates, 'javascript'),
        python: languageValue(proposed.starterTemplates, 'python'),
        typescript: languageValue(proposed.starterTemplates, 'typescript'),
      },
    },
  };
}

function discoveryDraftFrom(
  source: CatalogReviewImmutableSource
): ExercismDiscoveryDraft {
  return 'rawPayload' in source ? source.rawPayload : source;
}

function isDiscoveryDraft(value: unknown): value is ExercismDiscoveryDraft {
  const record = objectValue(value);
  return (
    record?.schemaVersion === 1 &&
    objectValue(record.proposed) !== undefined &&
    objectValue(record.upstream) !== undefined &&
    objectValue(record.source) !== undefined
  );
}

export function assessCatalogReviewDraftV2(
  value: unknown
): CatalogReviewBlocker[] {
  const parsed = catalogReviewDraftV2Schema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((item) => ({
      code: 'invalid_contract' as const,
      path: item.path.join('.'),
      message: item.message,
    }));
  }

  const draft = parsed.data;
  const blockers: CatalogReviewBlocker[] = [];
  const requiredText: Array<[string, string]> = [
    ['title.zh', draft.title.zh],
    ['title.en', draft.title.en],
    ['description.zh', draft.description.zh],
    ['description.en', draft.description.en],
  ];
  if (!PROBLEM_ID.test(draft.id)) {
    blockers.push({
      code: 'invalid_identifier',
      path: 'id',
      message: 'Problem id must use the ex-NNN through ex-NNNNNN format.',
    });
  }
  if (!SLUG.test(draft.slug)) {
    blockers.push({
      code: 'invalid_identifier',
      path: 'slug',
      message:
        'Problem slug must contain lowercase words separated by hyphens.',
    });
  }
  requiredText.forEach(([path, text]) => {
    if (!text.trim()) {
      blockers.push({
        code: 'missing_required_field',
        path,
        message: 'Bilingual title and description values are required.',
      });
    }
  });
  if (draft.difficulty === null) {
    blockers.push({
      code: 'missing_required_field',
      path: 'difficulty',
      message: 'Difficulty must be selected before materialization.',
    });
  }
  if (draft.estimatedMinutes === null) {
    blockers.push({
      code: 'missing_required_field',
      path: 'estimatedMinutes',
      message: 'Estimated minutes must be set before materialization.',
    });
  }
  if (draft.topics.length === 0) {
    blockers.push({
      code: 'missing_required_field',
      path: 'topics',
      message: 'At least one topic is required.',
    });
  }
  if (draft.hints.length !== 3) {
    blockers.push({
      code: 'missing_required_field',
      path: 'hints',
      message: 'Exactly three bilingual hints are required.',
    });
  }
  draft.hints.forEach((hint, index) => {
    if (!hint.zh.trim() || !hint.en.trim()) {
      blockers.push({
        code: 'missing_required_field',
        path: `hints.${index}`,
        message: 'Each hint requires both languages.',
      });
    }
  });

  const signature = draft.functionProtocol.signature;
  if (signature === null) {
    blockers.push({
      code: 'missing_required_field',
      path: 'functionProtocol.signature',
      message: 'A structured function signature is required.',
    });
  }
  (['javascript', 'python', 'typescript'] as const).forEach((language) => {
    const entryPoint = draft.functionProtocol.entryPoints[language];
    if (!IDENTIFIER.test(entryPoint) || BLOCKED_IDENTIFIERS.has(entryPoint)) {
      blockers.push({
        code: 'invalid_identifier',
        path: `functionProtocol.entryPoints.${language}`,
        message: `A valid ${language} entry point is required.`,
      });
    }
    if (!draft.functionProtocol.templates[language].trim()) {
      blockers.push({
        code: 'missing_required_field',
        path: `functionProtocol.templates.${language}`,
        message: `A ${language} starter template is required.`,
      });
    }
  });
  if (
    draft.functionProtocol.entryPoints.javascript !==
    draft.functionProtocol.entryPoints.typescript
  ) {
    blockers.push({
      code: 'invalid_identifier',
      path: 'functionProtocol.entryPoints.typescript',
      message: 'JavaScript and TypeScript must use the same entry point.',
    });
  }

  const testIds = new Set<string>();
  const canonicalUuids = new Set<string>();
  const allTests = [...draft.canonicalSelections, ...draft.manualTests];
  allTests.forEach((test, index) => {
    if (testIds.has(test.id)) {
      blockers.push({
        code: 'duplicate_test_id',
        path: `tests.${index}.id`,
        message: `Test id ${test.id} is duplicated.`,
      });
    }
    testIds.add(test.id);
  });
  draft.canonicalSelections.forEach((selection, index) => {
    if (canonicalUuids.has(selection.sourceTestUuid)) {
      blockers.push({
        code: 'duplicate_canonical_selection',
        path: `canonicalSelections.${index}.sourceTestUuid`,
        message: `Canonical UUID ${selection.sourceTestUuid} is selected more than once.`,
      });
    }
    canonicalUuids.add(selection.sourceTestUuid);
  });
  draft.manualTests.forEach((test, index) => {
    if (!test.reviewNote.trim()) {
      blockers.push({
        code: 'manual_test_note_required',
        path: `manualTests.${index}.reviewNote`,
        message: 'Manual tests require an explicit review note.',
      });
    }
    if (signature) {
      if (test.args.length !== signature.parameters.length) {
        blockers.push({
          code: 'manual_test_arity_mismatch',
          path: `manualTests.${index}.args`,
          message:
            'Manual test arguments must match the reviewed function arity.',
        });
      } else {
        test.args.forEach((argument, argumentIndex) => {
          if (
            !valueMatchesCatalogTypeSpec(
              argument,
              signature.parameters[argumentIndex]!.type
            )
          ) {
            blockers.push({
              code: 'manual_test_argument_type_mismatch',
              path: `manualTests.${index}.args.${argumentIndex}`,
              message:
                'Manual test argument does not match the reviewed parameter type.',
            });
          }
        });
      }
      if (!valueMatchesCatalogTypeSpec(test.expected, signature.returns)) {
        blockers.push({
          code: 'manual_test_expected_type_mismatch',
          path: `manualTests.${index}.expected`,
          message:
            'Manual test expected value does not match the reviewed return type.',
        });
      }
    }
  });
  if (draft.canonicalSelections.length < 3) {
    blockers.push({
      code: 'insufficient_tests',
      path: 'canonicalSelections',
      message:
        'At least three canonical selections are required; manual tests may only augment them.',
    });
  }
  if (!allTests.some((test) => test.isSample)) {
    blockers.push({
      code: 'sample_test_required',
      path: 'canonicalSelections',
      message: 'At least one selected test must be marked as a sample.',
    });
  }
  return blockers;
}

/** Migrates a V2 draft, legacy normalized problem, or discovery proposal. */
export function normalizeCatalogReviewDraftV2(
  value: unknown,
  immutableSource?: CatalogReviewImmutableSource
): CatalogReviewDraftNormalizationResult {
  const current = catalogReviewDraftV2Schema.safeParse(value);
  if (current.success) {
    const draft = structuredClone(current.data);
    return { draft, blockers: assessCatalogReviewDraftV2(draft) };
  }

  let source = immutableSource
    ? discoveryDraftFrom(immutableSource)
    : undefined;
  let candidate = value;
  if (isDiscoveryDraft(value)) {
    source = value;
    candidate = value.proposed;
  }
  const wrapper = objectValue(candidate);
  if (wrapper && objectValue(wrapper.problem)) candidate = wrapper.problem;
  const record = objectValue(candidate);

  let draft: CatalogReviewDraftV2;
  try {
    if (
      record &&
      objectValue(record.languageConfigs) &&
      Array.isArray(record.tests)
    ) {
      draft = normalizeProblem(candidate as RawCatalogProblem);
    } else if (record) {
      draft = normalizeProposedDraft(record, source);
    } else {
      draft = emptyReviewDraft();
    }
  } catch {
    const fallback = emptyReviewDraft();
    return {
      draft: fallback,
      blockers: [
        {
          code: 'invalid_contract',
          path: '',
          message: 'The legacy draft could not be normalized.',
        },
        ...assessCatalogReviewDraftV2(fallback),
      ],
    };
  }

  const structural = catalogReviewDraftV2Schema.safeParse(draft);
  if (!structural.success) {
    const fallback = emptyReviewDraft();
    return {
      draft: fallback,
      blockers: [
        {
          code: 'invalid_contract',
          path: structural.error.issues[0]?.path.join('.') ?? '',
          message:
            structural.error.issues[0]?.message ??
            'The legacy draft could not be normalized.',
        },
        ...assessCatalogReviewDraftV2(fallback),
      ],
    };
  }
  return {
    draft: structural.data,
    blockers: assessCatalogReviewDraftV2(structural.data),
  };
}

function sourceBlockers(
  immutableSource: CatalogReviewImmutableSource
): CatalogReviewBlocker[] {
  const discovery = discoveryDraftFrom(immutableSource);
  const source = discovery.source;
  const upstream = discovery.upstream;
  const blockers: CatalogReviewBlocker[] = [];
  const mismatch = (path: string, message: string) =>
    blockers.push({
      code: 'immutable_source_mismatch',
      path,
      message,
    });

  const provenance = catalogSourceProvenanceV1Schema.safeParse({
    provider: source.provider,
    repository: source.repository,
    externalId: discovery.externalId,
    upstreamUrl: source.upstreamUrl,
    statementPath: source.statementPath,
    canonicalPath: source.canonicalPath,
    sourceRevision: source.revision,
    licenseSpdx: source.licenseSpdx,
    attribution: source.attribution,
    statementHash: source.statementHash,
    canonicalDataHash: source.canonicalDataHash,
    licenseContentHash: source.licenseContentHash,
    statementBlobSha: source.statementBlobSha,
    ...(source.canonicalBlobSha
      ? { canonicalBlobSha: source.canonicalBlobSha }
      : {}),
  });
  if (!provenance.success) {
    blockers.push({
      code: 'immutable_source_invalid',
      path: 'rawPayload.source',
      message:
        'Immutable source provenance does not satisfy the locked contract.',
    });
  }

  if (
    discovery.schemaVersion !== 1 ||
    discovery.externalId !== upstream.externalId ||
    source.upstreamUrl !== upstream.upstreamUrl ||
    source.statementPath !== upstream.statementPath ||
    source.statementHash !== upstream.statementHash ||
    source.canonicalPath !== upstream.canonicalPath ||
    source.canonicalDataHash !== upstream.canonicalDataHash ||
    source.statementBlobSha !== upstream.statementBlobSha ||
    source.canonicalBlobSha !== upstream.canonicalBlobSha
  ) {
    mismatch(
      'rawPayload',
      'Discovery source metadata does not match its immutable upstream payload.'
    );
  }
  if (
    upstream.statementHash !== sha256(upstream.statementMarkdown) ||
    upstream.canonicalDataHash !==
      calculateCanonicalDataHash(upstream.canonicalData) ||
    source.licenseContentHash !== sha256(source.licenseText) ||
    upstream.canonicalDataStatus !== 'available'
  ) {
    blockers.push({
      code: 'immutable_source_invalid',
      path: 'rawPayload.source',
      message: 'Immutable source hashes or canonical-data status are invalid.',
    });
  }
  if ('rawPayload' in immutableSource) {
    const facts = immutableSource;
    if (
      facts.externalId !== discovery.externalId ||
      facts.upstreamUrl !== source.upstreamUrl ||
      facts.sourceRevision !== source.revision ||
      facts.licenseSpdx !== source.licenseSpdx ||
      facts.attribution !== source.attribution
    ) {
      mismatch(
        'candidate',
        'Persisted candidate facts do not match the immutable discovery payload.'
      );
    }
  }
  return blockers;
}

export function catalogSourceProvenanceFromDiscoveryDraft(
  immutableSource: CatalogReviewImmutableSource
): CatalogSourceProvenanceV1 {
  const discovery = discoveryDraftFrom(immutableSource);
  return catalogSourceProvenanceV1Schema.parse({
    provider: discovery.source.provider,
    repository: discovery.source.repository,
    externalId: discovery.externalId,
    upstreamUrl: discovery.source.upstreamUrl,
    statementPath: discovery.source.statementPath,
    canonicalPath: discovery.source.canonicalPath,
    sourceRevision: discovery.source.revision,
    licenseSpdx: discovery.source.licenseSpdx,
    attribution: discovery.source.attribution,
    statementHash: discovery.source.statementHash,
    canonicalDataHash: discovery.source.canonicalDataHash,
    licenseContentHash: discovery.source.licenseContentHash,
    statementBlobSha: discovery.source.statementBlobSha,
    ...(discovery.source.canonicalBlobSha
      ? { canonicalBlobSha: discovery.source.canonicalBlobSha }
      : {}),
  });
}

function materializedLanguageConfigs(
  draft: CatalogReviewDraftV2,
  signature: CatalogFunctionSignature
): Record<CatalogLanguage, CatalogLanguageConfig> {
  return Object.fromEntries(
    (['javascript', 'python', 'typescript'] as const).map((language) => [
      language,
      {
        entryPoint: draft.functionProtocol.entryPoints[language],
        template: draft.functionProtocol.templates[language],
        signature: structuredClone(signature),
        ...CATALOG_RUNTIME_CONTRACTS[language],
      },
    ])
  ) as Record<CatalogLanguage, CatalogLanguageConfig>;
}

function materializedHints(
  hints: CatalogLocalizedText[]
): RawCatalogProblem['hints'] {
  return {
    zh: [hints[0]!.zh, hints[1]!.zh, hints[2]!.zh],
    en: [hints[0]!.en, hints[1]!.en, hints[2]!.en],
  };
}

/**
 * Builds a publishable candidate payload from editable review data and locked
 * source evidence. Canonical vectors, runtimes, origin, and hashes are derived
 * here and cannot be supplied by the review request.
 */
export function materializeCatalogReviewDraftV2(
  value: unknown,
  immutableSource: CatalogReviewImmutableSource
): CatalogReviewMaterializationResult {
  const parsed = catalogReviewDraftV2Schema.safeParse(value);
  if (!parsed.success) {
    return { blockers: assessCatalogReviewDraftV2(value) };
  }
  const draft = parsed.data;
  const blockers = [
    ...assessCatalogReviewDraftV2(draft),
    ...sourceBlockers(immutableSource),
  ];
  const discovery = discoveryDraftFrom(immutableSource);
  const signature = draft.functionProtocol.signature;
  if (signature) {
    const canonical = mapCanonicalSelectionsToTests(
      draft.canonicalSelections,
      discovery.upstream.canonicalData,
      signature
    );
    blockers.push(...canonical.blockers);
    if (blockers.length === 0) {
      const manualTests: CatalogTestCase[] = draft.manualTests.map((test) => ({
        id: test.id,
        args: structuredClone(test.args),
        expected: structuredClone(test.expected),
        isSample: test.isSample,
        sourceKind: 'manual',
        reviewNote: test.reviewNote.trim(),
      }));
      const problem = withContentHash({
        id: draft.id,
        slug: draft.slug,
        title: structuredClone(draft.title),
        description: structuredClone(draft.description),
        difficulty: draft.difficulty!,
        topics: [...draft.topics],
        languageConfigs: materializedLanguageConfigs(draft, signature),
        tests: [...canonical.tests, ...manualTests],
        constraints: structuredClone(draft.constraints),
        hints: materializedHints(draft.hints),
        reviewPoints: structuredClone(draft.reviewPoints),
        ...(draft.learningObjectives.length > 0
          ? {
              learningObjectives: structuredClone(draft.learningObjectives),
            }
          : {}),
        prerequisiteTopics: [...draft.prerequisiteTopics],
        solutionPatterns: [...draft.solutionPatterns],
        estimatedMinutes: draft.estimatedMinutes!,
        origin: {
          provider: 'exercism',
          externalId: discovery.externalId,
          upstreamUrl: discovery.source.upstreamUrl,
          statementPath: discovery.source.statementPath,
          licenseSpdx: 'MIT',
          attribution: discovery.source.attribution,
          sourceRevision: discovery.source.revision,
        },
      });
      return {
        problem,
        upstream: structuredClone(discovery.upstream),
        provenance: catalogSourceProvenanceFromDiscoveryDraft(immutableSource),
        blockers: [],
      };
    }
  }
  return { blockers };
}

export function materializedCandidatePayload(
  result: CatalogReviewMaterializationResult
):
  | { problem: RawCatalogProblem; upstream: ExercismUpstreamProblem }
  | undefined {
  return result.problem && result.upstream
    ? { problem: result.problem, upstream: result.upstream }
    : undefined;
}
