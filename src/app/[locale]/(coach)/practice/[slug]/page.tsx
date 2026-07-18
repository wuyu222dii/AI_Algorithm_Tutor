import { getRuntimeProblem } from '@/features/algorithm-coach/catalog-runtime.server';
import { PracticeWorkspace } from '@/features/algorithm-coach/components/practice-workspace';
import { isImportedDraftSlug } from '@/features/algorithm-coach/imported-drafts';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const rawVersion = Array.isArray(query.version)
    ? query.version[0]
    : query.version;
  const parsedVersion =
    rawVersion === undefined ? undefined : Number(rawVersion);
  const requestedContentVersion =
    Number.isInteger(parsedVersion) && Number(parsedVersion) > 0
      ? Number(parsedVersion)
      : undefined;
  const invalidVersion = rawVersion !== undefined && !requestedContentVersion;
  const initialProblem =
    !invalidVersion && !isImportedDraftSlug(slug)
      ? await getRuntimeProblem(slug, requestedContentVersion)
      : undefined;

  return (
    <PracticeWorkspace
      slug={slug}
      initialProblem={initialProblem}
      requestedContentVersion={requestedContentVersion}
      versionUnavailable={
        invalidVersion || (!isImportedDraftSlug(slug) && !initialProblem)
      }
    />
  );
}
