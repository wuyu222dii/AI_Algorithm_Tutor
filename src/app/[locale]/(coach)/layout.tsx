import { ReactNode } from 'react';
import { CoachShell } from '@/features/algorithm-coach/components/coach-shell';

export default function AlgorithmCoachLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <CoachShell>{children}</CoachShell>;
}
