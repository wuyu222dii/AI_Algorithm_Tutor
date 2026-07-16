import { describe, expect, it } from 'vitest';

import { getProblemBySlug } from '../data/problems';
import type { Problem } from '../types';
import { localHintPreview, localHintPreviews } from './domain-adapter';

describe('localHintPreview', () => {
  it('returns the reviewed problem-specific hint for the requested locale and level', () => {
    const problem = getProblemBySlug('first-unique-position');
    expect(problem).toBeDefined();

    expect(localHintPreview(problem!, 'zh', 1)).toBe(
      '先想清楚需要为每个值保存什么信息。'
    );
    expect(localHintPreview(problem!, 'en', 2)).toBe(
      'Count frequencies first, then scan in original order.'
    );
  });

  it('uses a title-specific, no-code framework when an imported problem has no hints', () => {
    const source = getProblemBySlug('first-unique-position');
    expect(source).toBeDefined();
    const importedProblem: Problem = {
      ...source!,
      id: 'imported-preview',
      slug: 'imported-preview',
      title: { zh: '区间覆盖练习', en: 'Interval Coverage Practice' },
      hints: { zh: ['', '', ''], en: ['', '', ''] },
    };

    expect(localHintPreview(importedProblem, 'zh', 1)).toContain(
      '「区间覆盖练习」'
    );
    expect(localHintPreview(importedProblem, 'zh', 3)).toContain(
      '暂时不要填写完整代码'
    );
    expect(localHintPreview(importedProblem, 'en', 3)).toContain(
      'without writing the full code'
    );
  });

  it('derives every persisted revealed level that has not been replaced by a response', () => {
    const problem = getProblemBySlug('first-unique-position');
    expect(problem).toBeDefined();

    const previews = localHintPreviews(
      problem!,
      'zh',
      3,
      new Set<1 | 2 | 3>([1])
    );

    expect(previews.map((preview) => preview.level)).toEqual([2, 3]);
    expect(previews.map((preview) => preview.content)).toEqual([
      '第一次遍历统计频次，第二次按原顺序查找。',
      'freq = 计数(values)；依次检查 i，若 freq[values[i]] == 1 则返回 i。',
    ]);
  });
});
