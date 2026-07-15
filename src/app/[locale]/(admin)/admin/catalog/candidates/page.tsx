import { CatalogCandidateConsole } from '@/features/algorithm-coach/catalog/components/catalog-candidate-console';

import { Header, Main } from '@/shared/blocks/dashboard';

export default async function CatalogCandidatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const zh = locale === 'zh';
  return (
    <>
      <Header
        title={zh ? '题库候选审核' : 'Catalog candidate review'}
        show_locale
        show_theme
      />
      <Main>
        <CatalogCandidateConsole locale={locale} />
      </Main>
    </>
  );
}
