import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProblemBySlug } from '../data/problems';
import type { CodeRunStatus, Language } from '../types';
import { runCode } from './index';

type WorkerHandler = ((event: MessageEvent<unknown>) => void) | null;

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: WorkerHandler = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postedMessage: unknown;
  terminated = false;

  constructor(
    readonly source: string | URL,
    readonly options?: WorkerOptions
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown) {
    this.postedMessage = message;
  }

  terminate() {
    this.terminated = true;
  }

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

const problem = getProblemBySlug('first-unique-position');

function latestWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (!worker) throw new Error('Expected a code runner worker to be created.');
  return worker;
}

function resultPayload(status: CodeRunStatus) {
  const error =
    status === 'syntax_error'
      ? 'SyntaxError: unexpected token'
      : status === 'runtime_error'
        ? 'ReferenceError: missingValue is not defined'
        : undefined;
  return {
    status,
    passedTests: status === 'passed' ? 2 : 0,
    totalTests: 2,
    testResults:
      status === 'passed'
        ? [
            {
              testId: 'fu-1',
              passed: true,
              expected: 3,
              actual: 3,
              durationMs: 1,
            },
            {
              testId: 'fu-2',
              passed: true,
              expected: 3,
              actual: 3,
              durationMs: 1,
            },
          ]
        : [],
    console: [],
    error,
    durationMs: 2,
  };
}

describe('browser code runner coordination', () => {
  beforeEach(() => {
    if (!problem) throw new Error('Runner fixture problem is missing.');
    FakeWorker.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each<Language>(['javascript', 'python'])(
    'returns a passed result from the %s worker',
    async (language) => {
      const pending = runCode({
        problem: problem!,
        language,
        code:
          language === 'python'
            ? 'def first_unique_position(values): return 0'
            : 'function firstUniquePosition() { return 0; }',
      });
      const worker = latestWorker();
      worker.emit({ type: 'ready' });
      worker.emit({ type: 'result', payload: resultPayload('passed') });

      await expect(pending).resolves.toMatchObject({
        problemSlug: problem!.slug,
        language,
        status: 'passed',
        passedTests: 2,
        totalTests: 2,
      });
      expect(worker.terminated).toBe(true);
      expect(worker.options?.type).toBe('module');
      if (language === 'python') {
        expect(String(worker.source)).toBe(
          '/algorithm-coach-python-runner.mjs'
        );
      }
    }
  );

  it.each([
    ['javascript', 'syntax_error'],
    ['javascript', 'runtime_error'],
    ['python', 'syntax_error'],
    ['python', 'runtime_error'],
  ] as const)('preserves %s %s results', async (language, status) => {
    const pending = runCode({ problem: problem!, language, code: 'invalid' });
    const worker = latestWorker();
    worker.emit({ type: 'ready' });
    worker.emit({ type: 'result', payload: resultPayload(status) });

    await expect(pending).resolves.toMatchObject({
      language,
      status,
      passedTests: 0,
      totalTests: 2,
    });
    expect(worker.terminated).toBe(true);
  });

  it.each<Language>(['javascript', 'python'])(
    'terminates the %s worker after the execution deadline',
    async (language) => {
      const pending = runCode({ problem: problem!, language, code: 'loop' });
      const worker = latestWorker();
      worker.emit({ type: 'ready' });
      await vi.advanceTimersByTimeAsync(3_000);

      await expect(pending).resolves.toMatchObject({
        language,
        status: 'timeout',
        totalTests: 2,
        durationMs: 3_000,
      });
      expect(worker.terminated).toBe(true);
    }
  );
});
