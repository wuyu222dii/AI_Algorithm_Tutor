'use client';

import Editor, { loader } from '@monaco-editor/react';
import { useTheme } from 'next-themes';

import { cn } from '@/shared/lib/utils';

import { LANGUAGE_REGISTRY } from '../languages';
import type { Language } from '../types';

loader.config({ paths: { vs: '/monaco/vs' } });

export function CodeEditor({
  value,
  onChange,
  language,
  height = '100%',
  readOnly = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  language: Language;
  height?: string | number;
  readOnly?: boolean;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();

  return (
    <div className={cn('min-h-0 overflow-hidden bg-[#1e1e1e]', className)}>
      <Editor
        height={height}
        language={LANGUAGE_REGISTRY[language].monacoId}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? '')}
        loading={
          <div className="bg-muted text-muted-foreground flex h-full items-center justify-center text-sm">
            Loading editor...
          </div>
        }
        options={{
          readOnly,
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 21,
          padding: { top: 14, bottom: 14 },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'line',
          wordWrap: 'on',
          tabSize: 2,
          smoothScrolling: true,
          overviewRulerBorder: false,
          contextmenu: true,
          ariaLabel: 'Code editor',
        }}
      />
    </div>
  );
}
