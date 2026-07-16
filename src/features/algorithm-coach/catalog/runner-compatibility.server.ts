import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { Worker as NodeWorker } from 'node:worker_threads';
import { version as PYODIDE_PACKAGE_VERSION } from 'pyodide';
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';

import { compileTypeScript } from '../runner/typescript';
import type {
  CatalogLanguage,
  CatalogTestCase,
  RawCatalogProblem,
} from './raw-types';

const LANGUAGE_ORDER: CatalogLanguage[] = [
  'javascript',
  'python',
  'typescript',
];
const EXPECTED_RUNNERS = {
  javascript: 'quickjs',
  python: 'pyodide',
  typescript: 'typescript-quickjs',
} as const;
const EXPECTED_RUNTIME_VERSIONS = {
  javascript: 'quickjs-emscripten@0.32.0',
  python: `pyodide@${PYODIDE_PACKAGE_VERSION}`,
  typescript: 'typescript@5.9.2 / quickjs-emscripten@0.32.0',
} as const;
export const CATALOG_RUNNER_VALIDATION_VERSION = 'catalog-runner-validation-v1';
const QUICKJS_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
const RUNTIME_EXECUTION_TIMEOUT_MS = 2_800;
const RUNTIME_STARTUP_TIMEOUT_MS = 30_000;
const MAX_TEMPLATE_LENGTH = 30_000;
const MAX_TEST_COUNT = 1_000;
const MAX_ERROR_LENGTH = 1_000;

export type CatalogRunnerCompatibilityIssueCode =
  | 'invalid_runtime_contract'
  | 'invalid_test_vector'
  | 'starter_compile_failed'
  | 'starter_load_failed'
  | 'starter_entry_missing'
  | 'starter_entry_incompatible'
  | 'oracle_compile_failed'
  | 'oracle_execution_failed'
  | 'oracle_test_failed'
  | 'runtime_load_failed'
  | 'runtime_timeout'
  | 'runtime_protocol_error';

export interface CatalogRunnerCompatibilityIssue {
  code: CatalogRunnerCompatibilityIssueCode;
  stage: 'contract' | 'starter' | 'oracle' | 'runtime';
  message: string;
  language?: CatalogLanguage;
  path?: string;
  testId?: string;
}

export interface CatalogRunnerCompatibilityCheck {
  language: CatalogLanguage;
  runner: string;
  runtimeVersion: string;
  starter: {
    loaded: boolean;
    entryPointFound: boolean;
    compatible: boolean;
    durationMs: number;
  };
  oracle: {
    executedTests: number;
    passedTests: number;
    durationMs: number;
  };
}

export interface CatalogRunnerCompatibilityResult {
  valid: boolean;
  problemSlug: string;
  testCount: number;
  checks: CatalogRunnerCompatibilityCheck[];
  issues: CatalogRunnerCompatibilityIssue[];
}

type RuntimeTestResult = {
  testId: string;
  passed: boolean;
  error?: string;
};

type OracleHarnessResult = {
  testResults: RuntimeTestResult[];
};

type StarterProbeResult = {
  entryExists: boolean;
  compatible: boolean;
  kind?: string;
};

type PythonWorkerMessage =
  | { type: 'ready' }
  | { type: 'oracle'; raw: string; durationMs: number }
  | { type: 'starter'; raw: string; durationMs: number }
  | {
      type: 'phase_error';
      phase: 'oracle' | 'starter';
      error: string;
      durationMs: number;
    }
  | { type: 'fatal'; error: string };

type PythonRuntimeResult = {
  oracle?: { raw?: string; error?: string; durationMs: number };
  starter?: { raw?: string; error?: string; durationMs: number };
  fatalError?: string;
  timedOutStage?: 'runtime' | 'oracle' | 'starter';
};

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function safeMessage(error: unknown): string {
  let message: string;
  if (error instanceof Error) {
    message = `${error.name}: ${error.message}`;
  } else if (error && typeof error === 'object') {
    const value = error as { name?: unknown; message?: unknown };
    const name = typeof value.name === 'string' ? value.name : '';
    const detail = typeof value.message === 'string' ? value.message : '';
    message = [name, detail].filter(Boolean).join(': ') || String(error);
  } else {
    message = String(error);
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_LENGTH);
}

