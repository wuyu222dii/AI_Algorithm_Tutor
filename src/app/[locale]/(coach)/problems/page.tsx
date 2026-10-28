import { ProblemsPage } from '@/features/algorithm-coach/components/problems-page';

import { getMetadata } from '@/shared/lib/seo';

export const generateMetadata = getMetadata({
  metadataKey: 'coach.problems',
  canonicalUrl: '/problems',
});

export default function Page() {
  return <ProblemsPage />;
}
