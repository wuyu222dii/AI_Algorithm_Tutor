import {
  getProblemContentVersion,
  getProblemLanguageConfig,
  isLanguage,
  LANGUAGE_REGISTRY,
} from '../languages';
import type { CodeRunResult, Language, Problem } from '../types';

export interface RunCodeInput {
  problem: Problem;
  language: Language;
  enabledLanguages: readonly Language[];
  code: string;
  scope?: 'sample' | 'all';
}

type WorkerResult = Pick<
  CodeRunResult,
  | 'status'
  | 'passedTests'
  | 'totalTests'
  | 'testResults'
  | 'console'
  | 'error'
  | 'durationMs'
>;

const STARTUP_TIMEOUT_MS = 30_000;
const EXECUTION_TIMEOUT_MS = 3_000;
const MAX_CODE_LENGTH = 30_000;

function runMetadata(problem: Problem, language: Language) {
  const definition = LANGUAGE_REGISTRY[language];
  return {
    problemContentVersion: getProblemContentVersion(problem),
    runtimeVersion: definition.runtimeVersion,
    runnerMode:
      definition.runner === 'remote'
        ? ('remote-judge' as const)
        : ('browser-worker' as const),
  };
}

const workerFactories: Partial<Record<Language, () => Worker>> = {
  javascript: () =>
    new Worker(new URL('./runner.worker.ts', import.meta.url), {
      name: 'algocoach-javascript-runner',
      type: 'module',
    }),
  typescript: () =>
    new Worker(new URL('./runner.worker.ts', import.meta.url), {
      name: 'algocoach-typescript-runner',
      type: 'module',
    }),
  python: () =>
    new Worker('/algorithm-coach-python-runner.mjs', {
      name: 'algocoach-python-runner',
      type: 'module',
    }),
};

function timeoutResult(
  problem: Problem,
  language: Language,
  message: string,
  totalTests = problem.tests.length
): CodeRunResult {
  return {
    problemSlug: problem.slug,
    language,
    status: 'timeout',
    passedTests: 0,
    totalTests,
    testResults: [],
    console: [],
    error: message,
    durationMs: EXECUTION_TIMEOUT_MS,
    executedAt: new Date().toISOString(),
    ...runMetadata(problem, language),
  };
}

export async function runCode({
  problem,
  language,
  enabledLanguages,
  code,
  scope = 'sample',
}: RunCodeInput): Promise<CodeRunResult> {
  if (!isLanguage(language)) {
    return {
      problemSlug: problem.slug,
      language: 'javascript',
      status: 'runtime_error',
      passedTests: 0,
      totalTests: 0,
      testResults: [],
      console: [],
      error: `Unsupported language: ${String(language)}`,
      durationMs: 0,
      executedAt: new Date().toISOString(),
    };
  }
  if (
    !LANGUAGE_REGISTRY[language].enabled ||
    !enabledLanguages.includes(language)
  ) {
    return {
      problemSlug: problem.slug,
      language,
      status: 'runtime_error',
      passedTests: 0,
      totalTests: 0,
      testResults: [],
      console: [],
      error: `${LANGUAGE_REGISTRY[language].label} execution is not enabled.`,
      durationMs: 0,
      executedAt: new Date().toISOString(),
      ...runMetadata(problem, language),
    };
  }
  if (code.length > MAX_CODE_LENGTH) {
    return {
      problemSlug: problem.slug,
      language,
      status: 'runtime_error',
      passedTests: 0,
      totalTests: 0,
      testResults: [],
      console: [],
      error: `Code exceeds the ${MAX_CODE_LENGTH} character limit.`,
      durationMs: 0,
      executedAt: new Date().toISOString(),
      ...runMetadata(problem, language),
    };
  }

  const runnableTests =
    scope === 'all'
      ? problem.tests
      : problem.tests.filter((test) => test.isSample);
  if (runnableTests.length === 0) {
    return {
      problemSlug: problem.slug,
      language,
      status: 'runtime_error',
      passedTests: 0,
      totalTests: 0,
      testResults: [],
      console: [],
      error: 'No verified tests are available for this imported problem.',
      durationMs: 0,
      executedAt: new Date().toISOString(),
      ...runMetadata(problem, language),
    };
  }

  const languageConfig = getProblemLanguageConfig(problem, language);
  if (!languageConfig) {
    return {
      problemSlug: problem.slug,
      language,
      status: 'runtime_error',
      passedTests: 0,
      totalTests: runnableTests.length,
      testResults: [],
      console: [],
      error: `${LANGUAGE_REGISTRY[language].label} is not available for this problem.`,
      durationMs: 0,
      executedAt: new Date().toISOString(),
      ...runMetadata(problem, language),
    };
  }

  const createWorker = workerFactories[language];
  if (!createWorker) {
    return {
      problemSlug: problem.slug,
      language,
      status: 'runtime_error',
      passedTests: 0,
      totalTests: runnableTests.length,
      testResults: [],
      console: [],
      error: `${LANGUAGE_REGISTRY[language].label} runner is not configured.`,
      durationMs: 0,
      executedAt: new Date().toISOString(),
      ...runMetadata(problem, language),
    };
  }

  if (typeof Worker === 'undefined') {
    return {
      ...timeoutResult(
        problem,
        language,
        'Code execution requires a browser Worker.',
        runnableTests.length
      ),
      status: 'runtime_error',
      durationMs: 0,
    };
  }

  return new Promise((resolve) => {
    const worker = createWorker();

    let settled = false;
    let executionTimer: ReturnType<typeof setTimeout> | undefined;
    const startupTimer = setTimeout(() => {
      finish(
        timeoutResult(
          problem,
          language,
          `${LANGUAGE_REGISTRY[language].label} runtime initialization timed out.`,
          runnableTests.length
        )
      );
    }, STARTUP_TIMEOUT_MS);

    function finish(result: CodeRunResult) {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (executionTimer) clearTimeout(executionTimer);
      worker.terminate();
      resolve(result);
    }

    worker.onmessage = (
      event: MessageEvent<
        | { type: 'ready' }
        | { type: 'result'; payload: WorkerResult }
        | { type: 'fatal'; error: string }
      >
    ) => {
      if (event.data.type === 'ready') {
        clearTimeout(startupTimer);
        executionTimer = setTimeout(() => {
          finish(
            timeoutResult(
              problem,
              language,
              `Execution exceeded ${EXECUTION_TIMEOUT_MS / 1000} seconds.`,
              runnableTests.length
            )
          );
        }, EXECUTION_TIMEOUT_MS);
        return;
      }

      if (event.data.type === 'fatal') {
        finish({
          ...timeoutResult(
            problem,
            language,
            event.data.error,
            runnableTests.length
          ),
          status: 'runtime_error',
          durationMs: 0,
        });
        return;
      }

      finish({
        problemSlug: problem.slug,
        language,
        ...event.data.payload,
        executedAt: new Date().toISOString(),
        ...runMetadata(problem, language),
      });
    };

    worker.onerror = (event) => {
      finish({
        ...timeoutResult(
          problem,
          language,
          event.message || 'The code runner stopped unexpectedly.',
          runnableTests.length
        ),
        status: 'runtime_error',
        durationMs: 0,
      });
    };

    worker.postMessage({ problem, language, languageConfig, code, scope });
  });
}
