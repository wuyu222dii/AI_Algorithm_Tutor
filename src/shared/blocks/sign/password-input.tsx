'use client';

import { ReactNode, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

export function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  error,
  hint,
  labelAction,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  error?: string;
  hint?: string;
  labelAction?: ReactNode;
  disabled?: boolean;
}) {
  const t = useTranslations('common.sign');
  const [visible, setVisible] = useState(false);
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : hint ? descriptionId : undefined}
          className="pr-10"
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={disabled}
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
          aria-label={visible ? t('hide_password') : t('show_password')}
          title={visible ? t('hide_password') : t('show_password')}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {error ? (
        <p id={errorId} className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={descriptionId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
