import { getTranslations } from 'next-intl/server';

import { Empty } from '@/shared/blocks/common';
import { FormCard } from '@/shared/blocks/form';
import { getUuid } from '@/shared/lib/hash';
import { ApikeyStatus, createApikey, NewApikey } from '@/shared/models/apikey';
import { getUserInfo } from '@/shared/models/user';
import { Crumb } from '@/shared/types/blocks/common';
import { Form as FormType } from '@/shared/types/blocks/form';

function createSecureApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `sk-${token}`;
}

export default async function CreateApiKeyPage() {
  const user = await getUserInfo();
  if (!user) {
    return <Empty message="no auth" />;
  }

  const t = await getTranslations('settings.apikeys');

  const form: FormType = {
    title: t('add.title'),
    fields: [
      {
        name: 'title',
        title: t('fields.title'),
        type: 'text',
        placeholder: '',
        validation: { required: true },
      },
    ],
    submit: {
      handler: async (data: FormData) => {
        'use server';

        const sessionUser = await getUserInfo();
        if (!sessionUser) {
          throw new Error('no auth');
        }

        const titleValue = data.get('title');
        const title =
          typeof titleValue === 'string' ? titleValue.trim().slice(0, 80) : '';
        if (!title) {
          throw new Error('title is required');
        }

        const key = createSecureApiKey();

        const newApikey: NewApikey = {
          id: getUuid(),
          userId: sessionUser.id,
          title,
          key: key,
          status: ApikeyStatus.ACTIVE,
        };

        await createApikey(newApikey);

        return {
          status: 'success',
          message: 'API Key created',
          redirect_url: '/settings/apikeys',
        };
      },
      button: {
        title: t('add.buttons.submit'),
      },
    },
  };

  const crumbs: Crumb[] = [
    {
      title: t('add.crumbs.apikeys'),
      url: '/settings/apikeys',
    },
    {
      title: t('add.crumbs.add'),
      is_active: true,
    },
  ];

  return (
    <div className="space-y-8">
      <FormCard title={t('add.title')} crumbs={crumbs} form={form} />
    </div>
  );
}
