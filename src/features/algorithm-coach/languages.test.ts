import { describe, expect, it } from 'vitest';

import { getProblemBySlug } from './data/problems';
import {
  getEnabledLanguageIds,
  getProblemLanguageConfig,
  LANGUAGE_IDS,
  LANGUAGE_REGISTRY,
  normalizeProblemLanguageConfigs,
} from './languages';

describe('language registry', () => {
  it('pre-registers local and future remote languages', () => {
    expect(LANGUAGE_IDS).toEqual([
      'javascript',
      'typescript',
      'python',
      'cpp',
      'java',
      'go',
      'rust',
    ]);
    expect(LANGUAGE_REGISTRY.rust).toMatchObject({
      enabled: false,
      runner: 'remote',
      monacoId: 'rust',
    });
  });

  it('gates TypeScript without changing the baseline languages', () => {
    expect(getEnabledLanguageIds(false)).toEqual(['javascript', 'python']);
    expect(getEnabledLanguageIds(true)).toEqual([
      'javascript',
      'typescript',
      'python',
    ]);
  });

  it('normalizes legacy fixtures and derives a TypeScript template', () => {
    const problem = getProblemBySlug('first-unique-position');
    expect(problem).toBeDefined();

    const configs = normalizeProblemLanguageConfigs(problem!);
    expect(configs.javascript?.entryPoint).toBe('firstUniquePosition');
    expect(configs.python?.entryPoint).toBe('first_unique_position');
    expect(configs.typescript?.template).toContain(
      'function firstUniquePosition(values: any): unknown'
    );
  });

  it('prefers an explicit language config over legacy templates', () => {
    const config = getProblemLanguageConfig(
      {
        languageConfigs: {
          typescript: {
            entryPoint: 'solveTyped',
            template:
              'function solveTyped(value: number): number { return value; }',
            runtimeVersion: 'typescript@test',
          },
        },
      },
      'typescript'
    );

    expect(config).toMatchObject({
      entryPoint: 'solveTyped',
      runtimeVersion: 'typescript@test',
    });
  });
});
