import { describe, expect, it } from 'vitest';

import { compileTypeScript } from './typescript';

describe('TypeScript runner compilation', () => {
  it('transpiles a standalone typed solution', () => {
    const result = compileTypeScript(`
      function sum(values: number[]): number {
        return values.reduce((total, value) => total + value, 0);
      }
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toContain('function sum(values)');
      expect(result.code).not.toContain('number[]');
    }
  });

  it.each([
    `import value from 'package';`,
    `export function solve(): number { return 1; }`,
    `const value = require('package');`,
    `const value = import('package');`,
    `const value = eval("import('package')");`,
    `const value = new Function("return import('package')");`,
  ])('rejects module access: %s', (source) => {
    const result = compileTypeScript(source);

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toMatch(/not available/i);
    }
  });

  it('returns source locations for syntax errors', () => {
    const result = compileTypeScript(
      'function solve(values: number[] { return values.length; }'
    );

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toMatch(/TS\d+ \(1:\d+\)/);
    }
  });
});
