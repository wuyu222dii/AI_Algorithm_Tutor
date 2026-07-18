import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SmartIcon } from './smart-icon';

describe('SmartIcon', () => {
  it('renders explicitly mapped Lucide and Remix icons', () => {
    render(
      <>
        <SmartIcon name="LibraryBig" aria-label="catalog" />
        <SmartIcon name="RiTaskLine" aria-label="task" />
      </>
    );

    expect(screen.getByLabelText('catalog')).toBeInTheDocument();
    expect(screen.getByLabelText('task')).toBeInTheDocument();
  });

  it('uses a stable fallback for unknown names', () => {
    render(<SmartIcon name="UnknownRemoteIcon" aria-label="fallback" />);

    expect(screen.getByLabelText('fallback')).toHaveClass(
      'lucide-circle-question-mark'
    );
  });
});
