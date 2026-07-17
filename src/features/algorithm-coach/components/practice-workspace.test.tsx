import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewCardGenerationNotice } from './review-card-generation-notice';

afterEach(cleanup);

describe('ReviewCardGenerationNotice', () => {
  it('keeps a pending review card visibly separate from code completion', () => {
    render(
      <ReviewCardGenerationNotice
        locale="zh"
        status="pending"
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('正在生成复习卡');
    expect(screen.getByText(/本地测试已完成/)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers an explicit retry after generation fails', () => {
    const retry = vi.fn();
    render(
      <ReviewCardGenerationNotice locale="en" status="failed" onRetry={retry} />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Review card not generated yet'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry generation' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
