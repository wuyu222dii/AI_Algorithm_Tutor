import type {
  CatalogCanonicalSelectionV1,
  CatalogFunctionSignature,
} from './admin-contracts';
import type {
  CatalogJsonValue,
  CatalogTestCase,
  CatalogTypeSpec,
} from './raw-types';

export interface FlattenedCanonicalCase {
  readonly sourceTestUuid: string;
  readonly description?: string;
  readonly input?: CatalogJsonValue;
  readonly expected?: CatalogJsonValue;
  readonly hasInput: boolean;
  readonly hasExpected: boolean;
  readonly path: string;
}

export interface CanonicalMappingBlocker {
  code:
    | 'canonical_case_not_found'
    | 'canonical_case_ambiguous'
    | 'canonical_input_unmappable'
    | 'canonical_expected_missing'
    | 'canonical_expected_type_mismatch';
  path: string;
  message: string;
}

export interface CanonicalSelectionMappingResult {
  tests: CatalogTestCase[];
  blockers: CanonicalMappingBlocker[];
}

export interface CanonicalCaseOption {
  readonly sourceTestUuid: string;
  readonly description?: string;
  readonly sourceOrder: number;
  readonly status: 'mapped' | 'unmappable';
  readonly args?: CatalogJsonValue[];
  readonly expected?: CatalogJsonValue;
  readonly reason?:
    | 'function_signature_required'
    | 'canonical_input_missing'
    | 'canonical_input_unmappable'
    | 'canonical_expected_missing'
    | 'canonical_expected_type_mismatch';
}

export const DEFAULT_CANONICAL_SELECTION_LIMIT = 12;

function isJsonObject(
  value: CatalogJsonValue
): value is Record<string, CatalogJsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T extends CatalogJsonValue>(value: T): T {
  return structuredClone(value);
}

