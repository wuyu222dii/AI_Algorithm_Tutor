import { ReactNode } from 'react';
import {
  listCoachShellProblemSummaries,
  runtimeEnabledLanguages,
} from '@/features/algorithm-coach/catalog-runtime.server';
import { CoachShell } from '@/features/algorithm-coach/components/coach-shell';

export const dynamic = 'force-dynamic';

export default async function AlgorithmCoachLayout({
  children,
}: {
  children: ReactNode;
}) {
  const problems = await listCoachShellProblemSummaries();
  const enabledLanguages = runtimeEnabledLanguages();
  return (
    <CoachShell problems={problems} enabledLanguages={enabledLanguages}>
      {children}
    </CoachShell>
  );
}
