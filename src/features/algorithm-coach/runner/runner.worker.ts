import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';

import type {
  CodeRunResult,
  Language,
  Problem,
  TestCase,
  TestCaseResult,
} from '../types';

type WorkerPayload = {
  problem: Problem;
  language: Language;
  code: string;
  scope: 'sample' | 'all';
};

type RunnerPayload = Pick<
  CodeRunResult,
  | 'status'
  | 'passedTests'
  | 'totalTests'
  | 'testResults'
  | 'console'
  | 'error'
  | 'durationMs'
>;

const workerScope = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent<WorkerPayload>) => void) | null;
};

function selectedTests(problem: Problem, scope: 'sample' | 'all'): TestCase[] {
  return scope === 'all'
    ? problem.tests
    : problem.tests.filter((test) => test.isSample);
}

function statusFromResults(
  testResults: TestCaseResult[]
): RunnerPayload['status'] {
  if (testResults.some((test) => Boolean(test.error))) return 'runtime_error';
  return testResults.every((test) => test.passed) ? 'passed' : 'failed';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === 'object') {
    const value = error as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
    };
    const name = typeof value.name === 'string' ? value.name : '';
    const message = typeof value.message === 'string' ? value.message : '';
    if (name || message) return [name, message].filter(Boolean).join(': ');
    if (typeof value.stack === 'string') return value.stack;
    try {
      return JSON.stringify(value);
    } catch {
      return 'JavaScript execution failed.';
    }
  }
  return String(error);
}

function javascriptHarness(
  code: string,
  entryPoint: string,
  tests: TestCase[]
): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(entryPoint)) {
    throw new Error('Invalid function entry point.');
  }

  return [
    `globalThis.__logs = [];`,
    `globalThis.console = {`,
    `  log: (...args) => globalThis.__logs.push(args.map((value) => {`,
    `    try { return typeof value === 'string' ? value : JSON.stringify(value); }`,
    `    catch { return String(value); }`,
    `  }).join(' ')),`,
    `};`,
    code,
    `(() => {`,
    `  const entry = globalThis[${JSON.stringify(entryPoint)}];`,
    `  if (typeof entry !== 'function') throw new Error('Expected function ${entryPoint} was not defined.');`,
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
    `  const normalize = (value) => value === undefined ? null : JSON.parse(JSON.stringify(value));`,
    `  const results = tests.map((test) => {`,
    `    const startedAt = Date.now();`,
    `    try {`,
    `      const actual = entry(...test.args);`,
    `      return { testId: test.id, passed: equal(actual, test.expected), expected: test.expected, actual: normalize(actual), durationMs: Date.now() - startedAt };`,
    `    } catch (error) {`,
    `      return { testId: test.id, passed: false, expected: test.expected, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt };`,
    `    }`,
    `  });`,
    `  return { testResults: results, console: globalThis.__logs };`,
    `})()`,
  ].join('\n');
}

async function executeJavaScript(
  payload: WorkerPayload
): Promise<RunnerPayload> {
  const tests = selectedTests(payload.problem, payload.scope);
  const startedAt = performance.now();
  const QuickJS = await getQuickJS();
  workerScope.postMessage({ type: 'ready' });

  try {
    const result = QuickJS.evalCode(
      javascriptHarness(payload.code, payload.problem.entryPoint, tests),
      {
        memoryLimitBytes: 32 * 1024 * 1024,
        shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + 2_800),
      }
    ) as { testResults: TestCaseResult[]; console: string[] };
    const status = statusFromResults(result.testResults);

    return {
      status,
      passedTests: result.testResults.filter((test) => test.passed).length,
      totalTests: tests.length,
      testResults: result.testResults,
      console: result.console,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    };
  } catch (error) {
    const message = errorMessage(error);
    const status = /interrupted/i.test(message)
      ? 'timeout'
      : /SyntaxError/i.test(message)
        ? 'syntax_error'
        : 'runtime_error';

    return {
      status,
      passedTests: 0,
      totalTests: tests.length,
      testResults: [],
      console: [],
      error: message,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    };
  }
}

workerScope.onmessage = async (event) => {
  try {
    const result = await executeJavaScript(event.data);
    workerScope.postMessage({ type: 'result', payload: result });
  } catch (error) {
    workerScope.postMessage({
      type: 'fatal',
      error: errorMessage(error),
    });
  }
};

export {};
