import type { ReviewProgressState } from './learning-progress';
import type { CoachState, ImportedDraftRecord, Problem } from './types';

export const GUEST_CLAIM_ENVELOPE_VERSION = 2 as const;

export interface GuestClaimSnapshot {
  state: CoachState;
  importedProblem: Problem | null;
  importedDrafts: ImportedDraftRecord[];
  reviewProgress: ReviewProgressState;
}

export interface GuestClaimEnvelopeV2 {
  version: typeof GUEST_CLAIM_ENVELOPE_VERSION;
  claimId: string;
  targetUserId: string;
  snapshot: GuestClaimSnapshot;
  status: 'pending' | 'acknowledged';
  createdAt: string;
}

export interface GuestClaimResult {
  claimId: string;
  status: 'acknowledged';
  revision: number;
  replayed: boolean;
}
