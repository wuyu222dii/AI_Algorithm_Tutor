import { describe, expect, it, vi } from 'vitest';

import { curatedExercismProblems } from './curated-exercism-problems';
import { validateCatalogRunnerCompatibility } from './runner-compatibility.server';

vi.mock('server-only', () => ({}));

function fixture() {
  const problem = structuredClone(curatedExercismProblems[0]);
  problem.languageConfigs.javascript.template =
    "function helloWorld() { return 'deliberately wrong'; }";
  problem.languageConfigs.typescript.template =
    "function helloWorld(): string { return 'deliberately wrong'; }";
  problem.languageConfigs.python.template =
    "def hello_world():\n    return 'deliberately wrong'";
  return problem;
}

describe('catalog runner compatibility release gate', () => {
  it('loads starters without treating their TODO output as a solution and runs every oracle vector', async () => {
    const problem = fixture();

    const result = await validateCatalogRunnerCompatibility(problem);

    expect(result).toMatchObject({
      valid: true,
      problemSlug: problem.slug,
      testCount: problem.tests.length,
      issues: [],
    });
    expect(result.checks.map((check) => check.language)).toEqual([
      'javascript',
      'python',
      'typescript',
    ]);
    for (const check of result.checks) {
      expect(check.starter).toMatchObject({
        loaded: true,
        entryPointFound: true,
        compatible: true,
      });
      expect(check.oracle.executedTests).toBe(problem.tests.length);
      expect(check.oracle.passedTests).toBe(problem.tests.length);
    }
  }, 45_000);

  it('returns structured issues for broken starters and runtime contracts', async () => {
    const problem = fixture();
    problem.languageConfigs.javascript.template = 'function helloWorld(';
    problem.languageConfigs.typescript.template =
      'const unrelated: number = 1;';
    problem.languageConfigs.python.runner = 'quickjs' as 'pyodide';

    const result = await validateCatalogRunnerCompatibility(problem);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'starter_load_failed',
          stage: 'starter',
          language: 'javascript',
          path: 'languageConfigs.javascript.template',
        }),
        expect.objectContaining({
          code: 'starter_entry_missing',
          stage: 'starter',
          language: 'typescript',
          path: 'languageConfigs.typescript.entryPoint',
        }),
        expect.objectContaining({
          code: 'invalid_runtime_contract',
          stage: 'contract',
          language: 'python',
          path: 'languageConfigs.python',
        }),
      ])
    );
    expect(
      result.checks.find((check) => check.language === 'javascript')?.oracle
        .passedTests
    ).toBe(problem.tests.length);
  }, 45_000);

  it('hard-terminates a Python starter that exceeds the execution deadline', async () => {
    const problem = fixture();
    problem.languageConfigs.python.template =
      'def hello_world():\n    while True:\n        pass\n\nwhile True:\n    pass';

    const startedAt = Date.now();
    const result = await validateCatalogRunnerCompatibility(problem);

    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'runtime_timeout',
        stage: 'starter',
        language: 'python',
      })
    );
    expect(
      result.checks.find((check) => check.language === 'python')?.oracle
    ).toMatchObject({
      executedTests: problem.tests.length,
      passedTests: problem.tests.length,
    });
  }, 45_000);
});
