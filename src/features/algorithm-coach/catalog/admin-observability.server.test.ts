import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordCatalogAdminFailure } from './admin-observability.server';

describe('catalog admin observability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a failure category without logging the raw error', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sensitiveMessage =
      'postgresql://admin:secret@database.internal/algocoach sk-sensitive-key-value';

    await recordCatalogAdminFailure(
      'candidate_list',
      'trace-123',
      new Error(sensitiveMessage)
    );

    expect(errorLog).toHaveBeenCalledOnce();
    const serialized = String(errorLog.mock.calls[0]?.[0]);
    expect(serialized).not.toContain('database.internal');
    expect(serialized).not.toContain('secret');
    expect(JSON.parse(serialized)).toMatchObject({
      event: 'catalog_admin_failed',
      level: 'error',
      traceId: 'trace-123',
      operation: 'candidate_list',
      failureType: 'Error',
    });
  });
});
