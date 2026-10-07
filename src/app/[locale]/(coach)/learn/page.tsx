import { LearnPage } from '@/features/algorithm-coach/components/learn-page';

import { getMetadata } from '@/shared/lib/seo';

export const generateMetadata = getMetadata({
  metadataKey: 'coach.learn',
  canonicalUrl: '/learn',
});

export default function Page() {
  return <LearnPage />;
}
