import type { CodeRunResult, Language, Problem } from '../types';

export interface RunCodeInput {
  problem: Problem;
  language: Language;
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
  };
}

export async function runCode({
  problem,
  language,
  code,
  scope = 'sample',
}: RunCodeInput): Promise<CodeRunResult> {
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
    // Turbopack emits `new URL(...worker.ts)` as a classic worker in dev.
    // Pyodide intentionally rejects classic workers, so its module worker is
    // served as-is from public while QuickJS keeps using the bundled worker.
    const worker =
      language === 'python'
        ? new Worker('/algorithm-coach-python-runner.mjs', {
            name: 'algocoach-python-runner',
            type: 'module',
          })
        : new Worker(new URL('./runner.worker.ts', import.meta.url), {
            name: 'algocoach-javascript-runner',
            type: 'module',
          });

    let settled = false;
    let executionTimer: ReturnType<typeof setTimeout> | undefined;
    const startupTimer = setTimeout(() => {
      finish(
        timeoutResult(
          problem,
          language,
          language === 'python'
            ? 'Python runtime initialization timed out.'
            : 'JavaScript runtime initialization timed out.',
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

    worker.postMessage({ problem, language, code, scope });
  });
}