function issue(
  code: CatalogRunnerCompatibilityIssueCode,
  stage: CatalogRunnerCompatibilityIssue['stage'],
  message: string,
  options: Pick<
    CatalogRunnerCompatibilityIssue,
    'language' | 'path' | 'testId'
  > = {}
): CatalogRunnerCompatibilityIssue {
  return { code, stage, message, ...options };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : isPlainObject(value) &&
      Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function validatedTests(
  problem: RawCatalogProblem,
  issues: CatalogRunnerCompatibilityIssue[]
): CatalogTestCase[] | undefined {
  if (
    !Array.isArray(problem.tests) ||
    problem.tests.length === 0 ||
    problem.tests.length > MAX_TEST_COUNT
  ) {
    issues.push(
      issue(
        'invalid_test_vector',
        'contract',
        `A release must contain between 1 and ${MAX_TEST_COUNT} JSON test vectors.`,
        { path: 'tests' }
      )
    );
    return undefined;
  }

  let valid = true;
  problem.tests.forEach((test, index) => {
    if (
      !test ||
      typeof test.id !== 'string' ||
      !test.id ||
      !Array.isArray(test.args) ||
      !isJsonValue(test.args) ||
      !isJsonValue(test.expected)
    ) {
      valid = false;
      issues.push(
        issue(
          'invalid_test_vector',
          'contract',
          'The test id, arguments, and expected value must use the JSON function protocol.',
          { path: `tests.${index}`, testId: test?.id }
        )
      );
    }
  });
  return valid ? problem.tests : undefined;
}

function emptyCheck(
  language: CatalogLanguage,
  problem: RawCatalogProblem
): CatalogRunnerCompatibilityCheck {
  const config = problem.languageConfigs[language];
  return {
    language,
    runner: config?.runner ?? 'missing',
    runtimeVersion: config?.runtimeVersion ?? 'missing',
    starter: {
      loaded: false,
      entryPointFound: false,
      compatible: false,
      durationMs: 0,
    },
    oracle: { executedTests: 0, passedTests: 0, durationMs: 0 },
  };
}

function validLanguageContract(
  problem: RawCatalogProblem,
  language: CatalogLanguage,
  issues: CatalogRunnerCompatibilityIssue[]
): boolean {
  const config = problem.languageConfigs[language];
  const path = `languageConfigs.${language}`;
  let valid = true;
  if (!config || config.runner !== EXPECTED_RUNNERS[language]) {
    valid = false;
    issues.push(
      issue(
        'invalid_runtime_contract',
        'contract',
        `${language} must use the ${EXPECTED_RUNNERS[language]} runner.`,
        { language, path }
      )
    );
  }
  if (
    !config ||
    config.runtimeVersion !== EXPECTED_RUNTIME_VERSIONS[language]
  ) {
    valid = false;
    issues.push(
      issue(
        'invalid_runtime_contract',
        'contract',
        `${language} must target ${EXPECTED_RUNTIME_VERSIONS[language]}.`,
        { language, path: `${path}.runtimeVersion` }
      )
    );
  }
  if (!config || !/^[A-Za-z_$][\w$]*$/.test(config.entryPoint)) {
    valid = false;
    issues.push(
      issue(
        'invalid_runtime_contract',
        'contract',
        `${language} has an invalid function entry point.`,
        { language, path: `${path}.entryPoint` }
      )
    );
  }
  if (
    !config ||
    typeof config.template !== 'string' ||
    !config.template.trim() ||
    config.template.length > MAX_TEMPLATE_LENGTH
  ) {
    valid = false;
    issues.push(
      issue(
        'invalid_runtime_contract',
        'contract',
        `${language} starter must contain 1-${MAX_TEMPLATE_LENGTH} characters.`,
        { language, path: `${path}.template` }
      )
    );
  }
  return valid;
}

function ecmaStarterProbe(source: string, entryPoint: string): string {
  return [
    source,
    `(() => {`,
    `  const entry = globalThis[${JSON.stringify(entryPoint)}];`,
    `  if (typeof entry !== 'function') return { entryExists: false, compatible: false };`,
    `  const kind = entry.constructor && entry.constructor.name || 'Function';`,
    `  const rendered = Function.prototype.toString.call(entry);`,
    `  const compatible = kind === 'Function' && !/^class\\s/.test(rendered);`,
    `  return { entryExists: true, compatible, kind };`,
    `})()`,
  ].join('\n');
}

function ecmaOracleSource(
  entryPoint: string,
  tests: CatalogTestCase[],
  language: 'javascript' | 'typescript'
): string {
  const assignment =
    language === 'typescript'
      ? `(globalThis as Record<string, unknown>)[${JSON.stringify(entryPoint)}] = (...args: unknown[]): unknown => {`
      : `globalThis[${JSON.stringify(entryPoint)}] = (...args) => {`;
  return [
    `const __algocoachOracleCases = ${JSON.stringify(tests)};`,
    `const __algocoachCanonical = (value${language === 'typescript' ? ': any' : ''})${language === 'typescript' ? ': any' : ''} => {`,
    `  if (Array.isArray(value)) return value.map(__algocoachCanonical);`,
    `  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, __algocoachCanonical(value[key])]));`,
    `  return value;`,
    `};`,
    `const __algocoachKey = (value${language === 'typescript' ? ': any' : ''}) => JSON.stringify(__algocoachCanonical(value));`,
    assignment,
    `  const match = __algocoachOracleCases.find((test) => __algocoachKey(test.args) === __algocoachKey(args));`,
    `  if (!match) throw new Error('Oracle received an unknown test vector.');`,
    `  return JSON.parse(JSON.stringify(match.expected));`,
    `};`,
  ].join('\n');
}

function ecmaTestHarness(
  source: string,
  entryPoint: string,
  tests: CatalogTestCase[]
): string {
  return [
    source,
    `(() => {`,
    `  const entry = globalThis[${JSON.stringify(entryPoint)}];`,
    `  if (typeof entry !== 'function') throw new Error('Expected oracle entry function was not defined.');`,
    `  const tests = ${JSON.stringify(tests)};`,
    `  const equal = (left, right) => {`,
    `    if (Object.is(left, right)) return true;`,
    `    if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => equal(value, right[index]));`,
    `    if (left && right && typeof left === 'object' && typeof right === 'object') {`,
    `      const leftKeys = Object.keys(left).sort();`,
    `      const rightKeys = Object.keys(right).sort();`,
    `      return equal(leftKeys, rightKeys) && leftKeys.every((key) => equal(left[key], right[key]));`,
    `    }`,
    `    return false;`,
    `  };`,
    `  const results = tests.map((test) => {`,
    `    try {`,
    `      const actual = entry(...test.args);`,
    `      return { testId: test.id, passed: equal(actual, test.expected) };`,
    `    } catch (error) {`,
    `      return { testId: test.id, passed: false, error: error instanceof Error ? error.message : String(error) };`,
    `    }`,
    `  });`,
    `  return { testResults: results };`,
    `})()`,
  ].join('\n');
}

function parseStarterProbe(value: unknown): StarterProbeResult | undefined {
  if (!isPlainObject(value)) return undefined;
  return typeof value.entryExists === 'boolean' &&
    typeof value.compatible === 'boolean'
    ? {
        entryExists: value.entryExists,
        compatible: value.compatible,
        kind: typeof value.kind === 'string' ? value.kind : undefined,
      }
    : undefined;
}

function parseOracleResult(value: unknown): OracleHarnessResult | undefined {
  if (!isPlainObject(value) || !Array.isArray(value.testResults)) {
    return undefined;
  }
  const testResults = value.testResults.flatMap((result) => {
    if (
      !isPlainObject(result) ||
      typeof result.testId !== 'string' ||
      typeof result.passed !== 'boolean'
    ) {
      return [];
    }
    return [
      {
        testId: result.testId,
        passed: result.passed,
        error: typeof result.error === 'string' ? result.error : undefined,
      },
    ];
  });
  return testResults.length === value.testResults.length
    ? { testResults }
    : undefined;
}

function quickJsEvaluate(
  QuickJS: Awaited<ReturnType<typeof getQuickJS>>,
  source: string
): unknown {
  return QuickJS.evalCode(source, {
    memoryLimitBytes: QUICKJS_MEMORY_LIMIT_BYTES,
    shouldInterrupt: shouldInterruptAfterDeadline(
      Date.now() + RUNTIME_EXECUTION_TIMEOUT_MS
    ),
  });
}

async function validateEcmaLanguage(
  problem: RawCatalogProblem,
  language: 'javascript' | 'typescript',
  tests: CatalogTestCase[] | undefined,
  check: CatalogRunnerCompatibilityCheck,
  issues: CatalogRunnerCompatibilityIssue[],
  QuickJS: Awaited<ReturnType<typeof getQuickJS>>
): Promise<void> {
  const config = problem.languageConfigs[language];
  let starterSource = config.template;
  const starterStartedAt = performance.now();
  if (language === 'typescript') {
    const compiled = compileTypeScript(starterSource);
    if (!compiled.ok) {
      check.starter.durationMs = elapsed(starterStartedAt);
      issues.push(
        issue('starter_compile_failed', 'starter', compiled.error, {
          language,
          path: `languageConfigs.${language}.template`,
        })
      );
    } else {
      starterSource = compiled.code;
    }
  }

  if (
    language !== 'typescript' ||
    !issues.some(
      (item) =>
        item.language === language && item.code === 'starter_compile_failed'
    )
  ) {
    try {
      const probe = parseStarterProbe(
        quickJsEvaluate(
          QuickJS,
          ecmaStarterProbe(starterSource, config.entryPoint)
        )
      );
      check.starter.durationMs = elapsed(starterStartedAt);
      if (!probe) {
        issues.push(
          issue(
            'runtime_protocol_error',
            'starter',
            `${language} starter probe returned an invalid payload.`,
            { language }
          )
        );
      } else {
        check.starter.loaded = true;
        check.starter.entryPointFound = probe.entryExists;
        check.starter.compatible = probe.compatible;
        if (!probe.entryExists) {
          issues.push(
            issue(
              'starter_entry_missing',
              'starter',
              `${language} starter did not expose ${config.entryPoint} to the runtime harness.`,
              {
                language,
                path: `languageConfigs.${language}.entryPoint`,
              }
            )
          );
        } else if (!probe.compatible) {
          issues.push(
            issue(
              'starter_entry_incompatible',
              'starter',
              `${language} starter entry uses unsupported callable kind ${probe.kind ?? 'unknown'}.`,
              {
                language,
                path: `languageConfigs.${language}.template`,
              }
            )
          );
        }
      }
    } catch (error) {
      check.starter.durationMs = elapsed(starterStartedAt);
      const message = safeMessage(error);
      issues.push(
        issue(
          /interrupted/i.test(message)
            ? 'runtime_timeout'
            : 'starter_load_failed',
          'starter',
          message,
          { language, path: `languageConfigs.${language}.template` }
        )
      );
    }
  }

  if (!tests) return;
  const oracleStartedAt = performance.now();
  let oracleSource = ecmaOracleSource(config.entryPoint, tests, language);
  if (language === 'typescript') {
    const compiled = compileTypeScript(oracleSource);
    if (!compiled.ok) {
      check.oracle.durationMs = elapsed(oracleStartedAt);
      issues.push(
        issue('oracle_compile_failed', 'oracle', compiled.error, { language })
      );
      return;
    }
    oracleSource = compiled.code;
  }
  try {
    const result = parseOracleResult(
      quickJsEvaluate(
        QuickJS,
        ecmaTestHarness(oracleSource, config.entryPoint, tests)
      )
    );
    check.oracle.durationMs = elapsed(oracleStartedAt);
    if (!result) {
      issues.push(
        issue(
          'runtime_protocol_error',
          'oracle',
          `${language} oracle harness returned an invalid payload.`,
          { language }
        )
      );
      return;
    }
    check.oracle.executedTests = result.testResults.length;
    check.oracle.passedTests = result.testResults.filter(
      (test) => test.passed
    ).length;
    for (const resultItem of result.testResults) {
      if (resultItem.passed) continue;
      issues.push(
        issue(
          'oracle_test_failed',
          'oracle',
          resultItem.error
            ? `Oracle test failed: ${safeMessage(resultItem.error)}`
            : 'Oracle output did not survive the runtime harness unchanged.',
          { language, testId: resultItem.testId }
        )
      );
    }
  } catch (error) {
    check.oracle.durationMs = elapsed(oracleStartedAt);
    const message = safeMessage(error);
    issues.push(
      issue(
        /interrupted/i.test(message)
          ? 'runtime_timeout'
          : 'oracle_execution_failed',
        'oracle',
        message,
        { language }
      )
    );
  }
}

const PYTHON_ORACLE_SOURCE = String.raw`
import json as __algocoach_json

__algocoach_cases = __algocoach_json.loads(__algocoach_tests_json)

def __algocoach_key(value):
    return __algocoach_json.dumps(
        value,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )

def __algocoach_oracle(*args):
    key = __algocoach_key(list(args))
    for case in __algocoach_cases:
        if __algocoach_key(case["args"]) == key:
            return __algocoach_json.loads(__algocoach_json.dumps(case["expected"]))
    raise RuntimeError("Oracle received an unknown test vector.")
`;

const PYTHON_ORACLE_HARNESS = String.raw`
import contextlib
import io
import json

namespace = {"__algocoach_tests_json": __algocoach_tests_json}
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    exec(compile(__algocoach_oracle_code, "<oracle>", "exec"), namespace)
entry = namespace.get("__algocoach_oracle")
tests = json.loads(__algocoach_tests_json)
results = []
for test in tests:
    try:
        actual = entry(*test["args"])
        results.append({
            "testId": test["id"],
            "passed": actual == test["expected"],
        })
    except Exception as exc:
        results.append({
            "testId": test["id"],
            "passed": False,
            "error": f"{type(exc).__name__}: {exc}",
        })
json.dumps({"testResults": results})
`;

const PYTHON_STARTER_HARNESS = String.raw`
import contextlib
import inspect
import io
import json

namespace = {}
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    exec(compile(__algocoach_starter_code, "<starter>", "exec"), namespace)
entry = namespace.get(__algocoach_entry_point)
entry_exists = callable(entry)
compatible = bool(
    entry_exists
    and not inspect.isclass(entry)
    and not inspect.iscoroutinefunction(entry)
    and not inspect.isgeneratorfunction(entry)
    and not inspect.isasyncgenfunction(entry)
)
kind = type(entry).__name__ if entry_exists else None
json.dumps({
    "entryExists": entry_exists,
    "compatible": compatible,
    "kind": kind,
})
`;

const PYTHON_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');

function errorMessage(error) {
  if (error instanceof Error) return error.name + ': ' + error.message;
  return String(error);
}

(async () => {
  const { loadPyodide } = await import('pyodide');
  const pyodide = await loadPyodide({ indexURL: workerData.indexURL });
  parentPort.postMessage({ type: 'ready' });
  pyodide.globals.set('__algocoach_tests_json', workerData.testsJson);

  let startedAt = performance.now();
  try {
    pyodide.globals.set('__algocoach_oracle_code', workerData.oracleCode);
    const raw = await pyodide.runPythonAsync(workerData.oracleHarness);
    parentPort.postMessage({
      type: 'oracle',
      raw: String(raw),
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'phase_error',
      phase: 'oracle',
      error: errorMessage(error),
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
  }

  startedAt = performance.now();
  try {
    pyodide.globals.set('__algocoach_starter_code', workerData.starterCode);
    pyodide.globals.set('__algocoach_entry_point', workerData.entryPoint);
    const raw = await pyodide.runPythonAsync(workerData.starterHarness);
    parentPort.postMessage({
      type: 'starter',
      raw: String(raw),
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'phase_error',
      phase: 'starter',
      error: errorMessage(error),
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
  }
})().catch((error) => {
  parentPort.postMessage({ type: 'fatal', error: errorMessage(error) });
});
`;

function pyodideIndexUrl(): string {
  const require = createRequire(import.meta.url);
  return `${dirname(require.resolve('pyodide/package.json'))}/`;
}

function executePythonRuntime(
  config: RawCatalogProblem['languageConfigs']['python'],
  tests: CatalogTestCase[]
): Promise<PythonRuntimeResult> {
  return new Promise((resolve) => {
    const result: PythonRuntimeResult = {};
    let settled = false;
    let activeStage: 'runtime' | 'oracle' | 'starter' = 'runtime';
    let executionTimer: ReturnType<typeof setTimeout> | undefined;
    const worker = new NodeWorker(PYTHON_WORKER_SOURCE, {
      eval: true,
      workerData: {
        indexURL: pyodideIndexUrl(),
        testsJson: JSON.stringify(tests),
        oracleCode: PYTHON_ORACLE_SOURCE,
        oracleHarness: PYTHON_ORACLE_HARNESS,
        starterCode: config.template,
        starterHarness: PYTHON_STARTER_HARNESS,
        entryPoint: config.entryPoint,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 8,
      },
    });

    const startupTimer = setTimeout(() => {
      result.timedOutStage = 'runtime';
      finish();
    }, RUNTIME_STARTUP_TIMEOUT_MS);

    function armExecutionTimer(stage: 'oracle' | 'starter') {
      activeStage = stage;
      if (executionTimer) clearTimeout(executionTimer);
      executionTimer = setTimeout(() => {
        result.timedOutStage = stage;
        finish();
      }, RUNTIME_EXECUTION_TIMEOUT_MS);
    }

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (executionTimer) clearTimeout(executionTimer);
      void worker.terminate();
      resolve(result);
    }

    worker.on('message', (message: PythonWorkerMessage) => {
      if (settled) return;
      if (message.type === 'ready') {
        clearTimeout(startupTimer);
        armExecutionTimer('oracle');
        return;
      }
      if (message.type === 'oracle') {
        result.oracle = {
          raw: message.raw,
          durationMs: message.durationMs,
        };
        armExecutionTimer('starter');
        return;
      }
      if (message.type === 'starter') {
        result.starter = {
          raw: message.raw,
          durationMs: message.durationMs,
        };
        finish();
        return;
      }
      if (message.type === 'phase_error') {
        result[message.phase] = {
          error: message.error,
          durationMs: message.durationMs,
        };
        if (message.phase === 'oracle') {
          armExecutionTimer('starter');
        } else {
          finish();
        }
        return;
      }
      result.fatalError = message.error;
      finish();
    });
    worker.on('error', (error) => {
      result.fatalError = safeMessage(error);
      finish();
    });
    worker.on('exit', (code) => {
      if (settled) return;
      result.fatalError = `Python runtime exited during ${activeStage} with code ${code}.`;
      finish();
    });
  });
}

function parseJsonPayload(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function validatePythonLanguage(
  problem: RawCatalogProblem,
  tests: CatalogTestCase[] | undefined,
  check: CatalogRunnerCompatibilityCheck,
  issues: CatalogRunnerCompatibilityIssue[]
): Promise<void> {
  const language = 'python' as const;
  const config = problem.languageConfigs.python;
  if (!tests) {
    issues.push(
      issue(
        'oracle_execution_failed',
        'oracle',
        'Python oracle was skipped because the test vectors are invalid.',
        { language }
      )
    );
  }
  let runtime: PythonRuntimeResult;
  try {
    runtime = await executePythonRuntime(config, tests ?? []);
  } catch (error) {
    issues.push(
      issue('runtime_load_failed', 'runtime', safeMessage(error), { language })
    );
    return;
  }
  if (
    runtime.timedOutStage === 'runtime' ||
    runtime.timedOutStage === 'oracle'
  ) {
    issues.push(
      issue(
        'runtime_timeout',
        runtime.timedOutStage === 'runtime' ? 'runtime' : runtime.timedOutStage,
        `Python ${runtime.timedOutStage} exceeded its resource deadline.`,
        { language }
      )
    );
    return;
  }
  if (runtime.fatalError) {
    issues.push(
      issue('runtime_load_failed', 'runtime', safeMessage(runtime.fatalError), {
        language,
      })
    );
    return;
  }

  if (tests) {
    check.oracle.durationMs = runtime.oracle?.durationMs ?? 0;
    if (runtime.oracle?.error) {
      issues.push(
        issue(
          'oracle_execution_failed',
          'oracle',
          safeMessage(runtime.oracle.error),
          { language }
        )
      );
    } else {
      const oracle = parseOracleResult(parseJsonPayload(runtime.oracle?.raw));
      if (!oracle) {
        issues.push(
          issue(
            'runtime_protocol_error',
            'oracle',
            'Python oracle harness returned an invalid payload.',
            { language }
          )
        );
      } else {
        check.oracle.executedTests = oracle.testResults.length;
        check.oracle.passedTests = oracle.testResults.filter(
          (test) => test.passed
        ).length;
        for (const resultItem of oracle.testResults) {
          if (resultItem.passed) continue;
          issues.push(
            issue(
              'oracle_test_failed',
              'oracle',
              resultItem.error
                ? `Oracle test failed: ${safeMessage(resultItem.error)}`
                : 'Oracle output did not survive the Pyodide harness unchanged.',
              { language, testId: resultItem.testId }
            )
          );
        }
      }
    }
  }

  if (runtime.timedOutStage === 'starter') {
    issues.push(
      issue(
        'runtime_timeout',
        'starter',
        'Python starter exceeded its resource deadline.',
        { language, path: 'languageConfigs.python.template' }
      )
    );
    return;
  }

  check.starter.durationMs = runtime.starter?.durationMs ?? 0;
  if (runtime.starter?.error) {
    issues.push(
      issue(
        'starter_load_failed',
        'starter',
        safeMessage(runtime.starter.error),
        { language, path: 'languageConfigs.python.template' }
      )
    );
    return;
  }
  const starter = parseStarterProbe(parseJsonPayload(runtime.starter?.raw));
  if (!starter) {
    issues.push(
      issue(
        'runtime_protocol_error',
        'starter',
        'Python starter probe returned an invalid payload.',
        { language }
      )
    );
    return;
  }
  check.starter.loaded = true;
  check.starter.entryPointFound = starter.entryExists;
  check.starter.compatible = starter.compatible;
  if (!starter.entryExists) {
    issues.push(
      issue(
        'starter_entry_missing',
        'starter',
        `Python starter did not define ${config.entryPoint}.`,
        { language, path: 'languageConfigs.python.entryPoint' }
      )
    );
  } else if (!starter.compatible) {
    issues.push(
      issue(
        'starter_entry_incompatible',
        'starter',
        `Python starter entry uses unsupported callable kind ${starter.kind ?? 'unknown'}.`,
        { language, path: 'languageConfigs.python.template' }
      )
    );
  }
}

/**
 * Release gate for the three browser runtimes. Starter functions are only
 * loaded and inspected; approved vectors are executed against generated
 * deterministic oracles in the real runtime harnesses.
 */
export async function validateCatalogRunnerCompatibility(
  problem: RawCatalogProblem
): Promise<CatalogRunnerCompatibilityResult> {
  const issues: CatalogRunnerCompatibilityIssue[] = [];
  const checks = LANGUAGE_ORDER.map((language) =>
    emptyCheck(language, problem)
  );
  const tests = validatedTests(problem, issues);
  const validContracts = new Set(
    LANGUAGE_ORDER.filter((language) =>
      validLanguageContract(problem, language, issues)
    )
  );

  let QuickJS: Awaited<ReturnType<typeof getQuickJS>> | undefined;
  if (validContracts.has('javascript') || validContracts.has('typescript')) {
    try {
      QuickJS = await getQuickJS();
    } catch (error) {
      for (const language of ['javascript', 'typescript'] as const) {
        if (!validContracts.has(language)) continue;
        issues.push(
          issue('runtime_load_failed', 'runtime', safeMessage(error), {
            language,
          })
        );
      }
    }
  }

  if (QuickJS) {
    for (const language of ['javascript', 'typescript'] as const) {
      if (!validContracts.has(language)) continue;
      await validateEcmaLanguage(
        problem,
        language,
        tests,
        checks.find((check) => check.language === language)!,
        issues,
        QuickJS
      );
    }
  }

  if (validContracts.has('python')) {
    await validatePythonLanguage(
      problem,
      tests,
      checks.find((check) => check.language === 'python')!,
      issues
    );
  }

  return {
    valid: issues.length === 0,
    problemSlug: problem.slug,
    testCount: problem.tests.length,
    checks,
    issues,
  };
}
