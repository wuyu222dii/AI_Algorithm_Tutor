'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { authClient } from '@/core/auth/client';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';

import { isValidPassword } from './auth-form-utils';
import { PasswordInput } from './password-input';

export function PasswordChange() {
  const t = useTranslations('common.sign');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const nextErrors: Record<string, string> = {};
    if (!currentPassword) nextErrors.current = t('current_password_required');
    if (!newPassword) nextErrors.password = t('password_required');
    else if (!isValidPassword(newPassword)) {
      nextErrors.password = t('password_length');
    }
    if (!confirmPassword) {
      nextErrors.confirm = t('confirm_password_required');
    } else if (newPassword !== confirmPassword) {
      nextErrors.confirm = t('password_mismatch');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    setFormError('');
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setFormError(t('change_password_failed'));
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success(t('change_password_success'));
    } catch {
      setFormError(t('change_password_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>{t('change_password_title')}</CardTitle>
        <CardDescription>{t('change_password_description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <PasswordInput
            id="current-password"
            label={t('current_password_title')}
            placeholder={t('current_password_placeholder')}
            autoComplete="current-password"
            value={currentPassword}
            error={errors.current}
            disabled={loading}
            onChange={(value) => {
              setCurrentPassword(value);
              setErrors((current) => ({ ...current, current: '' }));
            }}
          />
          <PasswordInput
            id="settings-new-password"
            label={t('new_password_title')}
            placeholder={t('new_password_placeholder')}
            autoComplete="new-password"
            value={newPassword}
            error={errors.password}
            hint={t('password_requirements')}
            disabled={loading}
            onChange={(value) => {
              setNewPassword(value);
              setErrors((current) => ({ ...current, password: '' }));
            }}
          />
          <PasswordInput
            id="settings-confirm-password"
            label={t('confirm_password_title')}
            placeholder={t('confirm_password_placeholder')}
            autoComplete="new-password"
            value={confirmPassword}
            error={errors.confirm}
            disabled={loading}
            onChange={(value) => {
              setConfirmPassword(value);
              setErrors((current) => ({ ...current, confirm: '' }));
            }}
          />
          {formError && (
            <p className="text-destructive text-sm" role="alert">
              {formError}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            {t('change_password_session_notice')}
          </p>
          <Button type="submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                <span>{t('changing_password')}</span>
              </>
            ) : (
              t('change_password_submit')
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
