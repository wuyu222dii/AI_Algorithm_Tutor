'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  clearAnonymousProductEventOutbox,
  clearProductAnalytics,
  createProductEvent,
  ensureCoachGuestIdentity,
  flushAnonymousProductEventOutbox,
  getExperimentVariant,
  loadProductAnalytics,
  setProductAnalyticsScope,
  trackProductEvent,
} from './analytics';
import {
  claimGuestAssessmentDraft,
  clearAssessmentDraft,
} from './assessment-draft';
import {
  createDailyLearningPlan,
  getDailyPlanDateKey,
  skipDailyPlanTask as skipPlanTask,
  swapDailyPlanTask as swapPlanTask,
} from './daily-plan';
import {
  consumeImportedDraftClaimDropCount,
  ImportedDraftRecord,
  initializeImportedDrafts,
  loadImportedDraftClaimDropCount,
  mergeImportedDraftRecords,
  removeImportedDraftRecords,
  saveImportedDraftCollection,
  upsertImportedDraftRecords,
} from './imported-drafts';
import type { EnabledLanguage } from './languages';
import { buildCorrectionEpisodes } from './learning-evidence';
import {
  clearReviewProgress,
  createInitialReviewProgress,
  loadReviewProgress,
  markReviewItemMastered,
  mergeReviewProgress,
  migrateReviewProgress,
  rateReviewItem,
  reconcileReviewProgress,
  ReviewItem,
  ReviewProgressState,
  ReviewRating,
  saveReviewProgress,
} from './learning-progress';
import { calculateProductMetrics } from './metrics';
import {
  claimGuestPracticeContexts,
  clearPracticeContexts,
} from './practice-context';
import {
  acknowledgeGuestCoachClaim,
  claimGuestCoachData,
  clearCoachState,
  clearCoachSyncQueue,
  clearImportedProblem,
  CoachStorageScope,
  createInitialCoachState,
  GUEST_COACH_STORAGE_SCOPE,
  loadCoachRevision,
  loadCoachState,
  loadCoachSyncQueue,
  loadImportedProblem,
  mergeCoachStates,
  normalizeCoachState,
  saveImportedProblem as persistImportedProblem,
  prepareGuestCoachClaim,
  saveCoachRevision,
  saveCoachState,
  saveCoachSyncQueue,
} from './storage';
import {
  applyCoachSyncMutations,
  CoachSyncDocument,
  coachSyncRetryDelay,
  createCoachSyncMutation,
  filterUnappliedCoachMutations,
  getPracticeSessionKey,
  normalizeProblemContentVersion,
} from './sync';
import {
  classifyCoachSyncFailure,
  CoachSyncErrorKind,
  CoachSyncFailure,
  coachSyncFailureForResponse,
} from './sync-error';
import {
  AssessmentKind,
  AssessmentResult,
  AssessmentState,
  CoachState,
  CoachSyncMutation,
  CoachSyncResult,
  CodeRunResult,
  DailyLearningPlan,
  JsonValue,
  Language,
  LearningArtifact,
  LearningGoal,
  LearningProfile,
  Problem,
  ProblemCatalogItem,
  ProductEventName,
  ProductMetrics,
  ReviewAttempt,
} from './types';

const DEFAULT_ASSESSMENT_PROBLEMS = [
  'minimum-processing-rate',
  'dependency-cycle',
];

const cloudSyncEnabled =
  process.env.NEXT_PUBLIC_COACH_CLOUD_SYNC_ENABLED !== 'false';
const durableGuestClaimEnabled =
  process.env.NEXT_PUBLIC_DURABLE_GUEST_CLAIM_ENABLED === 'true';
const INITIAL_CLOUD_SYNC_TIMEOUT_MS = 5_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const parentSignal = init.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeParentAbortListener: (() => void) | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(
        new DOMException('The cloud sync request timed out.', 'TimeoutError')
      );
    }, timeoutMs);
  });
  const parentAbort = parentSignal
    ? new Promise<never>((_, reject) => {
        const abort = () => {
          controller.abort(parentSignal.reason);
          reject(
            parentSignal.reason instanceof Error
              ? parentSignal.reason
              : new DOMException(
                  'The cloud sync request was aborted.',
                  'AbortError'
                )
          );
        };
        if (parentSignal.aborted) {
          abort();
          return;
        }
        parentSignal.addEventListener('abort', abort, { once: true });
        removeParentAbortListener = () =>
          parentSignal.removeEventListener('abort', abort);
      })
    : null;

  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeout,
      ...(parentAbort ? [parentAbort] : []),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    removeParentAbortListener?.();
  }
}

type OnboardingInput = {
  goal: LearningGoal | string;
  preferredLanguage: Language;
  weeklyTarget?: number;
  weeklyGoal?: number;
  dailyMinutes?: number;
  onboardingCompleted?: boolean;
  createdAt?: string;
};

type RecordRun = {
  (
    problemSlug: string,
    result: CodeRunResult,
    options?: { submitted?: boolean }
  ): void;
  (result: CodeRunResult & { problemId?: string; passed?: boolean }): void;
};

type AssessmentInput = Partial<AssessmentResult> & {
  id: string;
  score: number;
  passedCount?: number;
  total?: number;
  problemIds?: string[];
  durationSeconds?: number;
};

export interface CoachStoreValue {
  state: CoachState;
  problems: readonly ProblemCatalogItem[];
  enabledLanguages: readonly EnabledLanguage[];
  metrics: ProductMetrics;
  reviewItems: Record<string, ReviewItem>;
  hydrated: boolean;
  storageScope: CoachStorageScope | null;
  importedProblem: Problem | null;
  importedDrafts: ImportedDraftRecord[];
  syncStatus: 'local' | 'syncing' | 'synced' | 'error';
  syncError: CoachSyncErrorKind | null;
  retrySync: () => void;
  completeOnboarding: (profile: OnboardingInput) => void;
  setPreferredLanguage: (language: Language) => void;
  saveCode: (
    problemSlug: string,
    language: Language,
    code: string,
    problemContentVersion?: number
  ) => void;
  flushCodeSnapshot: (
    problemSlug: string,
    language: Language,
    code: string,
    problemContentVersion?: number
  ) => void;
  recordRun: RecordRun;
  revealHint: (problemSlug: string, problemContentVersion?: number) => void;
  addArtifact: (artifact: LearningArtifact) => void;
  startAssessment: (
    problemSlugs?: string[],
    durationMinutes?: number,
    kind?: AssessmentKind,
    baselineAssessmentId?: string,
    session?: Pick<AssessmentState, 'id' | 'startedAt' | 'problemVersions'>
  ) => void;
  abandonAssessment: (assessmentId?: string) => void;
  completeAssessment: (result: AssessmentInput) => void;
  saveImportedProblem: (problem: Problem) => void;
  deleteImportedProblem: (slug: string) => void;
  ensureDailyPlan: (timeZone: string) => void;
  skipDailyPlanTask: (planId: string, taskId: string, reason: string) => void;
  swapDailyPlanTask: (planId: string, taskId: string, reason: string) => void;
  recordReviewAttempt: (attempt: ReviewAttempt) => void;
  rateReview: (
    problemSlug: string,
    rating: ReviewRating,
    options?: {
      attemptId?: string;
      suggestedRating?: ReviewRating;
      problemContentVersion?: number;
    }
  ) => void;
  markReviewMastered: (
    problemSlug: string,
    problemContentVersion?: number
  ) => void;
  trackEvent: (
    name: ProductEventName,
    options?: {
      problemSlug?: string;
      properties?: Record<string, JsonValue>;
    }
  ) => void;
  resetData: () => Promise<boolean>;
}

const CoachStoreContext = createContext<CoachStoreValue | null>(null);

const now = () => new Date().toISOString();

