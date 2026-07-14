import MarkdownIt from 'markdown-it';

import {
  calculateCandidateContentHash,
  calculateCanonicalDataHash,
  calculateProblemContentHash,
  sha256,
  stableStringify,
} from './content-hash';
import type {
  CatalogCandidateState,
  CatalogJsonValue,
  CatalogValidationIssue,
  CatalogValidationResult,
  ExercismUpstreamProblem,
  RawCatalogProblem,
} from './raw-types';

export const CATALOG_LICENSE_ALLOWLIST = new Set(['MIT']);

const PROMPT_INJECTION_RULES: Array<[RegExp, string]> = [
  [/<\|(?:system|assistant|user)\|>/i, 'model control tokens are not allowed'],
  [
    /\b(ignore|disregard)\s+(all\s+)?(previous|prior)\s+instructions\b/i,
    'prompt-injection instructions are not allowed',
  ],
];

const markdownParser = new MarkdownIt({ html: true, linkify: false });
// Preserve disallowed destinations as tokens so our explicit allowlist can audit them.
markdownParser.validateLink = () => true;

const HARD_REJECTION_CODES = new Set<CatalogValidationIssue['code']>([
  'dangerous_content',
  'duplicate_content',
  'duplicate_external_id',
  'duplicate_id',
  'duplicate_slug',
  'invalid_content_hash',
  'invalid_function_protocol',
  'invalid_license',
  'invalid_origin',
  'invalid_problem',
  'invalid_source_revision',
  'invalid_upstream_data',
]);

const FORBIDDEN_TEMPLATE_RULES: Array<[RegExp, string]> = [
  [/\bimport\s*(?:\(|\s)/, 'module imports are not allowed'],
  [/\brequire\s*\(/, 'CommonJS imports are not allowed'],
  [/\beval\s*\(/, 'eval is not allowed'],
  [/\bnew\s+Function\s*\(/, 'dynamic functions are not allowed'],
];

const TRANSITIONS: Record<CatalogCandidateState, CatalogCandidateState[]> = {
  discovered: ['quarantined', 'validated', 'rejected'],
  quarantined: ['validated', 'rejected'],
  validated: ['approved', 'rejected'],
  approved: ['published', 'rejected'],
  published: ['archived'],
  rejected: [],
  archived: ['published'],
};

function issue(
  code: CatalogValidationIssue['code'],
  message: string,
  path?: string
): CatalogValidationIssue {
  return { code, message, path };
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateSafeContent(
  value: string,
  path: string,
  issues: CatalogValidationIssue[]
) {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2060\ufeff]/g, ' ')
    .replace(/\s+/g, ' ');
  for (const [rule, message] of PROMPT_INJECTION_RULES) {
    if (rule.test(normalized)) {
      issues.push(issue('dangerous_content', message, path));
    }
  }

  const tokens = markdownParser.parse(value, {});
  const visit = (items: typeof tokens) => {
    for (const token of items) {
      if (token.type === 'html_block' || token.type === 'html_inline') {
        issues.push(
          issue('dangerous_content', 'raw HTML is not allowed', path)
        );
      }
      if (token.type === 'link_open' || token.type === 'image') {
        const attribute = token.type === 'image' ? 'src' : 'href';
        const destination = token.attrGet(attribute);
        if (
          destination !== null &&
          !isAllowedMarkdownUrl(destination, token.type === 'image')
        ) {
          issues.push(
            issue(
              'dangerous_content',
              `Markdown ${attribute} uses a disallowed URL protocol`,
              path
            )
          );
        }
      }
      if (token.children) visit(token.children);
    }
  };
  visit(tokens);
}

function isAllowedMarkdownUrl(value: string, image: boolean): boolean {
  let normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u0020\u007f\u200b-\u200f\u2060\ufeff]/g, '');
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) break;
      normalized = decoded;
    } catch {
      return false;
    }
  }
  const lower = normalized.toLowerCase();
  if (lower.startsWith('//') || lower.startsWith('\\\\')) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(lower)?.[1];
  if (!scheme) return true;
  return image
    ? scheme === 'http' || scheme === 'https'
    : scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}