/** Flattens nested Exercism case groups without modifying canonical source data. */
export function flattenCanonicalCases(
  canonicalData: CatalogJsonValue
): FlattenedCanonicalCase[] {
  const output: FlattenedCanonicalCase[] = [];

  const visit = (value: CatalogJsonValue, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}.${index}`));
      return;
    }
    if (!isJsonObject(value)) return;

    if (typeof value.uuid === 'string') {
      const hasInput = Object.hasOwn(value, 'input');
      const hasExpected = Object.hasOwn(value, 'expected');
      output.push(
        Object.freeze({
          sourceTestUuid: value.uuid,
          ...(typeof value.description === 'string'
            ? { description: value.description }
            : {}),
          ...(hasInput ? { input: cloneJson(value.input!) } : {}),
          ...(hasExpected ? { expected: cloneJson(value.expected!) } : {}),
          hasInput,
          hasExpected,
          path,
        })
      );
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'input' || key === 'expected') continue;
      visit(child, `${path}.${key}`);
    }
  };

  visit(canonicalData, 'canonicalData');
  return output;
}

export function valueMatchesCatalogTypeSpec(
  value: CatalogJsonValue,
  type: CatalogTypeSpec
): boolean {
  switch (type.kind) {
    case 'unknown':
      return false;
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return (
        Array.isArray(value) &&
        value.every((item) => valueMatchesCatalogTypeSpec(item, type.items))
      );
    case 'object':
      return (
        isJsonObject(value) &&
        Object.entries(type.fields).every(
          ([key, fieldType]) =>
            Object.hasOwn(value, key) &&
            valueMatchesCatalogTypeSpec(value[key]!, fieldType)
        )
      );
    case 'union':
      return type.options.some((option) =>
        valueMatchesCatalogTypeSpec(value, option)
      );
  }
}

/** Maps the supported canonical input encodings to the reviewed function ABI. */
export function canonicalInputToArgs(
  input: CatalogJsonValue,
  signature: CatalogFunctionSignature
): CatalogJsonValue[] | undefined {
  const parameters = signature.parameters;
  if (parameters.length === 0) {
    return (Array.isArray(input) && input.length === 0) ||
      (isJsonObject(input) && Object.keys(input).length === 0)
      ? []
      : undefined;
  }

  if (isJsonObject(input) && Array.isArray(input.args)) {
    return input.args.length === parameters.length &&
      input.args.every((value, index) =>
        valueMatchesCatalogTypeSpec(value, parameters[index]!.type)
      )
      ? cloneJson(input.args)
      : undefined;
  }

  if (
    isJsonObject(input) &&
    parameters.every((parameter) => Object.hasOwn(input, parameter.name))
  ) {
    const args = parameters.map((parameter) => input[parameter.name]!);
    return args.every((value, index) =>
      valueMatchesCatalogTypeSpec(value, parameters[index]!.type)
    )
      ? cloneJson(args)
      : undefined;
  }

  if (parameters.length === 1) {
    return valueMatchesCatalogTypeSpec(input, parameters[0]!.type)
      ? [cloneJson(input)]
      : undefined;
  }

  if (
    Array.isArray(input) &&
    input.length === parameters.length &&
    input.every((value, index) =>
      valueMatchesCatalogTypeSpec(value, parameters[index]!.type)
    )
  ) {
    return cloneJson(input);
  }

  return undefined;
}

/** Produces review options in the exact deterministic order of the source. */
export function listCanonicalCaseOptions(
  canonicalData: CatalogJsonValue,
  signature: CatalogFunctionSignature | null
): CanonicalCaseOption[] {
  return flattenCanonicalCases(canonicalData).map((canonicalCase, index) => {
    const common = {
      sourceTestUuid: canonicalCase.sourceTestUuid,
      ...(canonicalCase.description
        ? { description: canonicalCase.description }
        : {}),
      sourceOrder: index,
    };
    if (!signature) {
      return Object.freeze({
        ...common,
        status: 'unmappable' as const,
        reason: 'function_signature_required' as const,
      });
    }
    if (!canonicalCase.hasInput) {
      return Object.freeze({
        ...common,
        status: 'unmappable' as const,
        reason: 'canonical_input_missing' as const,
      });
    }
    const args = canonicalInputToArgs(canonicalCase.input!, signature);
    if (!args) {
      return Object.freeze({
        ...common,
        status: 'unmappable' as const,
        reason: 'canonical_input_unmappable' as const,
      });
    }
    if (!canonicalCase.hasExpected) {
      return Object.freeze({
        ...common,
        status: 'unmappable' as const,
        args,
        reason: 'canonical_expected_missing' as const,
      });
    }
    if (
      !valueMatchesCatalogTypeSpec(canonicalCase.expected!, signature.returns)
    ) {
      return Object.freeze({
        ...common,
        status: 'unmappable' as const,
        args,
        expected: cloneJson(canonicalCase.expected!),
        reason: 'canonical_expected_type_mismatch' as const,
      });
    }
    return Object.freeze({
      ...common,
      status: 'mapped' as const,
      args,
      expected: cloneJson(canonicalCase.expected!),
    });
  });
}

/** Selects the first 12 mappable UUIDs and marks only the first as a sample. */
export function createDefaultCanonicalSelections(
  options: readonly CanonicalCaseOption[],
  limit = DEFAULT_CANONICAL_SELECTION_LIMIT
): CatalogCanonicalSelectionV1[] {
  const seen = new Set<string>();
  return options
    .filter((option) => {
      if (option.status !== 'mapped' || seen.has(option.sourceTestUuid)) {
        return false;
      }
      seen.add(option.sourceTestUuid);
      return true;
    })
    .slice(0, Math.max(0, Math.min(DEFAULT_CANONICAL_SELECTION_LIMIT, limit)))
    .map((option, index) => ({
      sourceTestUuid: option.sourceTestUuid,
      id: `canonical-${index + 1}`,
      isSample: index === 0,
    }));
}

/**
 * Resolves UUID-only selections against immutable canonical data. Client-provided
 * argument and expected vectors are deliberately not part of this API.
 */
export function mapCanonicalSelectionsToTests(
  selections: readonly CatalogCanonicalSelectionV1[],
  canonicalData: CatalogJsonValue,
  signature: CatalogFunctionSignature
): CanonicalSelectionMappingResult {
  const flattened = flattenCanonicalCases(canonicalData);
  const byUuid = new Map<string, FlattenedCanonicalCase[]>();
  for (const canonicalCase of flattened) {
    const matches = byUuid.get(canonicalCase.sourceTestUuid) ?? [];
    matches.push(canonicalCase);
    byUuid.set(canonicalCase.sourceTestUuid, matches);
  }

  const tests: CatalogTestCase[] = [];
  const blockers: CanonicalMappingBlocker[] = [];
  selections.forEach((selection, index) => {
    const path = `canonicalSelections.${index}`;
    const matches = byUuid.get(selection.sourceTestUuid) ?? [];
    if (matches.length === 0) {
      blockers.push({
        code: 'canonical_case_not_found',
        path: `${path}.sourceTestUuid`,
        message: `Canonical UUID ${selection.sourceTestUuid} does not exist in immutable upstream data.`,
      });
      return;
    }
    if (matches.length > 1) {
      blockers.push({
        code: 'canonical_case_ambiguous',
        path: `${path}.sourceTestUuid`,
        message: `Canonical UUID ${selection.sourceTestUuid} is duplicated in immutable upstream data.`,
      });
      return;
    }

    const canonicalCase = matches[0]!;
    if (!canonicalCase.hasInput) {
      blockers.push({
        code: 'canonical_input_unmappable',
        path: path,
        message: `Canonical UUID ${selection.sourceTestUuid} has no input vector.`,
      });
      return;
    }
    const args = canonicalInputToArgs(canonicalCase.input!, signature);
    if (!args) {
      blockers.push({
        code: 'canonical_input_unmappable',
        path: path,
        message: `Canonical UUID ${selection.sourceTestUuid} cannot be mapped exactly to the reviewed signature.`,
      });
      return;
    }
    if (!canonicalCase.hasExpected) {
      blockers.push({
        code: 'canonical_expected_missing',
        path: path,
        message: `Canonical UUID ${selection.sourceTestUuid} has no expected value.`,
      });
      return;
    }
    if (
      !valueMatchesCatalogTypeSpec(canonicalCase.expected!, signature.returns)
    ) {
      blockers.push({
        code: 'canonical_expected_type_mismatch',
        path: `${path}.sourceTestUuid`,
        message: `Canonical UUID ${selection.sourceTestUuid} expected value does not match the reviewed return type.`,
      });
      return;
    }

    tests.push({
      id: selection.id,
      args,
      expected: cloneJson(canonicalCase.expected!),
      isSample: selection.isSample,
      sourceKind: 'canonical',
      sourceTestUuid: selection.sourceTestUuid,
    });
  });

  return { tests, blockers };
}