export function resolveBrowserTimeZone(): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
    if (!timeZone) return 'UTC';
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function createSession(problemSlug: string, problemContentVersion = 1) {
  const timestamp = now();
  return {
    problemSlug,
    problemContentVersion,
    code: {},
    runs: [],
    hintLevel: 0 as const,
    diagnosisCount: 0,
    correctedAfterDiagnosis: false,
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

function completeMatchingDailyPlanTasks(
  plans: Record<string, DailyLearningPlan>,
  problemSlug: string,
  problemContentVersion: number,
  completedAt: string,
  allowedKinds?: Set<DailyLearningPlan['tasks'][number]['kind']>
): {
  plans: Record<string, DailyLearningPlan>;
  completedTaskIds: string[];
} {
  const completedTaskIds: string[] = [];
  const nextPlans = Object.fromEntries(
    Object.entries(plans).map(([planId, plan]) => {
      if (getDailyPlanDateKey(completedAt, plan.timeZone) !== plan.localDate) {
        return [planId, plan];
      }
      let changed = false;
      const tasks = plan.tasks.map((task) => {
        if (
          task.status !== 'pending' ||
          task.problemSlug !== problemSlug ||
          task.problemContentVersion !== problemContentVersion ||
          (allowedKinds && !allowedKinds.has(task.kind))
        ) {
          return task;
        }
        changed = true;
        completedTaskIds.push(task.id);
        return { ...task, status: 'completed' as const, completedAt };
      });
      return [planId, changed ? { ...plan, tasks } : plan];
    })
  );
  return { plans: nextPlans, completedTaskIds };
}

export function CoachProvider({
  children,
  enabledLanguages = ['javascript', 'python'],
  problems = [],
  storageScope = GUEST_COACH_STORAGE_SCOPE,
}: {
  children: ReactNode;
  enabledLanguages?: readonly EnabledLanguage[];
  problems?: readonly ProblemCatalogItem[];
  storageScope?: CoachStorageScope | null;
}) {
  const [state, setState] = useState<CoachState>(createInitialCoachState);
  const [importedProblem, setImportedProblem] = useState<Problem | null>(null);
  const [importedDrafts, setImportedDrafts] = useState<ImportedDraftRecord[]>(
    []
  );
  const [reviewProgress, setReviewProgress] = useState<ReviewProgressState>(
    createInitialReviewProgress
  );
  const stateRef = useRef(state);
  const importedProblemRef = useRef(importedProblem);
  const importedDraftsRef = useRef(importedDrafts);
  const reviewProgressRef = useRef(reviewProgress);
  const activeScopeRef = useRef<CoachStorageScope | null>(null);
  const remoteSyncTimerRef = useRef<number | null>(null);
  const remoteRevisionRef = useRef(0);
  const remoteSyncGenerationRef = useRef(0);
  const remoteSyncInFlightRef = useRef(false);
  const remoteSyncAbortRef = useRef<AbortController | null>(null);
  const remoteLoadAbortRef = useRef<AbortController | null>(null);
  const remoteSyncRetryRef = useRef(0);
  const syncSucceededTrackedRef = useRef(false);
  const resettingRef = useRef(false);
  const guestClaimPendingRef = useRef(false);
  const remoteSyncQueueRef = useRef<CoachSyncMutation[]>([]);
  const observedDocumentRef = useRef<CoachSyncDocument | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    'local' | 'syncing' | 'synced' | 'error'
  >('local');
  const [syncError, setSyncError] = useState<CoachSyncErrorKind | null>(null);
  const [syncReloadVersion, setSyncReloadVersion] = useState(0);
  const [hydratedScope, setHydratedScope] = useState<CoachStorageScope | null>(
    null
  );
  const [reviewHydratedScope, setReviewHydratedScope] =
    useState<CoachStorageScope | null>(null);
  const hydrated = Boolean(
    storageScope &&
      hydratedScope &&
      reviewHydratedScope &&
      storageScope === hydratedScope &&
      storageScope === reviewHydratedScope
  );
  const problemContentVersion = useCallback(
    (problemSlug: string) =>
      problems.find((problem) => problem.slug === problemSlug)?.version
        ?.contentVersion ?? 1,
    [problems]
  );

  const flushRemoteSync = useCallback(async function flushRemoteSync() {
    if (
      remoteSyncInFlightRef.current ||
      resettingRef.current ||
      guestClaimPendingRef.current
    ) {
      return;
    }
    const scope = activeScopeRef.current;
    if (!scope || !scope.startsWith('user:')) return;
    const batch = remoteSyncQueueRef.current.slice(0, 50);
    if (!batch.length) return;
    const generation = remoteSyncGenerationRef.current;

    remoteSyncInFlightRef.current = true;
    const controller = new AbortController();
    remoteSyncAbortRef.current = controller;
    setSyncStatus('syncing');
    setSyncError(null);
    let retryScheduled = false;

    try {
      const response = await fetch('/api/coach/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: remoteRevisionRef.current,
          mutations: batch,
        }),
        signal: controller.signal,
      });
      if (
        generation !== remoteSyncGenerationRef.current ||
        activeScopeRef.current !== scope
      ) {
        return;
      }
      if (response.status === 409) {
        const conflictPayload = (await response.json().catch(() => null)) as {
          error?: {
            details?: { replayedMutationIds?: string[] };
          };
        } | null;
        const replayedMutationIds =
          conflictPayload?.error?.details?.replayedMutationIds ?? [];
        if (replayedMutationIds.length) {
          remoteSyncQueueRef.current = saveCoachSyncQueue(
            filterUnappliedCoachMutations(
              remoteSyncQueueRef.current,
              replayedMutationIds
            ),
            undefined,
            scope
          );
        }
        const latestResponse = await fetch('/api/coach/state', {
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!latestResponse.ok) {
          throw coachSyncFailureForResponse(latestResponse, 'conflict');
        }
        const latestPayload = (await latestResponse.json()) as {
          data?: {
            state?: CoachState;
            importedProblem?: Problem | null;
            importedDrafts?: ImportedDraftRecord[];
            reviewProgress?: ReviewProgressState;
            revision?: number;
          };
        };
        const latestState = latestPayload.data?.state;
        const latestRevision = Number(latestPayload.data?.revision);
        if (
          !latestState ||
          !Number.isInteger(latestRevision) ||
          latestRevision < 0
        ) {
          throw new CoachSyncFailure(
            'conflict',
            'Conflict recovery returned invalid learning data'
          );
        }
        const remoteDocument: CoachSyncDocument = {
          state: latestState,
          importedProblem: latestPayload.data?.importedProblem ?? null,
          importedDrafts:
            latestPayload.data?.importedDrafts ??
            (latestPayload.data?.importedProblem
              ? [
                  {
                    problem: latestPayload.data.importedProblem,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  },
                ]
              : []),
          reviewProgress: migrateReviewProgress(
            latestPayload.data?.reviewProgress
          ),
        };
        const merged = applyCoachSyncMutations(
          remoteDocument,
          remoteSyncQueueRef.current
        );
        const recoveryMutation = createCoachSyncMutation(
          remoteDocument,
          merged,
          latestRevision
        );

        remoteRevisionRef.current = latestRevision;
        saveCoachRevision(latestRevision, undefined, scope);
        remoteSyncQueueRef.current = saveCoachSyncQueue(
          recoveryMutation ? [recoveryMutation] : [],
          undefined,
          scope
        );
        observedDocumentRef.current = merged;
        stateRef.current = merged.state;
        importedProblemRef.current = merged.importedProblem;
        importedDraftsRef.current = merged.importedDrafts;
        reviewProgressRef.current = merged.reviewProgress;
        saveCoachState(merged.state, undefined, scope);
        saveReviewProgress(merged.reviewProgress, undefined, scope);
        saveImportedDraftCollection(merged.importedDrafts, undefined, scope);
        if (merged.importedProblem) {
          persistImportedProblem(merged.importedProblem, undefined, scope);
        } else {
          clearImportedProblem(undefined, scope);
        }
        setState(merged.state);
        setImportedProblem(merged.importedProblem);
        setImportedDrafts(merged.importedDrafts);
        setReviewProgress(merged.reviewProgress);
        remoteSyncRetryRef.current = 0;
        if (recoveryMutation) {
          retryScheduled = true;
          remoteSyncTimerRef.current = window.setTimeout(() => {
            remoteSyncTimerRef.current = null;
            void flushRemoteSync();
          }, 0);
        } else {
          setSyncStatus('synced');
          setSyncError(null);
        }
        return;
      }
      if (!response.ok) throw coachSyncFailureForResponse(response);
      const payload = (await response.json()) as {
        data?: Partial<CoachSyncResult>;
      };
      const revision = payload.data?.revision;
      if (!Number.isInteger(revision) || Number(revision) < 0) {
        throw new Error('Sync response did not include a valid revision');
      }
      const acknowledged = new Set([
        ...(payload.data?.appliedMutationIds ?? []),
        ...(payload.data?.replayedMutationIds ?? []),
      ]);
      // Compatibility with an early incremental endpoint implementation.
      if (!acknowledged.size) {
        for (const mutation of batch) acknowledged.add(mutation.id);
      }
      remoteSyncQueueRef.current = saveCoachSyncQueue(
        remoteSyncQueueRef.current.filter(
          (mutation) => !acknowledged.has(mutation.id)
        ),
        undefined,
        scope
      );
      remoteRevisionRef.current = Number(revision);
      saveCoachRevision(Number(revision), undefined, scope);
      remoteSyncRetryRef.current = 0;
      const hasPendingMutations = remoteSyncQueueRef.current.length > 0;
      setSyncStatus(hasPendingMutations ? 'syncing' : 'synced');
      setSyncError(null);
      if (!hasPendingMutations && !syncSucceededTrackedRef.current) {
        syncSucceededTrackedRef.current = true;
        trackProductEvent('sync_succeeded', {
          properties: { revision: Number(revision) },
        });
      }
    } catch (error) {
      if (
        generation === remoteSyncGenerationRef.current &&
        !(error instanceof DOMException && error.name === 'AbortError')
      ) {
        setSyncStatus('error');
        const errorKind = classifyCoachSyncFailure(error);
        setSyncError(errorKind);
        const attempt = remoteSyncRetryRef.current++;
        trackProductEvent('sync_failed', {
          properties: { attempt: attempt + 1, reason: errorKind },
        });
        const delay = coachSyncRetryDelay(attempt);
        retryScheduled = true;
        remoteSyncTimerRef.current = window.setTimeout(() => {
          remoteSyncTimerRef.current = null;
          void flushRemoteSync();
        }, delay);
      }
    } finally {
      if (remoteSyncAbortRef.current === controller) {
        remoteSyncInFlightRef.current = false;
        remoteSyncAbortRef.current = null;
        if (
          generation === remoteSyncGenerationRef.current &&
          remoteSyncQueueRef.current.length &&
          !retryScheduled &&
          !resettingRef.current
        ) {
          void flushRemoteSync();
        }
      }
    }
  }, []);

  const retrySync = useCallback(() => {
    if (resettingRef.current) return;
    setSyncError(null);
    setSyncStatus('syncing');
    if (guestClaimPendingRef.current || !remoteSyncQueueRef.current.length) {
      setSyncReloadVersion((current) => current + 1);
      return;
    }
    remoteSyncRetryRef.current = 0;
    syncSucceededTrackedRef.current = false;
    if (remoteSyncTimerRef.current !== null) {
      window.clearTimeout(remoteSyncTimerRef.current);
    }
    remoteSyncTimerRef.current = window.setTimeout(() => {
      remoteSyncTimerRef.current = null;
      void flushRemoteSync();
    }, 0);
  }, [flushRemoteSync]);

  useEffect(() => {
    let cancelled = false;
    remoteSyncGenerationRef.current += 1;
    const generation = remoteSyncGenerationRef.current;
    remoteSyncAbortRef.current?.abort();
    remoteSyncAbortRef.current = null;
    remoteLoadAbortRef.current?.abort();
    remoteLoadAbortRef.current = null;
    remoteSyncInFlightRef.current = false;
    remoteSyncRetryRef.current = 0;
    syncSucceededTrackedRef.current = false;
    remoteSyncQueueRef.current = [];
    observedDocumentRef.current = null;
    resettingRef.current = false;
    guestClaimPendingRef.current = false;
    remoteRevisionRef.current = 0;
    setSyncError(null);
    activeScopeRef.current = null;
    setProductAnalyticsScope(null);

    if (!storageScope) return;

    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setSyncStatus(
          cloudSyncEnabled && storageScope.startsWith('user:')
            ? 'syncing'
            : 'local'
        );
      }
      void (async () => {
        ensureCoachGuestIdentity();
        const targetUserId = storageScope.startsWith('user:')
          ? storageScope.slice('user:'.length)
          : null;
        const guestClaimEnvelope =
          durableGuestClaimEnabled && targetUserId
            ? prepareGuestCoachClaim(targetUserId, storageScope)
            : null;
        guestClaimPendingRef.current = Boolean(guestClaimEnvelope);
        let claimedGuest = durableGuestClaimEnabled
          ? false
          : claimGuestCoachData(storageScope);
        const droppedClaimedDrafts =
          loadImportedDraftClaimDropCount(storageScope);
        if (claimedGuest) {
          claimGuestPracticeContexts(storageScope, undefined, {
            clearGuest: !durableGuestClaimEnabled,
          });
          claimGuestAssessmentDraft(storageScope, undefined, {
            clearGuest: !durableGuestClaimEnabled,
          });
        }
        const storedState = loadCoachState(undefined, storageScope);
        let nextState = storedState;
        const browserTimeZone = resolveBrowserTimeZone();
        const profileTimeZoneChanged = Boolean(
          nextState.profile && nextState.profile.timeZone !== browserTimeZone
        );
        if (profileTimeZoneChanged && nextState.profile) {
          nextState = {
            ...nextState,
            profile: { ...nextState.profile, timeZone: browserTimeZone },
          };
        }
        const analyticsEvents = loadProductAnalytics(storageScope);
        if (analyticsEvents.length) {
          const eventsById = new Map(
            [...nextState.events, ...analyticsEvents].map((event) => [
              event.id,
              event,
            ])
          );
          nextState = {
            ...nextState,
            events: Array.from(eventsById.values()).slice(-300),
          };
        }
        let nextImportedProblem = loadImportedProblem(undefined, storageScope);
        let nextImportedDrafts = initializeImportedDrafts(
          nextImportedProblem,
          undefined,
          storageScope
        );
        let nextReviewProgress = loadReviewProgress(undefined, storageScope);
        const localRevision = loadCoachRevision(undefined, storageScope);
        const queuedMutations = loadCoachSyncQueue(undefined, storageScope);
        remoteSyncQueueRef.current = queuedMutations;
        remoteRevisionRef.current = localRevision;

        if (
          (claimedGuest || droppedClaimedDrafts > 0) &&
          (droppedClaimedDrafts > 0 ||
            !nextState.events.some(
              (event) => event.name === 'guest_data_claimed'
            ))
        ) {
          const event = trackProductEvent(
            'guest_data_claimed',
            {
              properties: {
                destination: 'account',
                droppedImportedDrafts: droppedClaimedDrafts,
              },
            },
            storageScope
          );
          nextState = {
            ...nextState,
            events: [...nextState.events, event].slice(-300),
          };
          consumeImportedDraftClaimDropCount(storageScope);
        }

        const localDocument: CoachSyncDocument = {
          state: nextState,
          importedProblem: nextImportedProblem,
          importedDrafts: nextImportedDrafts,
          reviewProgress: nextReviewProgress,
        };
        if (
          profileTimeZoneChanged &&
          cloudSyncEnabled &&
          storageScope.startsWith('user:')
        ) {
          const timeZoneMutation = createCoachSyncMutation(
            { ...localDocument, state: storedState },
            localDocument,
            localRevision
          );
          if (timeZoneMutation) {
            remoteSyncQueueRef.current = saveCoachSyncQueue(
              [...remoteSyncQueueRef.current, timeZoneMutation],
              undefined,
              storageScope
            );
          }
        }
        activeScopeRef.current = storageScope;
        stateRef.current = nextState;
        importedProblemRef.current = nextImportedProblem;
        importedDraftsRef.current = nextImportedDrafts;
        reviewProgressRef.current = nextReviewProgress;
        observedDocumentRef.current = localDocument;
        setProductAnalyticsScope(storageScope);
        setState(nextState);
        setImportedProblem(nextImportedProblem);
        setImportedDrafts(nextImportedDrafts);
        setReviewProgress(nextReviewProgress);
        setHydratedScope(storageScope);
        setReviewHydratedScope(storageScope);

        if (cloudSyncEnabled && storageScope.startsWith('user:')) {
          const loadController = new AbortController();
          remoteLoadAbortRef.current = loadController;
          try {
            if (guestClaimEnvelope) {
              try {
                const claimResponse = await fetchWithTimeout(
                  '/api/coach/state/claim',
                  {
                    method: 'POST',
                    headers: {
                      accept: 'application/json',
                      'content-type': 'application/json',
                    },
                    credentials: 'same-origin',
                    cache: 'no-store',
                    signal: loadController.signal,
                    body: JSON.stringify(guestClaimEnvelope),
                  },
                  INITIAL_CLOUD_SYNC_TIMEOUT_MS
                );
                if (claimResponse.ok) {
                  const claimPayload = (await claimResponse.json()) as {
                    data?: {
                      claimId?: string;
                      status?: 'acknowledged';
                      revision?: number;
                      replayed?: boolean;
                    };
                  };
                  const revision = Number(claimPayload.data?.revision);
                  if (
                    claimPayload.data?.claimId === guestClaimEnvelope.claimId &&
                    claimPayload.data.status === 'acknowledged' &&
                    Number.isInteger(revision) &&
                    revision >= 0
                  ) {
                    const eventsDrained =
                      await flushAnonymousProductEventOutbox({ drain: true });
                    if (eventsDrained) {
                      claimGuestPracticeContexts(storageScope, undefined, {
                        clearGuest: false,
                      });
                      claimGuestAssessmentDraft(storageScope, undefined, {
                        clearGuest: false,
                      });
                    }
                    const acknowledged =
                      eventsDrained &&
                      acknowledgeGuestCoachClaim(storageScope, {
                        claimId: guestClaimEnvelope.claimId,
                        status: 'acknowledged',
                        revision,
                        replayed: Boolean(claimPayload.data.replayed),
                      });
                    if (acknowledged) {
                      claimedGuest = true;
                      guestClaimPendingRef.current = false;
                      clearAnonymousProductEventOutbox();
                      clearPracticeContexts(
                        undefined,
                        GUEST_COACH_STORAGE_SCOPE
                      );
                      clearAssessmentDraft(GUEST_COACH_STORAGE_SCOPE);
                      remoteRevisionRef.current = revision;
                    }
                  }
                }
              } catch {
                // The pending envelope remains durable and is replayed later.
              }
            }
            const response = await fetchWithTimeout(
              '/api/coach/state',
              {
                headers: { accept: 'application/json' },
                cache: 'no-store',
                signal: loadController.signal,
              },
              INITIAL_CLOUD_SYNC_TIMEOUT_MS
            );
            if (!response.ok) throw coachSyncFailureForResponse(response);
            const payload = (await response.json()) as {
              data?: {
                state?: CoachState;
                importedProblem?: Problem | null;
                importedDrafts?: ImportedDraftRecord[];
                reviewProgress?: ReviewProgressState;
                hasData?: boolean;
                revision?: number;
              };
            };
            if (
              cancelled ||
              generation !== remoteSyncGenerationRef.current ||
              activeScopeRef.current !== storageScope
            ) {
              return;
            }
            const remoteState = payload.data?.state
              ? normalizeCoachState(payload.data.state)
              : undefined;
            const remoteRevision = Number(payload.data?.revision ?? 0);
            const latestLocalDocument =
              observedDocumentRef.current ?? localDocument;
            const pendingMutations = remoteSyncQueueRef.current;
            nextState = latestLocalDocument.state;
            nextImportedProblem = latestLocalDocument.importedProblem;
            nextImportedDrafts = latestLocalDocument.importedDrafts;
            nextReviewProgress = latestLocalDocument.reviewProgress;
            if (
              remoteState &&
              Number.isInteger(remoteRevision) &&
              remoteRevision >= 0
            ) {
              const remoteLegacyTimestamp = new Date().toISOString();
              const remoteImportedDrafts =
                payload.data?.importedDrafts ??
                (payload.data?.importedProblem
                  ? [
                      {
                        problem: payload.data.importedProblem,
                        createdAt: remoteLegacyTimestamp,
                        updatedAt: remoteLegacyTimestamp,
                      },
                    ]
                  : []);
              const remoteDocument: CoachSyncDocument = {
                state: remoteState,
                importedProblem: payload.data?.importedProblem ?? null,
                importedDrafts: remoteImportedDrafts,
                reviewProgress: migrateReviewProgress(
                  payload.data?.reviewProgress
                ),
              };
              remoteRevisionRef.current = remoteRevision;
              saveCoachRevision(remoteRevision, undefined, storageScope);
              const shouldPreserveLocal =
                claimedGuest ||
                (!guestClaimPendingRef.current &&
                  remoteRevision <= localRevision);
              const shouldPreserveLocalReview =
                shouldPreserveLocal || !payload.data?.reviewProgress;
              if (pendingMutations.length && !claimedGuest) {
                const replayed = applyCoachSyncMutations(
                  remoteDocument,
                  pendingMutations
                );
                nextState = replayed.state;
                nextImportedProblem = replayed.importedProblem;
                nextImportedDrafts = replayed.importedDrafts;
                nextReviewProgress = replayed.reviewProgress;
              } else if (shouldPreserveLocal) {
                nextState = mergeCoachStates(nextState, remoteState);
                nextImportedDrafts = mergeImportedDraftRecords(
                  remoteImportedDrafts,
                  nextImportedDrafts
                );
                nextImportedProblem =
                  nextImportedDrafts.find(
                    (record) =>
                      record.problem.slug === nextImportedProblem?.slug
                  )?.problem ??
                  payload.data?.importedProblem ??
                  nextImportedDrafts[0]?.problem ??
                  null;
              } else {
                nextState = remoteState;
                nextImportedDrafts = remoteImportedDrafts;
                nextImportedProblem = payload.data?.importedProblem ?? null;
              }
              if (!(pendingMutations.length && !claimedGuest)) {
                nextReviewProgress = shouldPreserveLocalReview
                  ? mergeReviewProgress(
                      nextReviewProgress,
                      remoteDocument.reviewProgress
                    )
                  : remoteDocument.reviewProgress;
              }

              if (
                !guestClaimPendingRef.current &&
                (shouldPreserveLocalReview || claimedGuest) &&
                (!pendingMutations.length || claimedGuest)
              ) {
                const initialMutation = createCoachSyncMutation(
                  remoteDocument,
                  {
                    state: nextState,
                    importedProblem: nextImportedProblem,
                    importedDrafts: nextImportedDrafts,
                    reviewProgress: nextReviewProgress,
                  },
                  remoteRevision
                );
                if (initialMutation) {
                  remoteSyncQueueRef.current = saveCoachSyncQueue(
                    [initialMutation],
                    undefined,
                    storageScope
                  );
                }
              }

              if (
                claimedGuest &&
                !nextState.events.some(
                  (event) => event.name === 'guest_data_claimed'
                )
              ) {
                nextState = {
                  ...nextState,
                  events: [
                    ...nextState.events,
                    trackProductEvent(
                      'guest_data_claimed',
                      {
                        properties: {
                          destination: 'account',
                          droppedImportedDrafts: droppedClaimedDrafts,
                        },
                      },
                      storageScope
                    ),
                  ].slice(-300),
                };
                consumeImportedDraftClaimDropCount(storageScope);
              }

              const mergedDocument: CoachSyncDocument = {
                state: nextState,
                importedProblem: nextImportedProblem,
                importedDrafts: nextImportedDrafts,
                reviewProgress: nextReviewProgress,
              };
              observedDocumentRef.current = mergedDocument;
              stateRef.current = nextState;
              importedProblemRef.current = nextImportedProblem;
              importedDraftsRef.current = nextImportedDrafts;
              reviewProgressRef.current = nextReviewProgress;
              setState(nextState);
              setImportedProblem(nextImportedProblem);
              setImportedDrafts(nextImportedDrafts);
              setReviewProgress(nextReviewProgress);
            }
            if (!cancelled) {
              if (guestClaimPendingRef.current) {
                setSyncStatus('error');
                setSyncError('conflict');
              } else {
                setSyncStatus(
                  remoteSyncQueueRef.current.length ? 'syncing' : 'synced'
                );
              }
            }
          } catch (error) {
            // The local cache keeps the learning workflow usable while offline.
            if (
              !cancelled &&
              generation === remoteSyncGenerationRef.current &&
              activeScopeRef.current === storageScope
            ) {
              setSyncStatus('error');
              setSyncError(classifyCoachSyncFailure(error));
            }
          } finally {
            if (remoteLoadAbortRef.current === loadController) {
              remoteLoadAbortRef.current = null;
            }
          }
        }
        if (cancelled) return;
        if (
          cloudSyncEnabled &&
          storageScope.startsWith('user:') &&
          !guestClaimPendingRef.current &&
          remoteSyncQueueRef.current.length
        ) {
          remoteSyncTimerRef.current = window.setTimeout(() => {
            remoteSyncTimerRef.current = null;
            void flushRemoteSync();
          }, 0);
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      remoteSyncGenerationRef.current += 1;
      window.clearTimeout(timeout);
      if (remoteSyncTimerRef.current !== null) {
        window.clearTimeout(remoteSyncTimerRef.current);
        remoteSyncTimerRef.current = null;
      }
      remoteSyncAbortRef.current?.abort();
      remoteSyncAbortRef.current = null;
      remoteLoadAbortRef.current?.abort();
      remoteLoadAbortRef.current = null;
      if (activeScopeRef.current === storageScope) {
        activeScopeRef.current = null;
        setProductAnalyticsScope(null);
      }
    };
  }, [flushRemoteSync, storageScope, syncReloadVersion]);

  useEffect(() => {
    if (!hydrated) return;
    setReviewProgress((current) =>
      reconcileReviewProgress(state, current, { catalog: problems })
    );
  }, [hydrated, problems, state]);

  useEffect(() => {
    reviewProgressRef.current = reviewProgress;
    const activeScope = activeScopeRef.current;
    if (activeScope && hydrated && activeScope === storageScope) {
      saveReviewProgress(reviewProgress, undefined, activeScope);
    }
  }, [hydrated, reviewProgress, storageScope]);

  useEffect(() => {
    const nextDocument: CoachSyncDocument = {
      state,
      importedProblem,
      importedDrafts,
      reviewProgress,
    };
    const previousDocument = observedDocumentRef.current;
    stateRef.current = state;
    importedProblemRef.current = importedProblem;
    importedDraftsRef.current = importedDrafts;
    const activeScope = activeScopeRef.current;
    if (activeScope && hydrated && hydratedScope === activeScope) {
      saveCoachState(state, undefined, activeScope);
      saveImportedDraftCollection(importedDrafts, undefined, activeScope);
      if (importedProblem) {
        persistImportedProblem(importedProblem, undefined, activeScope);
      } else {
        clearImportedProblem(undefined, activeScope);
      }

      if (
        cloudSyncEnabled &&
        activeScope.startsWith('user:') &&
        !guestClaimPendingRef.current &&
        !resettingRef.current &&
        previousDocument
      ) {
        const mutation = createCoachSyncMutation(
          previousDocument,
          nextDocument,
          remoteRevisionRef.current
        );
        if (mutation) {
          remoteSyncQueueRef.current = saveCoachSyncQueue(
            [...remoteSyncQueueRef.current, mutation],
            undefined,
            activeScope
          );
          setSyncStatus('syncing');
          if (remoteSyncTimerRef.current !== null) {
            window.clearTimeout(remoteSyncTimerRef.current);
          }
          remoteSyncTimerRef.current = window.setTimeout(() => {
            remoteSyncTimerRef.current = null;
            void flushRemoteSync();
          }, 1500);
        }
      }
      observedDocumentRef.current = nextDocument;
    }
  }, [
    flushRemoteSync,
    hydrated,
    hydratedScope,
    importedProblem,
    importedDrafts,
    reviewProgress,
    state,
  ]);

  useEffect(() => {
    const flush = () => {
      const activeScope = activeScopeRef.current;
      if (activeScope) {
        saveCoachState(stateRef.current, undefined, activeScope);
        saveReviewProgress(reviewProgressRef.current, undefined, activeScope);
        const imported = importedProblemRef.current;
        saveImportedDraftCollection(
          importedDraftsRef.current,
          undefined,
          activeScope
        );
        if (imported) {
          persistImportedProblem(imported, undefined, activeScope);
        }
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  useEffect(() => {
    const retryWhenOnline = () => {
      if (guestClaimPendingRef.current) {
        setSyncReloadVersion((current) => current + 1);
        return;
      }
      if (!remoteSyncQueueRef.current.length) return;
      remoteSyncRetryRef.current = 0;
      if (remoteSyncTimerRef.current !== null) {
        window.clearTimeout(remoteSyncTimerRef.current);
      }
      remoteSyncTimerRef.current = window.setTimeout(() => {
        remoteSyncTimerRef.current = null;
        void flushRemoteSync();
      }, 0);
    };
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  }, [flushRemoteSync]);

  const completeOnboarding = useCallback((input: OnboardingInput) => {
    const requestedTarget = input.weeklyTarget ?? input.weeklyGoal ?? 5;
    const target = Number.isFinite(requestedTarget) ? requestedTarget : 5;
    const requestedMinutes = Number(input.dailyMinutes ?? 30);
    const dailyMinutes = Number.isFinite(requestedMinutes)
      ? Math.min(180, Math.max(10, Math.round(requestedMinutes)))
      : 30;
    const goal: LearningGoal = ['foundation', 'interview', 'contest'].includes(
      input.goal
    )
      ? (input.goal as LearningGoal)
      : 'interview';
    const profile: LearningProfile = {
      goal,
      preferredLanguage: input.preferredLanguage,
      weeklyTarget: Math.min(14, Math.max(1, Math.round(target))),
      dailyMinutes,
      weeklyGoal: Math.min(14, Math.max(1, Math.round(target))),
      onboardingCompleted: true,
      createdAt: input.createdAt ?? now(),
      onboardedAt: now(),
      timeZone: resolveBrowserTimeZone(),
    };
    const event = trackProductEvent('activated', {
      properties: {
        goal: profile.goal,
        language: profile.preferredLanguage,
        weeklyTarget: profile.weeklyTarget,
        dailyMinutes,
      },
    });
    setState((current) => ({
      ...current,
      profile,
      events: [...current.events, event].slice(-300),
    }));
  }, []);

  const setPreferredLanguage = useCallback(
    (language: Language) => {
      if (!enabledLanguages.some((item) => item === language)) return;
      setState((current) => {
        if (!current.profile) return current;
        const event = trackProductEvent('language_selected', {
          properties: { language },
        });
        return {
          ...current,
          profile: { ...current.profile, preferredLanguage: language },
          events: [...current.events, event].slice(-300),
        };
      });
    },
    [enabledLanguages]
  );

  const saveCode = useCallback(
    (
      problemSlug: string,
      language: Language,
      code: string,
      requestedContentVersion?: number
    ) => {
      setState((current) => {
        const contentVersion = normalizeProblemContentVersion(
          requestedContentVersion ?? problemContentVersion(problemSlug)
        );
        const sessionKey = getPracticeSessionKey(problemSlug, contentVersion);
        const existing = current.sessions[sessionKey];
        const session = existing ?? createSession(problemSlug, contentVersion);
        const event = existing
          ? null
          : trackProductEvent('practice_started', { problemSlug });
        return {
          ...current,
          sessions: {
            ...current.sessions,
            [sessionKey]: {
              ...session,
              code: { ...session.code, [language]: code },
              updatedAt: now(),
            },
          },
          code: {
            ...current.code,
            [sessionKey]: {
              ...current.code[sessionKey],
              [language]: code,
            },
          },
          events: event
            ? [...current.events, event].slice(-300)
            : current.events,
        };
      });
    },
    [problemContentVersion]
  );

  const flushCodeSnapshot = useCallback(
    (
      problemSlug: string,
      language: Language,
      code: string,
      requestedContentVersion?: number
    ) => {
      const current = stateRef.current;
      const contentVersion = normalizeProblemContentVersion(
        requestedContentVersion ?? problemContentVersion(problemSlug)
      );
      const sessionKey = getPracticeSessionKey(problemSlug, contentVersion);
      const session =
        current.sessions[sessionKey] ??
        createSession(problemSlug, contentVersion);
      const next: CoachState = {
        ...current,
        sessions: {
          ...current.sessions,
          [sessionKey]: {
            ...session,
            code: { ...session.code, [language]: code },
            updatedAt: now(),
          },
        },
        code: {
          ...current.code,
          [sessionKey]: {
            ...current.code[sessionKey],
            [language]: code,
          },
        },
      };
      stateRef.current = next;
      const activeScope = activeScopeRef.current;
      if (activeScope) saveCoachState(next, undefined, activeScope);
    },
    [problemContentVersion]
  );

  const recordRun = useCallback(
    (
      problemOrResult:
        | string
        | (CodeRunResult & { problemId?: string; passed?: boolean }),
      maybeResult?: CodeRunResult,
      maybeOptions: { submitted?: boolean } = {}
    ) => {
      const result =
        typeof problemOrResult === 'string' ? maybeResult : problemOrResult;
      if (!result) return;
      const legacyResult = result as CodeRunResult & {
        problemId?: string;
        passed?: boolean;
        tests?: Array<{ passed?: boolean }>;
      };
      const problemSlug =
        result.problemSlug ||
        legacyResult.problemId ||
        (typeof problemOrResult === 'string' ? problemOrResult : 'unknown');
      const options =
        typeof problemOrResult === 'string'
          ? maybeOptions
          : { submitted: false };
      setState((current) => {
        const contentVersion = normalizeProblemContentVersion(
          result.problemContentVersion ?? problemContentVersion(problemSlug)
        );
        const sessionKey = getPracticeSessionKey(problemSlug, contentVersion);
        const session =
          current.sessions[sessionKey] ??
          createSession(problemSlug, contentVersion);
        const storedResult: CodeRunResult = {
          ...result,
          id: result.id ?? crypto.randomUUID(),
          codeSnapshot:
            result.codeSnapshot ??
            session.code[result.language] ??
            current.code[sessionKey]?.[result.language] ??
            '',
          submitted: options.submitted ?? result.submitted ?? false,
          problemContentVersion: contentVersion,
          testScope:
            result.testScope ?? (options.submitted ? 'full' : 'unknown'),
        };
        const passed =
          result.status === 'passed' ||
          legacyResult.passed === true ||
          Boolean(
            legacyResult.tests?.length &&
              legacyResult.tests.every((test) => test.passed)
          );
        const completedPass = passed && storedResult.testScope !== 'sample';
        const corrected =
          completedPass &&
          session.diagnosisCount > 0 &&
          !session.correctedAfterDiagnosis;
        const runEvent = trackProductEvent(
          options.submitted ? 'code_submitted' : 'code_run',
          {
            problemSlug,
            properties: {
              status: result.status,
              passedTests: result.passedTests,
              totalTests: result.totalTests,
              durationMs: result.durationMs,
            },
          }
        );
        const correctionEvent = corrected
          ? trackProductEvent('corrected_after_diagnosis', { problemSlug })
          : null;
        const firstRunEvent = current.events.some(
          (event) =>
            event.name === 'first_code_run' ||
            event.name === 'code_run' ||
            event.name === 'code_submitted'
        )
          ? null
          : trackProductEvent('first_code_run', {
              problemSlug,
              properties: { language: result.language },
            });
        const hasCompletedProblem = current.completedProblemIds.length > 0;
        const firstPassEvent =
          completedPass &&
          !hasCompletedProblem &&
          !current.events.some((event) => event.name === 'first_problem_passed')
            ? trackProductEvent('first_problem_passed', {
                problemSlug,
                properties: {
                  language: result.language,
                  runCount: session.runs.length + 1,
                },
              })
            : null;
        const allRuns = [...current.runs, storedResult].slice(-200);
        const correctionEpisodes = buildCorrectionEpisodes(
          allRuns,
          current.artifacts
        ).slice(-100);
        const previouslyResolvedEpisodeIds = new Set(
          current.correctionEpisodes
            .filter((episode) => episode.resolved)
            .map((episode) => episode.id)
        );
        const newlyResolvedEpisodes = correctionEpisodes.filter(
          (episode) =>
            episode.resolved && !previouslyResolvedEpisodeIds.has(episode.id)
        );
        const planCompletion = completedPass
          ? completeMatchingDailyPlanTasks(
              current.dailyPlans,
              problemSlug,
              contentVersion,
              storedResult.executedAt
            )
          : { plans: current.dailyPlans, completedTaskIds: [] };
        const planEvents = planCompletion.completedTaskIds.map((taskId) =>
          trackProductEvent('daily_plan_task_completed', {
            problemSlug,
            properties: { taskId, completion: 'code_pass' },
          })
        );
        const correctionEpisodeEvents = newlyResolvedEpisodes.map((episode) =>
          trackProductEvent('correction_episode_completed', {
            problemSlug,
            properties: {
              episodeId: episode.id,
              diagnosisCategory: episode.diagnosisCategory,
              passedWithinThreeRuns: episode.passedWithinThreeRuns,
              repairDurationMs: episode.repairDurationMs ?? 0,
            },
          })
        );
        return {
          ...current,
          sessions: {
            ...current.sessions,
            [sessionKey]: {
              ...session,
              runs: [...session.runs, storedResult].slice(-30),
              correctedAfterDiagnosis:
                session.correctedAfterDiagnosis || corrected,
              updatedAt: now(),
              completedAt: completedPass ? now() : session.completedAt,
            },
          },
          runs: allRuns,
          dailyPlans: planCompletion.plans,
          correctionEpisodes,
          completedProblemIds: completedPass
            ? Array.from(
                new Set([
                  ...current.completedProblemIds,
                  problemSlug,
                  ...(legacyResult.problemId ? [legacyResult.problemId] : []),
                ])
              )
            : current.completedProblemIds,
          events: [
            ...current.events,
            ...(firstRunEvent ? [firstRunEvent] : []),
            runEvent,
            ...(correctionEvent ? [correctionEvent] : []),
            ...(firstPassEvent ? [firstPassEvent] : []),
            ...planEvents,
            ...correctionEpisodeEvents,
          ].slice(-300),
        };
      });
    },
    [problemContentVersion]
  ) as RecordRun;

  const revealHint = useCallback(
    (problemSlug: string, requestedContentVersion?: number) => {
      setState((current) => {
        const contentVersion = normalizeProblemContentVersion(
          requestedContentVersion ?? problemContentVersion(problemSlug)
        );
        const sessionKey = getPracticeSessionKey(problemSlug, contentVersion);
        const session =
          current.sessions[sessionKey] ??
          createSession(problemSlug, contentVersion);
        if (session.hintLevel >= 3) return current;
        const hintLevel = (session.hintLevel + 1) as 1 | 2 | 3;
        const event = trackProductEvent('hint_revealed', {
          problemSlug,
          properties: {
            hintLevel,
            experimentVariant: getExperimentVariant(problemSlug),
          },
        });
        return {
          ...current,
          sessions: {
            ...current.sessions,
            [sessionKey]: { ...session, hintLevel, updatedAt: now() },
          },
          events: [...current.events, event].slice(-300),
        };
      });
    },
    [problemContentVersion]
  );

  const addArtifact = useCallback(
    (artifact: LearningArtifact) => {
      setState((current) => {
        const problemSlug =
          artifact.problemSlug ??
          (artifact as LearningArtifact & { problemId?: string }).problemId;
        const shouldCountDiagnosis =
          artifact.type === 'diagnose' && problemSlug;
        const contentVersion = problemSlug
          ? normalizeProblemContentVersion(
              artifact.problemContentVersion ??
                problemContentVersion(problemSlug)
            )
          : undefined;
        const sessionKey = problemSlug
          ? getPracticeSessionKey(problemSlug, contentVersion)
          : null;
        const session = problemSlug
          ? (current.sessions[sessionKey!] ??
            createSession(problemSlug, contentVersion))
          : null;
        const storedArtifact = problemSlug
          ? { ...artifact, problemSlug, problemContentVersion: contentVersion }
          : artifact;
        const event = shouldCountDiagnosis
          ? trackProductEvent('diagnosis_requested', { problemSlug })
          : null;
        const artifacts = [...current.artifacts, storedArtifact].slice(-100);
        return {
          ...current,
          artifacts,
          correctionEpisodes: buildCorrectionEpisodes(
            current.runs,
            artifacts
          ).slice(-100),
          sessions:
            shouldCountDiagnosis && session
              ? {
                  ...current.sessions,
                  [sessionKey!]: {
                    ...session,
                    diagnosisCount: session.diagnosisCount + 1,
                    updatedAt: now(),
                  },
                }
              : current.sessions,
          events: event
            ? [...current.events, event].slice(-300)
            : current.events,
        };
      });
    },
    [problemContentVersion]
  );

  const startAssessment = useCallback(
    (
      problemSlugs = DEFAULT_ASSESSMENT_PROBLEMS,
      durationMinutes = 20,
      kind: AssessmentKind = 'practice',
      baselineAssessmentId?: string,
      session?: Pick<AssessmentState, 'id' | 'startedAt' | 'problemVersions'>
    ) => {
      const startedAt = session?.startedAt ?? now();
      const id = session?.id ?? `assessment_${crypto.randomUUID()}`;
      const event = trackProductEvent(
        kind === 'baseline' ? 'baseline_started' : 'assessment_started',
        {
          properties: {
            kind,
            problemCount: problemSlugs.length,
            durationMinutes,
          },
        }
      );
      setState((current) => ({
        ...current,
        activeAssessment: {
          id,
          kind,
          baselineAssessmentId,
          problemSlugs,
          problemVersions:
            session?.problemVersions ??
            problemSlugs.map((slug) => ({
              slug,
              contentVersion: problemContentVersion(slug),
            })),
          startedAt,
          durationMinutes,
        },
        events: [...current.events, event].slice(-300),
      }));
    },
    [problemContentVersion]
  );

  const abandonAssessment = useCallback((assessmentId?: string) => {
    setState((current) => {
      if (
        !current.activeAssessment ||
        (assessmentId && current.activeAssessment.id !== assessmentId)
      ) {
        return current;
      }
      return { ...current, activeAssessment: null };
    });
  }, []);

  const completeAssessment = useCallback((input: AssessmentInput) => {
    const completedAt = input.completedAt ?? now();
    const result = {
      ...input,
      problemSlugs: input.problemSlugs ?? input.problemIds ?? [],
      startedAt: input.startedAt ?? completedAt,
      completedAt,
      correctCount: input.correctCount ?? input.passedCount ?? 0,
      totalCount: input.totalCount ?? input.total ?? 0,
      weakTopics: input.weakTopics ?? [],
      recommendation: input.recommendation ?? '',
    } as AssessmentResult;
    const eventName =
      result.kind === 'baseline'
        ? 'baseline_completed'
        : result.kind === 'checkpoint'
          ? 'checkpoint_completed'
          : 'assessment_completed';
    const event = trackProductEvent(eventName, {
      properties: {
        kind: result.kind ?? 'practice',
        score: result.score,
        correctCount: result.correctCount,
        totalCount: result.totalCount,
      },
    });
    setState((current) => ({
      ...current,
      activeAssessment: null,
      assessments: [...current.assessments, result].slice(-40),
      events: [...current.events, event].slice(-300),
    }));
  }, []);

  const saveImportedProblem = useCallback((problem: Problem) => {
    const timestamp = now();
    const existing = importedDraftsRef.current.find(
      (record) =>
        record.problem.slug === problem.slug || record.problem.id === problem.id
    );
    const nextDrafts = upsertImportedDraftRecords(importedDraftsRef.current, [
      {
        problem,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      },
    ]);
    importedDraftsRef.current = nextDrafts;
    importedProblemRef.current = problem;
    setImportedDrafts(nextDrafts);
    setImportedProblem(problem);
  }, []);

  const deleteImportedProblem = useCallback((slug: string) => {
    const nextDrafts = removeImportedDraftRecords(importedDraftsRef.current, [
      slug,
    ]);
    const currentActive = importedProblemRef.current;
    const nextActive =
      currentActive?.slug === slug
        ? (nextDrafts[0]?.problem ?? null)
        : currentActive;
    importedDraftsRef.current = nextDrafts;
    importedProblemRef.current = nextActive;
    setImportedDrafts(nextDrafts);
    setImportedProblem(nextActive);
  }, []);

  const ensureDailyPlan = useCallback(
    (timeZone: string) => {
      setState((current) => {
        const timestamp = now();
        const plan = createDailyLearningPlan({
          state: current,
          reviewItems: reviewProgressRef.current.items,
          catalog: problems,
          date: timestamp,
          timeZone,
          enabledLanguages,
        });
        if (current.dailyPlans[plan.id]) return current;
        const event = trackProductEvent('daily_plan_viewed', {
          properties: {
            planId: plan.id,
            localDate: plan.localDate,
            timeZone: plan.timeZone,
            taskCount: plan.tasks.length,
            estimatedMinutes: plan.estimatedMinutes,
          },
        });
        return {
          ...current,
          dailyPlans: {
            ...current.dailyPlans,
            [plan.id]: plan,
          },
          events: [...current.events, event].slice(-300),
        };
      });
    },
    [enabledLanguages, problems]
  );

  const skipDailyPlanTask = useCallback(
    (planId: string, taskId: string, reason: string) => {
      setState((current) => {
        const plan = current.dailyPlans[planId];
        if (!plan) return current;
        const task = plan.tasks.find((item) => item.id === taskId);
        if (!task) return current;
        const changed = skipPlanTask(plan, taskId, reason, new Date());
        const event = trackProductEvent('daily_plan_task_skipped', {
          problemSlug: task.problemSlug,
          properties: { planId, taskId, reason },
        });
        return {
          ...current,
          dailyPlans: { ...current.dailyPlans, [planId]: changed },
          events: [...current.events, event].slice(-300),
        };
      });
    },
    []
  );

  const swapDailyPlanTask = useCallback(
    (planId: string, taskId: string, reason: string) => {
      setState((current) => {
        const plan = current.dailyPlans[planId];
        if (!plan) return current;
        const previousTask = plan.tasks.find((item) => item.id === taskId);
        if (!previousTask) return current;
        const changed = swapPlanTask(plan, taskId, reason, new Date(), {
          state: current,
          reviewItems: reviewProgressRef.current.items,
          catalog: problems,
          date: new Date(),
          timeZone: plan.timeZone,
          enabledLanguages,
        });
        const nextTask = changed.tasks.find((item) => item.id === taskId);
        const latestChange = changed.changes.at(-1);
        const event = trackProductEvent('daily_plan_task_swapped', {
          problemSlug: previousTask.problemSlug,
          properties: {
            planId,
            taskId,
            reason,
            outcome: latestChange?.action ?? 'swap-unavailable',
            replacementSlug: nextTask?.problemSlug ?? previousTask.problemSlug,
          },
        });
        return {
          ...current,
          dailyPlans: { ...current.dailyPlans, [planId]: changed },
          events: [...current.events, event].slice(-300),
        };
      });
    },
    [enabledLanguages, problems]
  );

  const recordReviewAttempt = useCallback((attempt: ReviewAttempt) => {
    setState((current) => {
      const byId = new Map(
        current.reviewAttempts.map((item) => [item.id, item])
      );
      byId.set(attempt.id, { ...byId.get(attempt.id), ...attempt });
      const event = trackProductEvent('review_answered', {
        problemSlug: attempt.problemSlug,
        properties: {
          attemptId: attempt.id,
          problemContentVersion: attempt.problemContentVersion,
          answerLength: attempt.answer.trim().length,
          gradeMode: attempt.gradeMode ?? (attempt.grade ? 'ai' : 'unknown'),
          ...(attempt.gradeErrorCode
            ? { gradeErrorCode: attempt.gradeErrorCode }
            : {}),
          ...(attempt.grade
            ? {
                suggestedRating: attempt.grade.suggestedRating,
                coverage: attempt.grade.coverage,
              }
            : {}),
        },
      });
      return {
        ...current,
        reviewAttempts: Array.from(byId.values()).slice(-200),
        events: [...current.events, event].slice(-300),
      };
    });
  }, []);

  const rateReview = useCallback(
    (
      problemSlug: string,
      rating: ReviewRating,
      options: {
        attemptId?: string;
        suggestedRating?: ReviewRating;
        problemContentVersion?: number;
      } = {}
    ) => {
      const reviewedAt = new Date();
      const contentVersion = normalizeProblemContentVersion(
        options.problemContentVersion ?? problemContentVersion(problemSlug)
      );
      setReviewProgress((current) =>
        rateReviewItem(current, problemSlug, rating, reviewedAt, contentVersion)
      );
      setState((current) => {
        const reviewedAtIso = reviewedAt.toISOString();
        const event = trackProductEvent('review_completed', {
          problemSlug,
          properties: {
            rating,
            ...(options.attemptId ? { attemptId: options.attemptId } : {}),
            ...(options.suggestedRating
              ? { suggestedRating: options.suggestedRating }
              : {}),
          },
        });
        const overrideEvent =
          options.suggestedRating && options.suggestedRating !== rating
            ? trackProductEvent('review_rating_overridden', {
                problemSlug,
                properties: {
                  ...(options.attemptId
                    ? { attemptId: options.attemptId }
                    : {}),
                  suggestedRating: options.suggestedRating,
                  selectedRating: rating,
                },
              })
            : null;
        const reviewAttempts = current.reviewAttempts.map((attempt) =>
          attempt.id === options.attemptId
            ? {
                ...attempt,
                selectedRating: rating,
                ratingOverride:
                  options.suggestedRating && options.suggestedRating !== rating
                    ? rating
                    : undefined,
              }
            : attempt
        );
        const planCompletion = completeMatchingDailyPlanTasks(
          current.dailyPlans,
          problemSlug,
          contentVersion,
          reviewedAtIso,
          new Set(['due-review'])
        );
        const planEvents = planCompletion.completedTaskIds.map((taskId) =>
          trackProductEvent('daily_plan_task_completed', {
            problemSlug,
            properties: { taskId, completion: 'due_review' },
          })
        );
        return {
          ...current,
          dailyPlans: planCompletion.plans,
          reviewAttempts,
          events: [
            ...current.events,
            event,
            ...(overrideEvent ? [overrideEvent] : []),
            ...planEvents,
          ].slice(-300),
        };
      });
    },
    [problemContentVersion]
  );

  const markReviewMastered = useCallback(
    (problemSlug: string, requestedContentVersion?: number) => {
      const contentVersion = normalizeProblemContentVersion(
        requestedContentVersion ?? problemContentVersion(problemSlug)
      );
      setReviewProgress((current) =>
        markReviewItemMastered(current, problemSlug, new Date(), contentVersion)
      );
      setState((current) => {
        const event = trackProductEvent('review_completed', {
          problemSlug,
          properties: {
            rating: 'mastered',
            problemContentVersion: contentVersion,
          },
        });
        return { ...current, events: [...current.events, event].slice(-300) };
      });
    },
    [problemContentVersion]
  );

  const trackEvent = useCallback(
    (
      name: ProductEventName,
      options: {
        problemSlug?: string;
        properties?: Record<string, JsonValue>;
      } = {}
    ) => {
      const event = trackProductEvent(name, options);
      setState((current) =>
        current.events.some((item) => item.id === event.id)
          ? current
          : { ...current, events: [...current.events, event].slice(-300) }
      );
    },
    []
  );

  const resetData = useCallback(async (): Promise<boolean> => {
    const activeScope = activeScopeRef.current;
    if (!activeScope) return false;

    if (remoteSyncTimerRef.current !== null) {
      window.clearTimeout(remoteSyncTimerRef.current);
      remoteSyncTimerRef.current = null;
    }
    remoteSyncQueueRef.current = [];
    remoteSyncRetryRef.current = 0;
    clearCoachSyncQueue(undefined, activeScope);
    resettingRef.current = true;
    remoteSyncGenerationRef.current += 1;
    remoteSyncAbortRef.current?.abort();
    remoteSyncAbortRef.current = null;
    remoteLoadAbortRef.current?.abort();
    remoteLoadAbortRef.current = null;
    remoteSyncInFlightRef.current = false;

    const emptyState = createInitialCoachState();
    clearCoachState(undefined, activeScope);
    clearReviewProgress(undefined, activeScope);
    clearProductAnalytics(activeScope);
    clearPracticeContexts(undefined, activeScope);
    clearImportedProblem(undefined, activeScope);
    stateRef.current = emptyState;
    importedProblemRef.current = null;
    importedDraftsRef.current = [];
    const emptyReviewProgress = createInitialReviewProgress();
    reviewProgressRef.current = emptyReviewProgress;
    observedDocumentRef.current = {
      state: emptyState,
      importedProblem: null,
      importedDrafts: [],
      reviewProgress: emptyReviewProgress,
    };
    setState(emptyState);
    setImportedProblem(null);
    setImportedDrafts([]);
    setReviewProgress(emptyReviewProgress);

    if (!cloudSyncEnabled || !activeScope.startsWith('user:')) {
      resettingRef.current = false;
      setSyncStatus('local');
      setSyncError(null);
      return true;
    }

    const controller = new AbortController();
    remoteSyncAbortRef.current = controller;
    setSyncStatus('syncing');
    setSyncError(null);
    try {
      const response = await fetch('/api/coach/state', {
        method: 'DELETE',
        signal: controller.signal,
      });
      if (!response.ok) throw coachSyncFailureForResponse(response);
      const payload = (await response.json()) as {
        data?: { revision?: number };
      };
      const revision = payload.data?.revision;
      if (!Number.isInteger(revision) || Number(revision) < 0) {
        throw new Error('Reset response did not include a valid revision');
      }
      remoteRevisionRef.current = Number(revision);
      saveCoachRevision(Number(revision), undefined, activeScope);
      setSyncStatus('synced');
      setSyncError(null);
      return true;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setSyncStatus('error');
        setSyncError(classifyCoachSyncFailure(error));
      }
      return false;
    } finally {
      resettingRef.current = false;
      if (remoteSyncAbortRef.current === controller) {
        remoteSyncAbortRef.current = null;
      }
    }
  }, []);

  const value = useMemo<CoachStoreValue>(
    () => ({
      state,
      problems,
      enabledLanguages,
      metrics: calculateProductMetrics(state, reviewProgress.items, {
        catalog: problems,
      }),
      reviewItems: reviewProgress.items,
      hydrated,
      storageScope: hydrated ? storageScope : null,
      importedProblem,
      importedDrafts,
      syncStatus,
      syncError,
      retrySync,
      completeOnboarding,
      setPreferredLanguage,
      saveCode,
      flushCodeSnapshot,
      recordRun,
      revealHint,
      addArtifact,
      startAssessment,
      abandonAssessment,
      completeAssessment,
      saveImportedProblem,
      deleteImportedProblem,
      ensureDailyPlan,
      skipDailyPlanTask,
      swapDailyPlanTask,
      recordReviewAttempt,
      rateReview,
      markReviewMastered,
      trackEvent,
      resetData,
    }),
    [
      state,
      problems,
      enabledLanguages,
      reviewProgress,
      hydrated,
      storageScope,
      importedProblem,
      importedDrafts,
      syncStatus,
      syncError,
      retrySync,
      completeOnboarding,
      setPreferredLanguage,
      saveCode,
      flushCodeSnapshot,
      recordRun,
      revealHint,
      addArtifact,
      startAssessment,
      abandonAssessment,
      completeAssessment,
      saveImportedProblem,
      deleteImportedProblem,
      ensureDailyPlan,
      skipDailyPlanTask,
      swapDailyPlanTask,
      recordReviewAttempt,
      rateReview,
      markReviewMastered,
      trackEvent,
      resetData,
    ]
  );

  return (
    <CoachStoreContext.Provider value={value}>
      {children}
    </CoachStoreContext.Provider>
  );
}

export function useCoachStore(): CoachStoreValue {
  const context = useContext(CoachStoreContext);
  if (!context) {
    throw new Error('useCoachStore must be used inside CoachProvider');
  }
  return context;
}

export const useCoach = useCoachStore;

export { createProductEvent };
