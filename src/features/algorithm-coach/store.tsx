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
  clearProductAnalytics,
  createProductEvent,
  setProductAnalyticsScope,
  trackProductEvent,
} from './analytics';
import { calculateProductMetrics } from './metrics';
import {
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
  saveImportedProblem as persistImportedProblem,
  saveCoachRevision,
  saveCoachState,
  saveCoachSyncQueue,
} from './storage';
import {
  applyCoachSyncMutations,
  CoachSyncDocument,
  coachSyncRetryDelay,
  createCoachSyncMutation,
} from './sync';
import {
  AssessmentResult,
  CoachState,
  CoachSyncMutation,
  CoachSyncResult,
  CodeRunResult,
  JsonValue,
  Language,
  LearningArtifact,
  LearningGoal,
  LearningProfile,
  Problem,
  ProductEventName,
  ProductMetrics,
} from './types';

const DEFAULT_ASSESSMENT_PROBLEMS = [
  'minimum-processing-rate',
  'dependency-cycle',
];

const cloudSyncEnabled =
  process.env.NEXT_PUBLIC_COACH_CLOUD_SYNC_ENABLED !== 'false';

type OnboardingInput = {
  goal: LearningGoal | string;
  preferredLanguage: Language;
  weeklyTarget?: number;
  weeklyGoal?: number;
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
  metrics: ProductMetrics;
  hydrated: boolean;
  storageScope: CoachStorageScope | null;
  importedProblem: Problem | null;
  syncStatus: 'local' | 'syncing' | 'synced' | 'error';
  completeOnboarding: (profile: OnboardingInput) => void;
  setPreferredLanguage: (language: Language) => void;
  saveCode: (problemSlug: string, language: Language, code: string) => void;
  recordRun: RecordRun;
  revealHint: (problemSlug: string) => void;
  addArtifact: (artifact: LearningArtifact) => void;
  startAssessment: (problemSlugs?: string[], durationMinutes?: number) => void;
  completeAssessment: (result: AssessmentInput) => void;
  saveImportedProblem: (problem: Problem) => void;
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

function createSession(problemSlug: string) {
  const timestamp = now();
  return {
    problemSlug,
    code: {},
    runs: [],
    hintLevel: 0 as const,
    diagnosisCount: 0,
    correctedAfterDiagnosis: false,
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function CoachProvider({
  children,
  storageScope = GUEST_COACH_STORAGE_SCOPE,
}: {
  children: ReactNode;
  storageScope?: CoachStorageScope | null;
}) {
  const [state, setState] = useState<CoachState>(createInitialCoachState);
  const [importedProblem, setImportedProblem] = useState<Problem | null>(null);
  const stateRef = useRef(state);
  const importedProblemRef = useRef(importedProblem);
  const activeScopeRef = useRef<CoachStorageScope | null>(null);
  const remoteSyncTimerRef = useRef<number | null>(null);
  const remoteRevisionRef = useRef(0);
  const remoteSyncGenerationRef = useRef(0);
  const remoteSyncInFlightRef = useRef(false);
  const remoteSyncAbortRef = useRef<AbortController | null>(null);
  const remoteSyncRetryRef = useRef(0);
  const resettingRef = useRef(false);
  const remoteSyncQueueRef = useRef<CoachSyncMutation[]>([]);
  const observedDocumentRef = useRef<CoachSyncDocument | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    'local' | 'syncing' | 'synced' | 'error'
  >('local');
  const [hydratedScope, setHydratedScope] = useState<CoachStorageScope | null>(
    null
  );
  const hydrated = Boolean(
    storageScope && hydratedScope && storageScope === hydratedScope
  );

  const flushRemoteSync = useCallback(async function flushRemoteSync() {
    if (remoteSyncInFlightRef.current || resettingRef.current) {
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
        const latestResponse = await fetch('/api/coach/state', {
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!latestResponse.ok) {
          throw new Error(
            `Conflict recovery failed with ${latestResponse.status}`
          );
        }
        const latestPayload = (await latestResponse.json()) as {
          data?: {
            state?: CoachState;
            importedProblem?: Problem | null;
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
          throw new Error('Conflict recovery returned invalid learning data');
        }
        const remoteDocument: CoachSyncDocument = {
          state: latestState,
          importedProblem: latestPayload.data?.importedProblem ?? null,
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
        remoteSyncQueueRef.current = recoveryMutation ? [recoveryMutation] : [];
        saveCoachSyncQueue(remoteSyncQueueRef.current, undefined, scope);
        observedDocumentRef.current = merged;
        stateRef.current = merged.state;
        importedProblemRef.current = merged.importedProblem;
        saveCoachState(merged.state, undefined, scope);
        if (merged.importedProblem) {
          persistImportedProblem(merged.importedProblem, undefined, scope);
        } else {
          clearImportedProblem(undefined, scope);
        }
        setState(merged.state);
        setImportedProblem(merged.importedProblem);
        remoteSyncRetryRef.current = 0;
        if (recoveryMutation) {
          retryScheduled = true;
          remoteSyncTimerRef.current = window.setTimeout(() => {
            remoteSyncTimerRef.current = null;
            void flushRemoteSync();
          }, 0);
        } else {
          setSyncStatus('synced');
        }
        return;
      }
      if (!response.ok) throw new Error(`Sync failed with ${response.status}`);
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
      remoteSyncQueueRef.current = remoteSyncQueueRef.current.filter(
        (mutation) => !acknowledged.has(mutation.id)
      );
      saveCoachSyncQueue(remoteSyncQueueRef.current, undefined, scope);
      remoteRevisionRef.current = Number(revision);
      saveCoachRevision(Number(revision), undefined, scope);
      remoteSyncRetryRef.current = 0;
      setSyncStatus(remoteSyncQueueRef.current.length ? 'syncing' : 'synced');
    } catch (error) {
      if (
        generation === remoteSyncGenerationRef.current &&
        !(error instanceof DOMException && error.name === 'AbortError')
      ) {
        setSyncStatus('error');
        const attempt = remoteSyncRetryRef.current++;
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

  useEffect(() => {
    let cancelled = false;
    remoteSyncGenerationRef.current += 1;
    remoteSyncAbortRef.current?.abort();
    remoteSyncAbortRef.current = null;
    remoteSyncInFlightRef.current = false;
    remoteSyncRetryRef.current = 0;
    remoteSyncQueueRef.current = [];
    observedDocumentRef.current = null;
    resettingRef.current = false;
    remoteRevisionRef.current = 0;
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
        const claimedGuest = claimGuestCoachData(storageScope);
        let nextState = loadCoachState(undefined, storageScope);
        let nextImportedProblem = loadImportedProblem(undefined, storageScope);
        const localRevision = loadCoachRevision(undefined, storageScope);
        const queuedMutations = loadCoachSyncQueue(undefined, storageScope);
        remoteSyncQueueRef.current = queuedMutations;
        remoteRevisionRef.current = localRevision;

        if (cloudSyncEnabled && storageScope.startsWith('user:')) {
          try {
            const response = await fetch('/api/coach/state', {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            });
            if (!response.ok) {
              throw new Error(`Sync load failed with ${response.status}`);
            }
            const payload = (await response.json()) as {
              data?: {
                state?: CoachState;
                importedProblem?: Problem | null;
                hasData?: boolean;
                revision?: number;
              };
            };
            if (cancelled) return;
            const remoteState = payload.data?.state;
            const remoteRevision = Number(payload.data?.revision ?? 0);
            if (
              remoteState &&
              Number.isInteger(remoteRevision) &&
              remoteRevision >= 0
            ) {
              const remoteDocument: CoachSyncDocument = {
                state: remoteState,
                importedProblem: payload.data?.importedProblem ?? null,
              };
              remoteRevisionRef.current = remoteRevision;
              saveCoachRevision(remoteRevision, undefined, storageScope);
              const shouldPreserveLocal =
                claimedGuest || remoteRevision <= localRevision;
              if (queuedMutations.length && !claimedGuest) {
                const replayed = applyCoachSyncMutations(
                  remoteDocument,
                  queuedMutations
                );
                nextState = replayed.state;
                nextImportedProblem = replayed.importedProblem;
              } else if (shouldPreserveLocal) {
                nextState = mergeCoachStates(nextState, remoteState);
                nextImportedProblem =
                  nextImportedProblem ?? payload.data?.importedProblem ?? null;
              } else {
                nextState = remoteState;
                nextImportedProblem = payload.data?.importedProblem ?? null;
              }

              if (
                (shouldPreserveLocal || claimedGuest) &&
                (!queuedMutations.length || claimedGuest)
              ) {
                const initialMutation = createCoachSyncMutation(
                  remoteDocument,
                  {
                    state: nextState,
                    importedProblem: nextImportedProblem,
                  },
                  remoteRevision
                );
                if (initialMutation) {
                  remoteSyncQueueRef.current = [initialMutation];
                  saveCoachSyncQueue(
                    remoteSyncQueueRef.current,
                    undefined,
                    storageScope
                  );
                }
              }
            }
            if (!cancelled) {
              setSyncStatus(
                remoteSyncQueueRef.current.length ? 'syncing' : 'synced'
              );
            }
          } catch {
            // The local cache keeps the learning workflow usable while offline.
            if (!cancelled) setSyncStatus('error');
          }
        }
        if (cancelled) return;

        activeScopeRef.current = storageScope;
        stateRef.current = nextState;
        importedProblemRef.current = nextImportedProblem;
        observedDocumentRef.current = {
          state: nextState,
          importedProblem: nextImportedProblem,
        };
        setProductAnalyticsScope(storageScope);
        setState(nextState);
        setImportedProblem(nextImportedProblem);
        setHydratedScope(storageScope);
        if (
          cloudSyncEnabled &&
          storageScope.startsWith('user:') &&
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
      if (activeScopeRef.current === storageScope) {
        activeScopeRef.current = null;
        setProductAnalyticsScope(null);
      }
    };
  }, [flushRemoteSync, storageScope]);

  useEffect(() => {
    const nextDocument: CoachSyncDocument = { state, importedProblem };
    const previousDocument = observedDocumentRef.current;
    stateRef.current = state;
    importedProblemRef.current = importedProblem;
    const activeScope = activeScopeRef.current;
    if (activeScope && hydratedScope === activeScope) {
      saveCoachState(state, undefined, activeScope);
      if (importedProblem) {
        persistImportedProblem(importedProblem, undefined, activeScope);
      } else {
        clearImportedProblem(undefined, activeScope);
      }

      if (
        cloudSyncEnabled &&
        activeScope.startsWith('user:') &&
        !resettingRef.current &&
        previousDocument
      ) {
        const mutation = createCoachSyncMutation(
          previousDocument,
          nextDocument,
          remoteRevisionRef.current
        );
        if (mutation) {
          remoteSyncQueueRef.current = [
            ...remoteSyncQueueRef.current,
            mutation,
          ];
          saveCoachSyncQueue(
            remoteSyncQueueRef.current,
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
  }, [flushRemoteSync, hydratedScope, importedProblem, state]);

  useEffect(() => {
    const flush = () => {
      const activeScope = activeScopeRef.current;
      if (activeScope) {
        saveCoachState(stateRef.current, undefined, activeScope);
        const imported = importedProblemRef.current;
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
    const goal: LearningGoal = ['foundation', 'interview', 'contest'].includes(
      input.goal
    )
      ? (input.goal as LearningGoal)
      : 'interview';
    const profile: LearningProfile = {
      goal,
      preferredLanguage: input.preferredLanguage,
      weeklyTarget: Math.min(14, Math.max(1, Math.round(target))),
      weeklyGoal: Math.min(14, Math.max(1, Math.round(target))),
      onboardingCompleted: true,
      createdAt: input.createdAt ?? now(),
      onboardedAt: now(),
    };
    const event = trackProductEvent('activated', {
      properties: {
        goal: profile.goal,
        language: profile.preferredLanguage,
        weeklyTarget: profile.weeklyTarget,
      },
    });
    setState((current) => ({
      ...current,
      profile,
      events: [...current.events, event].slice(-300),
    }));
  }, []);

  const setPreferredLanguage = useCallback((language: Language) => {
    setState((current) => {
      if (!current.profile) return current;
      return {
        ...current,
        profile: { ...current.profile, preferredLanguage: language },
      };
    });
  }, []);

  const saveCode = useCallback(
    (problemSlug: string, language: Language, code: string) => {
      setState((current) => {
        const existing = current.sessions[problemSlug];
        const session = existing ?? createSession(problemSlug);
        const event = existing
          ? null
          : trackProductEvent('practice_started', { problemSlug });
        return {
          ...current,
          sessions: {
            ...current.sessions,
            [problemSlug]: {
              ...session,
              code: { ...session.code, [language]: code },
              updatedAt: now(),
            },
          },
          code: {
            ...current.code,
            [problemSlug]: {
              ...current.code[problemSlug],
              [language]: code,
            },
          },
          events: event
            ? [...current.events, event].slice(-300)
            : current.events,
        };
      });
    },
    []
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
        const session =
          current.sessions[problemSlug] ?? createSession(problemSlug);
        const storedResult: CodeRunResult = {
          ...result,
          id: result.id ?? crypto.randomUUID(),
          codeSnapshot:
            result.codeSnapshot ??
            session.code[result.language] ??
            current.code[problemSlug]?.[result.language] ??
            '',
          submitted: options.submitted ?? result.submitted ?? false,
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
        const corrected =
          passed &&
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
        return {
          ...current,
          sessions: {
            ...current.sessions,
            [problemSlug]: {
              ...session,
              runs: [...session.runs, storedResult].slice(-30),
              correctedAfterDiagnosis:
                session.correctedAfterDiagnosis || corrected,
              updatedAt: now(),
              completedAt: passed ? now() : session.completedAt,
            },
          },
          runs: [...current.runs, storedResult].slice(-200),
          completedProblemIds: passed
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
            runEvent,
            ...(correctionEvent ? [correctionEvent] : []),
          ].slice(-300),
        };
      });
    },
    []
  ) as RecordRun;

  const revealHint = useCallback((problemSlug: string) => {
    setState((current) => {
      const session =
        current.sessions[problemSlug] ?? createSession(problemSlug);
      if (session.hintLevel >= 3) return current;
      const hintLevel = (session.hintLevel + 1) as 1 | 2 | 3;
      const event = trackProductEvent('hint_revealed', {
        problemSlug,
        properties: { hintLevel },
      });
      return {
        ...current,
        sessions: {
          ...current.sessions,
          [problemSlug]: { ...session, hintLevel, updatedAt: now() },
        },
        events: [...current.events, event].slice(-300),
      };
    });
  }, []);

  const addArtifact = useCallback((artifact: LearningArtifact) => {
    setState((current) => {
      const problemSlug =
        artifact.problemSlug ??
        (artifact as LearningArtifact & { problemId?: string }).problemId;
      const shouldCountDiagnosis = artifact.type === 'diagnose' && problemSlug;
      const session = problemSlug
        ? (current.sessions[problemSlug] ?? createSession(problemSlug))
        : null;
      const event = shouldCountDiagnosis
        ? trackProductEvent('diagnosis_requested', { problemSlug })
        : null;
      return {
        ...current,
        artifacts: [...current.artifacts, artifact].slice(-100),
        sessions:
          shouldCountDiagnosis && session
            ? {
                ...current.sessions,
                [problemSlug]: {
                  ...session,
                  diagnosisCount: session.diagnosisCount + 1,
                  updatedAt: now(),
                },
              }
            : current.sessions,
        events: event ? [...current.events, event].slice(-300) : current.events,
      };
    });
  }, []);

  const startAssessment = useCallback(
    (problemSlugs = DEFAULT_ASSESSMENT_PROBLEMS, durationMinutes = 20) => {
      const startedAt = now();
      const id = `assessment_${crypto.randomUUID()}`;
      const event = trackProductEvent('assessment_started', {
        properties: { problemCount: problemSlugs.length, durationMinutes },
      });
      setState((current) => ({
        ...current,
        activeAssessment: {
          id,
          problemSlugs,
          startedAt,
          durationMinutes,
        },
        events: [...current.events, event].slice(-300),
      }));
    },
    []
  );

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
    const event = trackProductEvent('assessment_completed', {
      properties: {
        score: result.score,
        correctCount: result.correctCount,
        totalCount: result.totalCount,
      },
    });
    setState((current) => ({
      ...current,
      activeAssessment: null,
      assessments: [...current.assessments, result].slice(-20),
      events: [...current.events, event].slice(-300),
    }));
  }, []);

  const saveImportedProblem = useCallback((problem: Problem) => {
    setImportedProblem(problem);
  }, []);

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
    remoteSyncInFlightRef.current = false;

    const emptyState = createInitialCoachState();
    clearCoachState(undefined, activeScope);
    clearProductAnalytics(activeScope);
    clearImportedProblem(undefined, activeScope);
    stateRef.current = emptyState;
    importedProblemRef.current = null;
    observedDocumentRef.current = {
      state: emptyState,
      importedProblem: null,
    };
    setState(emptyState);
    setImportedProblem(null);

    if (!cloudSyncEnabled || !activeScope.startsWith('user:')) {
      resettingRef.current = false;
      setSyncStatus('local');
      return true;
    }

    const controller = new AbortController();
    remoteSyncAbortRef.current = controller;
    setSyncStatus('syncing');
    try {
      const response = await fetch('/api/coach/state', {
        method: 'DELETE',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Reset failed with ${response.status}`);
      }
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
      return true;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setSyncStatus('error');
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
      metrics: calculateProductMetrics(state),
      hydrated,
      storageScope: hydrated ? storageScope : null,
      importedProblem,
      syncStatus,
      completeOnboarding,
      setPreferredLanguage,
      saveCode,
      recordRun,
      revealHint,
      addArtifact,
      startAssessment,
      completeAssessment,
      saveImportedProblem,
      trackEvent,
      resetData,
    }),
    [
      state,
      hydrated,
      storageScope,
      importedProblem,
      syncStatus,
      completeOnboarding,
      setPreferredLanguage,
      saveCode,
      recordRun,
      revealHint,
      addArtifact,
      startAssessment,
      completeAssessment,
      saveImportedProblem,
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
