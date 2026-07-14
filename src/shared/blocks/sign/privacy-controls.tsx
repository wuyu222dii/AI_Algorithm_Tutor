'use client';

import { useState } from 'react';
import { Download, Loader2, Trash2 } from 'lucide-react';
import { useLocale } from 'next-intl';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';

const copy = {
  zh: {
    dataTitle: '学习数据',
    dataDescription: '导出你的学习档案、代码运行、AI 产物和测评记录。',
    export: '导出 JSON',
    exporting: '正在导出',
    exportFailed: '学习数据导出失败，请稍后重试。',
    deleteTitle: '删除账号',
    deleteDescription: '永久删除账号、登录方式和云端学习数据。此操作无法撤销。',
    delete: '删除账号',
    dialogTitle: '确认永久删除账号',
    dialogDescription:
      '输入 DELETE 继续。删除完成后，本设备中该账号的学习缓存也会清除。',
    placeholder: '输入 DELETE',
    cancel: '取消',
    deleting: '正在删除',
    deleteFailed: '账号删除失败。请重新登录后再试。',
  },
  en: {
    dataTitle: 'Learning data',
    dataDescription:
      'Export your learning profile, code runs, AI artifacts, and assessments.',
    export: 'Export JSON',
    exporting: 'Exporting',
    exportFailed: 'Learning data could not be exported. Please try again.',
    deleteTitle: 'Delete account',
    deleteDescription:
      'Permanently delete your account, sign-in methods, and cloud learning data. This cannot be undone.',
    delete: 'Delete account',
    dialogTitle: 'Permanently delete account?',
    dialogDescription:
      "Type DELETE to continue. This account's learning cache will also be removed from this device.",
    placeholder: 'Type DELETE',
    cancel: 'Cancel',
    deleting: 'Deleting',
    deleteFailed: 'Account deletion failed. Sign in again and retry.',
  },
} as const;

function clearAccountCache(userId: string) {
  const marker = `:user:${userId}`;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.includes(marker)) storage.removeItem(key);
    }
  }
}

function collectAccountCache(userId: string) {
  const marker = `:user:${userId}`;
  const cache: Record<string, Record<string, unknown>> = {
    localStorage: {},
    sessionStorage: {},
  };

  for (const [name, storage] of [
    ['localStorage', window.localStorage],
    ['sessionStorage', window.sessionStorage],
  ] as const) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.includes(marker)) continue;
      const value = storage.getItem(key);
      if (value === null) continue;
      try {
        cache[name][key] = JSON.parse(value) as unknown;
      } catch {
        cache[name][key] = value;
      }
    }
  }

  return cache;
}

export function DataPrivacyControls({ userId }: { userId: string }) {
  const locale = useLocale().startsWith('zh') ? 'zh' : 'en';
  const t = copy[locale];
  const [exporting, setExporting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function exportData() {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch('/api/coach/export', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('export_failed');
      const payload = (await response.json()) as { data?: unknown };
      const blob = new Blob(
        [
          JSON.stringify(
            {
              cloudExport: payload.data ?? null,
              browserCache: collectAccountCache(userId),
            },
            null,
            2
          ),
        ],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `algocoach-learning-data-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t.exportFailed);
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (confirmation !== 'DELETE' || deleting) return;
    setDeleting(true);
    try {
      const result = await authClient.deleteUser({ callbackURL: '/about' });
      if (result.error) throw new Error(result.error.message);
      clearAccountCache(userId);
      window.location.assign('/about');
    } catch {
      toast.error(t.deleteFailed);
      setDeleting(false);
    }
  }

  return (
    <>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>{t.dataTitle}</CardTitle>
          <CardDescription>{t.dataDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            onClick={() => void exportData()}
            disabled={exporting}
          >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            {exporting ? t.exporting : t.export}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30 max-w-md">
        <CardHeader>
          <CardTitle>{t.deleteTitle}</CardTitle>
          <CardDescription>{t.deleteDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setDialogOpen(true)}
          >
            <Trash2 />
            {t.delete}
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (deleting) return;
          setDialogOpen(open);
          if (!open) setConfirmation('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.dialogTitle}</DialogTitle>
            <DialogDescription>{t.dialogDescription}</DialogDescription>
          </DialogHeader>
          <Input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={t.placeholder}
            autoComplete="off"
            disabled={deleting}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={deleting}
            >
              {t.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void deleteAccount()}
              disabled={confirmation !== 'DELETE' || deleting}
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {deleting ? t.deleting : t.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
