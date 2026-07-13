import { getThemeBlock } from '@/core/theme';
import { Post as PostType } from '@/shared/types/blocks/blog';

export default async function StaticPage({
  post,
}: {
  locale?: string;
  post: PostType;
}) {
  const PageDetail = await getThemeBlock('page-detail');

  return <PageDetail post={post} />;
}
