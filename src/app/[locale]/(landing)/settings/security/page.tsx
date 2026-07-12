import { Empty } from '@/shared/blocks/common';
import { PasswordChange } from '@/shared/blocks/sign/password-change';
import { getUserInfo } from '@/shared/models/user';

export default async function SecurityPage() {
  const user = await getUserInfo();
  if (!user) {
    return <Empty message="no auth" />;
  }

  return <PasswordChange />;
}
