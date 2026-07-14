import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getRuntimeProblem,
  listRuntimeProblems,
  runtimeEnabledLanguages,
} from './catalog-runtime.server';
import { compileTypeScript } from './runner/typescript';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runtime problem catalog', () => {
  it('loads the complete 58-problem fixture only when the DB flag is explicit', async () => {
    vi.stubEnv('DB_CATALOG_ENABLED', 'false');
    vi.stubEnv('NODE_ENV', 'test');

    const catalog = await listRuntimeProblems();
    expect(catalog).toHaveLength(58);
    expect(
      catalog.every((problem) =>
        ['javascript', 'python', 'typescript'].every(
          (language) => problem.languageConfigs?.[language as 'javascript']
        )
      )
    ).toBe(true);
    expect(
      catalog.filter((problem) => problem.origin?.provider === 'exercism')
    ).toHaveLength(20);
    for (const problem of catalog) {
      for (const language of ['javascript', 'typescript', 'python'] as const) {
        const config = problem.languageConfigs?.[language];
        expect(config, `${problem.slug}:${language}`).toMatchObject({
          monacoId: language,
          runner:
            language === 'python'
              ? 'pyodide'
              : language === 'typescript'
                ? 'typescript-quickjs'
                : 'quickjs',
        });
        expect(config?.runtimeVersion).toBeTruthy();
        expect(config?.signature).toEqual(
          expect.objectContaining({
            parameters: expect.any(Array),
            returns: expect.any(Object),
          })
        );
      }
      const typescript = problem.languageConfigs?.typescript;
      expect(typescript).toBeTruthy();
      if (!typescript) continue;
      expect(compileTypeScript(typescript.template).ok).toBe(true);
      expect(typescript.template).toMatch(
        new RegExp(`function\\s+${typescript.entryPoint}\\s*\\(`)
      );
    }
  });

  it('filters languages and resolves immutable versions', async () => {
    vi.stubEnv('DB_CATALOG_ENABLED', 'false');
    vi.stubEnv('NODE_ENV', 'test');

    const typescript = await listRuntimeProblems({ language: 'typescript' });
    expect(typescript).toHaveLength(58);
    await expect(
      getRuntimeProblem('dependency-cycle', 1)
    ).resolves.toMatchObject({
      slug: 'dependency-cycle',
      version: { contentVersion: 1 },
    });
    await expect(
      getRuntimeProblem('dependency-cycle', 2)
    ).resolves.toBeUndefined();
  });

  it('uses the server TypeScript rollout flag', () => {
    expect(
      runtimeEnabledLanguages({
        ...process.env,
        TYPESCRIPT_ENABLED: 'false',
      })
    ).toEqual(['javascript', 'python']);
    expect(
      runtimeEnabledLanguages({
        ...process.env,
        TYPESCRIPT_ENABLED: 'true',
      })
    ).toEqual(['javascript', 'typescript', 'python']);
  });
});
