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
  clearImportedProblem,
  CoachStorageScope,
  createInitialCoachState,
  GUEST_COACH_STORAGE_SCOPE,
  loadCoachState,
  saveCoachState,
} from './storage';
import {
  AssessmentResult,
  CoachState,
  CodeRunResult,
  Language,
  LearningArtifact,
  LearningGoal,
  LearningProfile,
  ProductMetrics,
} from './types';

const DEFAULT_ASSESSMENT_PROBLEMS = [
  'minimum-processing-rate',
  'dependency-cycle',
];

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
  completeOnboarding: (profile: OnboardingInput) => void;
  setPreferredLanguage: (language: Language) => void;
  saveCode: (problemSlug: string, language: Language, code: string) => void;
  recordRun: RecordRun;
  revealHint: (problemSlug: string) => void;
  addArtifact: (artifact: LearningArtifact) => void;
  startAssessment: (problemSlugs?: string[], durationMinutes?: number) => void;
  completeAssessment: (result: AssessmentInput) => void;
  resetData: () => void;
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
  const stateRef = useRef(state);
  const activeScopeRef = useRef<CoachStorageScope | null>(null);
  const [hydratedScope, setHydratedScope] = useState<CoachStorageScope | null>(
    null
  );
  const hydrated = Boolean(
    storageScope && hydratedScope && storageScope === hydratedScope
  );

  useEffect(() => {
    let cancelled = false;
    activeScopeRef.current = null;
    setProductAnalyticsScope(null);

    if (!storageScope) return;

    const timeout = window.setTimeout(() => {
      claimGuestCoachData(storageScope);
      const nextState = loadCoachState(undefined, storageScope);
      if (cancelled) return;

      activeScopeRef.current = storageScope;
      stateRef.current = nextState;
      setProductAnalyticsScope(storageScope);
      setState(nextState);
      setHydratedScope(storageScope);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (activeScopeRef.current === storageScope) {
        activeScopeRef.current = null;
        setProductAnalyticsScope(null);
      }
    };
  }, [storageScope]);

  useEffect(() => {
    stateRef.current = state;
    const activeScope = activeScopeRef.current;
    if (activeScope && hydratedScope === activeScope) {
      saveCoachState(state, undefined, activeScope);
    }
  }, [hydratedScope, state]);

  useEffect(() => {
    const flush = () => {
      const activeScope = activeScopeRef.current;
      if (activeScope) {
        saveCoachState(stateRef.current, undefined, activeScope);
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

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
              runs: [...session.runs, result].slice(-30),
              correctedAfterDiagnosis:
                session.correctedAfterDiagnosis || corrected,
              updatedAt: now(),
              completedAt: passed ? now() : session.completedAt,
            },
          },
          runs: [...current.runs, result].slice(-200),
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
      const id = `assessment_${Date.now().toString(36)}`;
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

  const resetData = useCallback(() => {
    const activeScope = activeScopeRef.current;
    if (!activeScope) return;
    clearCoachState(undefined, activeScope);
    clearProductAnalytics(activeScope);
    clearImportedProblem(undefined, activeScope);
    setState(createInitialCoachState());
  }, []);

  const value = useMemo<CoachStoreValue>(
    () => ({
      state,
      metrics: calculateProductMetrics(state),
      hydrated,
      storageScope: hydrated ? storageScope : null,
      completeOnboarding,
      setPreferredLanguage,
      saveCode,
      recordRun,
      revealHint,
      addArtifact,
      startAssessment,
      completeAssessment,
      resetData,
    }),
    [
      state,
      hydrated,
      storageScope,
      completeOnboarding,
      setPreferredLanguage,
      saveCode,
      recordRun,
      revealHint,
      addArtifact,
      startAssessment,
      completeAssessment,
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
