import { describe, expect, it } from 'vitest';

import { coachEvalCases } from './eval-cases';

describe('coach evaluation corpus', () => {
  it('uses the same trusted versioned problem context as the production API', () => {
    const catalogCases = coachEvalCases.filter(
      (sample) =>
        sample.request.action !== 'parse' && sample.request.problemSlug
    );

    expect(catalogCases.length).toBeGreaterThan(0);
    for (const sample of catalogCases) {
      expect(sample.request.problem).toMatchObject({
        slug: sample.request.problemSlug,
      });
      expect(sample.request.problemContentVersion).toBeGreaterThanOrEqual(1);
      if (sample.request.runResult) {
        expect(sample.request.runResult.problemContentVersion).toBe(
          sample.request.problemContentVersion
        );
      }
    }
  });
});
