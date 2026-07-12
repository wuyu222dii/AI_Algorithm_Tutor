import { ReactNode } from 'react';
import { CircleAlert, Inbox } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

export function CoachPage({
  title,
  description,
  actions,
  children,
  width = 'wide',
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  width?: 'wide' | 'full';
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 py-6 md:px-6 md:py-8',
        width === 'wide' ? 'max-w-7xl' : 'max-w-[1680px]'
      )}
    >
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-6 md:text-base">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function Panel({
  children,
  className,
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'muted' | 'amber' | 'success' | 'danger';
}) {
  return (
    <section
      className={cn(
        'bg-card rounded-lg border',
        tone === 'muted' && 'bg-muted/35',
        tone === 'amber' && 'border-amber-500/35 bg-amber-500/8',
        tone === 'success' && 'border-emerald-500/35 bg-emerald-500/8',
        tone === 'danger' && 'border-red-500/35 bg-red-500/8',
        className
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeading({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b px-4 py-4 md:px-5">
      {icon ? (
        <div className="bg-primary/10 text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold md:text-base">{title}</h2>
        {description ? (
          <p className="text-muted-foreground mt-1 text-xs leading-5 md:text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Metric({
  label,
  value,
  detail,
  icon,
  accent = 'primary',
}: {
  label: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
  accent?: 'primary' | 'amber' | 'success' | 'danger';
}) {
  return (
    <div className="bg-card min-w-0 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">{label}</span>
        {icon ? (
          <span
            className={cn(
              'text-primary',
              accent === 'amber' && 'text-amber-600 dark:text-amber-300',
              accent === 'success' && 'text-emerald-600 dark:text-emerald-300',
              accent === 'danger' && 'text-red-600 dark:text-red-300'
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? (
        <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
      <Inbox className="text-muted-foreground size-8" />
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-1 max-w-md text-sm leading-6">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function InlineNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