function canonicalObject(
  value: CatalogJsonValue
): value is { [key: string]: CatalogJsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inspectCanonicalCases(
  value: CatalogJsonValue,
  uuids: string[],
  strings: Array<{ path: string; value: string }>,
  path = 'canonicalData'
): number {
  if (typeof value === 'string') {
    strings.push({ path, value });
    return 0;
  }
  if (Array.isArray(value)) {
    let count = 0;
    for (const [index, item] of value.entries()) {
      count += inspectCanonicalCases(item, uuids, strings, `${path}.${index}`);
    }
    return count;
  }
  if (!canonicalObject(value)) return 0;
  const uuid = value.uuid;
  if (typeof uuid === 'string') uuids.push(uuid);
  let executable =
    typeof uuid === 'string' &&
    Object.hasOwn(value, 'input') &&
    Object.hasOwn(value, 'expected')
      ? 1
      : 0;
  for (const [key, item] of Object.entries(value)) {
    executable += inspectCanonicalCases(item, uuids, strings, `${path}.${key}`);
  }
  return executable;
}

export function validateExercismUpstream(
  upstream: ExercismUpstreamProblem,
  expectedExternalId: string
): CatalogValidationResult {
  const issues: CatalogValidationIssue[] = [];
  if (upstream.externalId !== expectedExternalId) {
    issues.push(
      issue(
        'invalid_origin',
        'upstream exercise does not match the candidate origin',
        'upstream.externalId'
      )
    );
  }
  if (upstream.statementHash !== sha256(upstream.statementMarkdown)) {
    issues.push(
      issue(
        'invalid_content_hash',
        'statementHash does not match the upstream statement',
        'upstream.statementHash'
      )
    );
  }
  validateSafeContent(
    upstream.statementMarkdown,
    'upstream.statementMarkdown',
    issues
  );
  if (
    upstream.canonicalDataHash !==
    calculateCanonicalDataHash(upstream.canonicalData)
  ) {
    issues.push(
      issue(
        'invalid_content_hash',
        'canonicalDataHash does not match canonical data',
        'upstream.canonicalDataHash'
      )
    );
  }
  if (upstream.canonicalDataStatus === 'parse_error') {
    issues.push(
      issue(
        'manual_review_required',
        'canonical data could not be parsed and needs manual review',
        'upstream.canonicalData'
      )
    );
    return { valid: false, issues };
  }
  if (
    upstream.canonicalDataStatus !== 'available' ||
    !canonicalObject(upstream.canonicalData)
  ) {
    issues.push(
      issue(
        'invalid_upstream_data',
        'selected catalog problems require canonical data',
        'upstream.canonicalData'
      )
    );
    return { valid: false, issues };
  }
  if (upstream.canonicalData.exercise !== expectedExternalId) {
    issues.push(
      issue(
        'invalid_upstream_data',
        'canonical exercise does not match the candidate origin',
        'upstream.canonicalData.exercise'
      )
    );
  }
  if (!Array.isArray(upstream.canonicalData.cases)) {
    issues.push(
      issue(
        'invalid_upstream_data',
        'canonical data must include a cases array',
        'upstream.canonicalData.cases'
      )
    );
  } else {
    const uuids: string[] = [];
    const strings: Array<{ path: string; value: string }> = [];
    const executableCases = inspectCanonicalCases(
      upstream.canonicalData.cases,
      uuids,
      strings,
      'upstream.canonicalData.cases'
    );
    if (executableCases === 0) {
      issues.push(
        issue(
          'invalid_upstream_data',
          'canonical data has no executable test cases with UUIDs',
          'upstream.canonicalData.cases'
        )
      );
    }
    if (new Set(uuids).size !== uuids.length) {
      issues.push(
        issue(
          'invalid_upstream_data',
          'canonical test UUIDs must be unique',
          'upstream.canonicalData.cases'
        )
      );
    }
    for (const item of strings) {
      validateSafeContent(item.value, item.path, issues);
    }
  }
  return { valid: issues.length === 0, issues };
}

export function mergeCatalogValidationResults(
  ...results: CatalogValidationResult[]
): CatalogValidationResult {
  const issues = results
    .flatMap((result) => result.issues)
    .filter(
      (item, index, items) =>
        items.findIndex(
          (candidate) =>
            candidate.code === item.code &&
            candidate.path === item.path &&
            candidate.message === item.message
        ) === index
    );
  return { valid: issues.length === 0, issues };
}

export function validateCandidatePayload(
  problem: RawCatalogProblem,
  upstream: ExercismUpstreamProblem,
  persistedContentHash: string
): CatalogValidationResult {
  const persistedIssues: CatalogValidationIssue[] = [];
  if (
    persistedContentHash !== calculateCandidateContentHash(problem, upstream)
  ) {
    persistedIssues.push(
      issue(
        'invalid_content_hash',
        'persisted candidate hash does not match its combined content',
        'contentHash'
      )
    );
  }
  return mergeCatalogValidationResults(
    validateCatalogProblem(problem),
    validateExercismUpstream(upstream, problem.origin.externalId),
    { valid: persistedIssues.length === 0, issues: persistedIssues }
  );
}

export function candidateStateForValidation(
  result: CatalogValidationResult
): Extract<CatalogCandidateState, 'validated' | 'quarantined' | 'rejected'> {
  if (result.valid) return 'validated';
  return result.issues.some((item) => HARD_REJECTION_CODES.has(item.code))
    ? 'rejected'
    : 'quarantined';
}

function validateTemplate(
  problem: RawCatalogProblem,
  language: keyof RawCatalogProblem['languageConfigs'],
  issues: CatalogValidationIssue[]
) {
  const config = problem.languageConfigs[language];
  const template = config?.template;
  const path = `languageConfigs.${language}`;
  if (!isNonEmpty(template)) {
    issues.push(
      issue(
        'invalid_function_protocol',
        `${language} template is missing`,
        path
      )
    );
    return;
  }

  for (const [rule, message] of FORBIDDEN_TEMPLATE_RULES) {
    if (rule.test(template)) {
      issues.push(issue('invalid_function_protocol', message, path));
    }
  }

  const escapedEntryPoint = config.entryPoint.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
  const expectedName = config.entryPoint;
  if (!/^[A-Za-z_$][\w$]*$/.test(expectedName)) {
    issues.push(
      issue(
        'invalid_function_protocol',
        `${language} entryPoint is not a valid identifier`,
        `${path}.entryPoint`
      )
    );
  }
  const escapedExpectedName = expectedName.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
  const declaration =
    language === 'python'
      ? new RegExp(`\\bdef\\s+${escapedExpectedName}\\s*\\(`)
      : new RegExp(
          `(?:\\bfunction\\s+${escapedEntryPoint}\\s*\\(|\\b(?:const|let|var)\\s+${escapedEntryPoint}\\s*=)`
        );

  if (!declaration.test(template)) {
    issues.push(
      issue(
        'invalid_function_protocol',
        `${language} template must define ${expectedName}`,
        path
      )
    );
  }

  if (
    !config.signature ||
    !Array.isArray(config.signature.parameters) ||
    !config.signature.returns ||
    config.signature.parameters.some(
      (parameter) => !parameter.name || !parameter.type?.kind
    )
  ) {
    issues.push(
      issue(
        'invalid_function_protocol',
        `${language} config must include a structured signature`,
        `${path}.signature`
      )
    );
  }

  const expectedRuntime = {
    javascript: {
      monacoId: 'javascript',
      runner: 'quickjs',
      runtimeVersion: 'quickjs-emscripten@0.32.0',
    },
    typescript: {
      monacoId: 'typescript',
      runner: 'typescript-quickjs',
      runtimeVersion: 'typescript@5.9.2 / quickjs-emscripten@0.32.0',
    },
    python: {
      monacoId: 'python',
      runner: 'pyodide',
      runtimeVersion: 'pyodide@314.0.2',
    },
  }[language];
  if (
    config.monacoId !== expectedRuntime.monacoId ||
    config.runner !== expectedRuntime.runner ||
    config.runtimeVersion !== expectedRuntime.runtimeVersion
  ) {
    issues.push(
      issue(
        'invalid_function_protocol',
        `${language} config has an unsupported editor or runtime contract`,
        path
      )
    );
  }
}

export function validateCatalogProblem(
  problem: RawCatalogProblem,
  upstreamStatement?: string
): CatalogValidationResult {
  const issues: CatalogValidationIssue[] = [];

  if (!isNonEmpty(problem.id) || !/^ex-\d{3}$/.test(problem.id)) {
    issues.push(
      issue('invalid_problem', 'id must use the ex-NNN format', 'id')
    );
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(problem.slug)) {
    issues.push(issue('invalid_problem', 'slug is invalid', 'slug'));
  }
  if (!['easy', 'medium', 'hard'].includes(problem.difficulty)) {
    issues.push(
      issue('invalid_problem', 'difficulty is not supported', 'difficulty')
    );
  }
  if (problem.topics.length === 0 || problem.topics.some((topic) => !topic)) {
    issues.push(
      issue('invalid_problem', 'at least one topic is required', 'topics')
    );
  }
  if (
    !isNonEmpty(problem.title.zh) ||
    !isNonEmpty(problem.title.en) ||
    !isNonEmpty(problem.description.zh) ||
    !isNonEmpty(problem.description.en)
  ) {
    issues.push(
      issue('invalid_problem', 'bilingual title and description are required')
    );
  }

  const localizedContent = [
    ['title.zh', problem.title.zh],
    ['title.en', problem.title.en],
    ['description.zh', problem.description.zh],
    ['description.en', problem.description.en],
    ...problem.constraints.flatMap((value, index) => [
      [`constraints.${index}.zh`, value.zh] as [string, string],
      [`constraints.${index}.en`, value.en] as [string, string],
    ]),
    ...problem.hints.zh.map(
      (value, index) => [`hints.zh.${index}`, value] as [string, string]
    ),
    ...problem.hints.en.map(
      (value, index) => [`hints.en.${index}`, value] as [string, string]
    ),
    ...problem.reviewPoints.flatMap((value, index) => [
      [`reviewPoints.${index}.zh`, value.zh] as [string, string],
      [`reviewPoints.${index}.en`, value.en] as [string, string],
    ]),
    ['origin.attribution', problem.origin.attribution],
  ] as Array<[string, string]>;
  if (upstreamStatement !== undefined) {
    localizedContent.push(['upstream.statementMarkdown', upstreamStatement]);
  }
  for (const [path, value] of localizedContent) {
    validateSafeContent(value, path, issues);
  }

  if (!CATALOG_LICENSE_ALLOWLIST.has(problem.origin.licenseSpdx)) {
    issues.push(
      issue(
        'invalid_license',
        `license ${problem.origin.licenseSpdx} is not allowed`,
        'origin.licenseSpdx'
      )
    );
  }
  if (
    problem.origin.provider !== 'exercism' ||
    problem.origin.externalId.length === 0 ||
    !problem.origin.upstreamUrl.startsWith(
      'https://github.com/exercism/problem-specifications/'
    ) ||
    !problem.origin.statementPath.startsWith(
      `exercises/${problem.origin.externalId}/`
    ) ||
    problem.origin.statementPath.includes('..')
  ) {
    issues.push(
      issue('invalid_origin', 'Exercism origin is invalid', 'origin')
    );
  }
  if (!/^[a-f0-9]{40}$/.test(problem.origin.sourceRevision)) {
    issues.push(
      issue(
        'invalid_source_revision',
        'sourceRevision must be a full Git commit SHA',
        'origin.sourceRevision'
      )
    );
  }

  const content = Object.fromEntries(
    Object.entries(problem).filter(([key]) => key !== 'origin')
  ) as Omit<RawCatalogProblem, 'origin'>;
  if (problem.origin.contentHash !== calculateProblemContentHash(content)) {
    issues.push(
      issue(
        'invalid_content_hash',
        'contentHash does not match the normalized problem content',
        'origin.contentHash'
      )
    );
  }

  if (
    problem.tests.length < 3 ||
    !problem.tests.some((test) => test.isSample)
  ) {
    issues.push(
      issue(
        'invalid_function_protocol',
        'at least three tests and one sample test are required',
        'tests'
      )
    );
  }
  const testIds = new Set<string>();
  const javascriptSignature = problem.languageConfigs.javascript?.signature;
  const expectedArity = javascriptSignature?.parameters.length;
  for (const [index, test] of problem.tests.entries()) {
    if (
      !test.id ||
      testIds.has(test.id) ||
      !Array.isArray(test.args) ||
      (expectedArity !== undefined && test.args.length !== expectedArity)
    ) {
      issues.push(
        issue(
          'invalid_function_protocol',
          'test ids must be unique and args must match the function arity',
          `tests.${index}`
        )
      );
    }
    testIds.add(test.id);
    try {
      JSON.stringify({ args: test.args, expected: test.expected });
    } catch {
      issues.push(
        issue(
          'invalid_function_protocol',
          'test values must be JSON serializable',
          `tests.${index}`
        )
      );
    }
  }

  validateTemplate(problem, 'javascript', issues);
  validateTemplate(problem, 'python', issues);
  validateTemplate(problem, 'typescript', issues);
  const signatureValues = Object.values(problem.languageConfigs).map((config) =>
    stableStringify(config.signature as unknown as CatalogJsonValue)
  );
  if (new Set(signatureValues).size !== 1) {
    issues.push(
      issue(
        'invalid_function_protocol',
        'all language configs must use the same structured signature',
        'languageConfigs'
      )
    );
  }
  if (
    problem.languageConfigs.javascript &&
    problem.languageConfigs.typescript &&
    problem.languageConfigs.javascript.entryPoint !==
      problem.languageConfigs.typescript.entryPoint
  ) {
    issues.push(
      issue(
        'invalid_function_protocol',
        'JavaScript and TypeScript entry points must match',
        'languageConfigs'
      )
    );
  }

  return { valid: issues.length === 0, issues };
}

export function validateCatalogBatch(
  problems: RawCatalogProblem[]
): Map<string, CatalogValidationResult> {
  const results = new Map(
    problems.map((problem) => [problem.slug, validateCatalogProblem(problem)])
  );
  const indexes = [
    ['id', 'duplicate_id', (problem: RawCatalogProblem) => problem.id],
    ['slug', 'duplicate_slug', (problem: RawCatalogProblem) => problem.slug],
    [
      'origin.externalId',
      'duplicate_external_id',
      (problem: RawCatalogProblem) => problem.origin.externalId,
    ],
    [
      'origin.contentHash',
      'duplicate_content',
      (problem: RawCatalogProblem) => problem.origin.contentHash,
    ],
  ] as const;

  for (const [path, code, select] of indexes) {
    const seen = new Map<string, string>();
    for (const problem of problems) {
      const value = select(problem);
      const previousSlug = seen.get(value);
      if (!previousSlug) {
        seen.set(value, problem.slug);
        continue;
      }
      for (const slug of [previousSlug, problem.slug]) {
        const result = results.get(slug)!;
        result.valid = false;
        result.issues.push(issue(code, `${path} duplicates ${value}`, path));
      }
    }
  }

  return results;
}

export function assertCandidateTransition(
  from: CatalogCandidateState,
  to: CatalogCandidateState
) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid catalog candidate transition: ${from} -> ${to}`);
  }
}
