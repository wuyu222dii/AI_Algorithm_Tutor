import { getTranslations } from 'next-intl/server';

import { Empty } from '@/shared/blocks/common';
import { FormCard } from '@/shared/blocks/form';
import { getUserInfo, UpdateUser, updateUser } from '@/shared/models/user';
import { Form as FormType } from '@/shared/types/blocks/form';

export default async function ProfilePage() {
  const user = await getUserInfo();
  if (!user) {
    return <Empty message="no auth" />;
  }

  const t = await getTranslations('settings.profile');

  const form: FormType = {
    fields: [
      {
        name: 'email',
        title: t('fields.email'),
        type: 'email',
        attributes: { disabled: true },
      },
      { name: 'name', title: t('fields.name'), type: 'text' },
      {
        name: 'image',
        title: t('fields.avatar'),
        type: 'upload_image',
        metadata: {
          max: 1,
        },
      },
    ],
    data: user,
    submit: {
      handler: async (data: FormData) => {
        'use server';

        const sessionUser = await getUserInfo();
        if (!sessionUser) {
          throw new Error('no auth');
        }

        const nameValue = data.get('name');
        const name = typeof nameValue === 'string' ? nameValue.trim() : '';
        if (!name) {
          throw new Error('name is required');
        }
        if (name.length > 80) {
          throw new Error('name is too long');
        }

        const imageValue = data.get('image');
        const image =
          typeof imageValue === 'string'
            ? imageValue.trim().slice(0, 2048)
            : '';

        const updatedUser: UpdateUser = {
          name,
          image,
        };

        await updateUser(sessionUser.id, updatedUser);

        return {
          status: 'success',
          message: 'Profile updated',
          redirect_url: '/settings/profile',
        };
      },
      button: {
        title: t('edit.buttons.submit'),
      },
    },
  };

  return (
    <div className="space-y-8">
      <FormCard
        title={t('edit.title')}
        description={t('edit.description')}
        form={form}
      />
    </div>
  );
}
