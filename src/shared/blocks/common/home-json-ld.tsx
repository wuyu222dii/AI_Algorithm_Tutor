import { envConfigs } from '@/config';

export function HomeJsonLd({ locale }: { locale: string }) {
  const appUrl = envConfigs.app_url;
  const isZh = locale === 'zh';
  const name = isZh ? 'AlgoCoach AI 算法教练' : 'AlgoCoach';
  const description = isZh
    ? '通过逐级提示、真实代码运行、即时 AI 反馈、专项测评和个性化复习，建立完整的算法学习闭环。'
    : 'Practice algorithms with guided hints, real code execution, immediate AI feedback, focused assessments, and personalized review.';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name,
        description,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Web',
        url: appUrl,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      },
      {
        '@type': 'Course',
        name: isZh ? '算法学习与练习' : 'Algorithm Learning and Practice',
        description,
        provider: {
          '@type': 'Organization',
          name,
          url: appUrl,
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
