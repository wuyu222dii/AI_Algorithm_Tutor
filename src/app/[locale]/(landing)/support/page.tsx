import { Mail } from 'lucide-react';

import { envConfigs } from '@/config';

export default async function SupportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const zh = locale === 'zh';
  const email = envConfigs.support_email;

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center px-4 py-16 md:px-6">
      <section className="bg-card w-full rounded-lg border p-6 md:p-8">
        <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
          <Mail className="size-5" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">
          {zh ? '联系支持' : 'Contact support'}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          {zh
            ? '账号、隐私、题库来源或学习数据相关问题，可以通过以下邮箱联系我们。'
            : 'Contact us about accounts, privacy, catalog attribution, or your learning data.'}
        </p>
        {email ? (
          <a
            href={`mailto:${email}`}
            className="bg-primary text-primary-foreground mt-6 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
          >
            <Mail className="size-4" aria-hidden="true" />
            {email}
          </a>
        ) : (
          <p className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
            {zh
              ? '支持邮箱尚未配置。生产环境 readiness 会阻止缺少该配置的版本上线。'
              : 'The support email is not configured. Production readiness blocks this configuration.'}
          </p>
        )}
      </section>
    </main>
  );
}
