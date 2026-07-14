import { Empty } from '@/shared/blocks/common';
import { PasswordChange } from '@/shared/blocks/sign/password-change';
import { DataPrivacyControls } from '@/shared/blocks/sign/privacy-controls';
import { getUserInfo } from '@/shared/models/user';

export default async function SecurityPage() {
  const user = await getUserInfo();
  if (!user) {
    return <Empty message="no auth" />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <PasswordChange />
      <div className="grid content-start gap-6">
        <DataPrivacyControls userId={user.id} />
      </div>
    </div>
  );
}
