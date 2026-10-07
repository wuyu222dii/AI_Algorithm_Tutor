import { ProgressPage } from '@/features/algorithm-coach/components/progress-page';

import { getMetadata } from '@/shared/lib/seo';

export const generateMetadata = getMetadata({
  metadataKey: 'coach.progress',
  canonicalUrl: '/progress',
});

export default function Page() {
  return <ProgressPage />;
}
