import { getTranslations } from 'next-intl/server';

import { Empty } from '@/shared/blocks/common';
import { FormCard } from '@/shared/blocks/form';
import {
  findApikeyById,
  updateApikey,
  UpdateApikey,
} from '@/shared/models/apikey';
import { getUserInfo } from '@/shared/models/user';
import { Crumb } from '@/shared/types/blocks/common';
import { Form as FormType } from '@/shared/types/blocks/form';

export default async function EditApiKeyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const apikey = await findApikeyById(id);
  if (!apikey) {
    return <Empty message="API key not found" />;
  }

  const user = await getUserInfo();
  if (!user) {
    return <Empty message="no auth" />;
  }

  if (apikey.userId !== user.id) {
    return <Empty message="no permission" />;
  }

  const t = await getTranslations('settings.apikeys');

  const form: FormType = {
    title: t('edit.title'),
    fields: [
      {
        name: 'title',
        title: t('fields.title'),
        type: 'text',
        placeholder: '',
        validation: { required: true },
      },
    ],
    data: apikey,
    submit: {
      handler: async (data: FormData) => {
        'use server';

        const sessionUser = await getUserInfo();
        if (!sessionUser) {
          throw new Error('no auth');
        }
        const ownedApikey = await findApikeyById(id);
        if (!ownedApikey || ownedApikey.userId !== sessionUser.id) {
          throw new Error('no permission');
        }

        const titleValue = data.get('title');
        const title =
          typeof titleValue === 'string' ? titleValue.trim().slice(0, 80) : '';
        if (!title) {
          throw new Error('title is required');
        }

        const updatedApikey: UpdateApikey = {
          title,
        };

        await updateApikey(ownedApikey.id, updatedApikey);

        return {
          status: 'success',
          message: 'API Key updated',
          redirect_url: '/settings/apikeys',
        };
      },
      button: {
        title: t('edit.buttons.submit'),
      },
    },
  };

  const crumbs: Crumb[] = [
    {
      title: t('edit.crumbs.apikeys'),
      url: '/settings/apikeys',
    },
    {
      title: t('edit.crumbs.edit'),
      is_active: true,
    },
  ];

  return (
    <div className="space-y-8">
      <FormCard title={t('edit.title')} crumbs={crumbs} form={form} />
    </div>
  );
}
