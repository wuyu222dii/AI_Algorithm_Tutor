import type { Language, LanguageRunner } from './languages';

export type { Language } from './languages';

export type CoachLocale = 'zh' | 'en';

export type LocalizedText = {
  zh: string;
  en: string;
};

export type Difficulty = 'easy' | 'medium' | 'hard';

export type ProblemTopic =
  | 'array-hash'
  | 'two-pointers'
  | 'stack'
  | 'binary-search'
  | 'linked-list'
  | 'dynamic-programming'
  | 'bfs'
  | 'dfs';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TypeSpec =
  | { kind: 'unknown' }
  | { kind: 'integer' }
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'array'; items: TypeSpec }
  | { kind: 'tuple'; items: TypeSpec[] }
  | {
      kind: 'object';
      fields: Record<string, TypeSpec>;
      additionalProperties?: boolean;
    }
  | { kind: 'union'; options: TypeSpec[] };

export interface ProblemFunctionParameter {
  name: string;
  type: TypeSpec;
}

export interface ProblemFunctionSignature {
  parameters: ProblemFunctionParameter[];
  returns: TypeSpec;
}

export interface ProblemLanguageConfig {
  entryPoint: string;
  template: string;
  signature?: ProblemFunctionSignature;
  monacoId?: string;
  runner?: LanguageRunner;
  runtimeVersion?: string;
}

export interface ResolvedProblemLanguageConfig extends ProblemLanguageConfig {
  signature: ProblemFunctionSignature;
  monacoId: string;
  runner: LanguageRunner;
  runtimeVersion: string;
}

export interface ProblemVersionMetadata {
  contentVersion: number;
  catalogVersion?: string;
  sourceRevision?: string;
  runtimeVersions?: Partial<Record<Language, string>>;
}

export type ProblemTemplates = Record<'javascript' | 'python', string> &
  Partial<Record<Language, string>>;

export interface ProblemExample {
  id: string;
  input: JsonValue;
  expected: JsonValue;
  output?: JsonValue;
  explanation?: LocalizedText;
}

export interface TestCase {
  id: string;
  args: JsonValue[];
  expected: JsonValue;
  isSample: boolean;
  label?: LocalizedText;
}

export interface Problem {
  id: string;
  slug: string;
  title: LocalizedText;
  description: LocalizedText;
  difficulty: Difficulty;
  topics: string[];
  /** @deprecated Normalize legacy fixtures into languageConfigs at the boundary. */
  entryPoint?: string;
  /** @deprecated Normalize legacy fixtures into languageConfigs at the boundary. */
  templates?: ProblemTemplates;
  languageConfigs?: Partial<Record<Language, ProblemLanguageConfig>>;
  signature?: ProblemFunctionSignature;
  version?: ProblemVersionMetadata;
  tests: TestCase[];
  examples: ProblemExample[];
  constraints: LocalizedText[];
  hints: Record<CoachLocale, [string, string, string]>;
  reviewPoints: LocalizedText[];
  learningObjectives?: LocalizedText[];
  prerequisiteTopics?: ProblemTopic[];
  solutionPatterns?: string[];
  estimatedMinutes: number;
  sourceStatement?: string;
  sourceUrl?: string;
}

export interface ImportedDraftRecord {
  problem: Problem;
  createdAt: string;
  updatedAt: string;
}

export interface LocalizedProblem
  extends Omit<
    Problem,
    'title' | 'description' | 'constraints' | 'hints' | 'reviewPoints'
  > {
  title: string;
  description: string;
  constraints: string[];
  hints: [string, string, string];
  reviewPoints: string[];
}

export type CodeRunStatus =
  | 'passed'
  | 'failed'
  | 'syntax_error'
  | 'runtime_error'
  | 'timeout';

export type RunnerMode = 'browser-worker' | 'remote-judge';

export interface ProblemVersionRef {
  slug: string;
  contentVersion: number;
}

export interface TestCaseResult {
  testId: string;
  passed: boolean;
  expected?: JsonValue;
  actual?: JsonValue;
  error?: string;
  durationMs: number;
}

export interface CodeRunResult {
  id?: string;
  problemSlug: string;
  language: Language;
  status: CodeRunStatus;
  passedTests: number;
  totalTests: number;
  testResults: TestCaseResult[];
  console: string[];
  error?: string;
  durationMs: number;
  executedAt: string;
  codeSnapshot?: string;
  testScope?: 'sample' | 'full' | 'unknown';
  submitted?: boolean;
  problemContentVersion?: number;
  runtimeVersion?: string;
  runnerMode?: RunnerMode;
}

export type LearningGoal = 'foundation' | 'interview' | 'contest';

export interface LearningProfile {
  goal: LearningGoal;
  preferredLanguage: Language;
  weeklyTarget: number;
  dailyMinutes?: number;
  weeklyGoal?: number;
  onboardingCompleted?: boolean;
  createdAt?: string;
  onboardedAt: string;
}

export type ReviewStatus = 'due' | 'resolved' | 'mastered';
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewItem {
  problemSlug: string;
  /** Defaults to v1 for records created before versioned review keys. */
  problemContentVersion?: number;
  status: ReviewStatus;
  source: 'mistake' | 'completion';
  dueAt: string;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  updatedAt: string;
  lastObservedRunAt?: string;
  lastFailureAt?: string;
  lastReviewedAt?: string;
  lastRating?: ReviewRating;
}

export interface ReviewProgressState {
  version: number;
  items: Record<string, ReviewItem>;
}

export interface ReviewScheduleResult {
  item: ReviewItem;
  nextReviewAt: string;
  intervalDays: number;
}

export type DailyPlanTaskKind = 'due-review' | 'weak-topic' | 'new-topic';
export type DailyPlanTaskStatus = 'pending' | 'completed' | 'skipped';
export type DailyPlanTaskReason =
  | 'review-due'
  | 'assessment-weak'
  | 'weak-mastery'
  | 'new-topic';

export interface DailyPlanTask {
  id: string;
  kind: DailyPlanTaskKind;
  status: DailyPlanTaskStatus;
  problemId: string;
  problemSlug: string;
  problemContentVersion: number;
  primaryTopic: ProblemTopic;
  difficulty: Difficulty;
  reason: DailyPlanTaskReason;
  estimatedMinutes: number;
  dueAt?: string;
  completedAt?: string;
  skipReason?: string;
  skippedAt?: string;
}

export interface DailyPlanChange {
  id: string;
  action: 'skipped' | 'swapped' | 'swap-unavailable';
  taskId: string;
  reason: string;
  occurredAt: string;
  fromProblemSlug: string;
  fromProblemContentVersion: number;
  toProblemSlug?: string;
  toProblemContentVersion?: number;
}

export interface DailyLearningPlan {
  id: string;
  localDate: string;
  timeZone: string;
  budgetMinutes: number;
  estimatedMinutes: number;
  preferredLanguage?: Language;
  goal: LearningGoal;
  tasks: DailyPlanTask[];
  changes: DailyPlanChange[];
}

export interface LineDiffSummary {
  beforeLines: number;
  afterLines: number;
  unchangedLines: number;
  changedLines: number;
  addedLines: number;
  removedLines: number;
  hasChanges: boolean;
}

export interface CorrectionFailureEvidence {
  runId?: string;
  executedAt: string;
  status: CodeRunStatus;
  error?: string;
  passedTests: number;
  totalTests: number;
  failedTests: Array<{
    testId: string;
    error?: string;
    expected?: JsonValue;
    actual?: JsonValue;
  }>;
}

export interface CorrectionAttempt {
  runId?: string;
  executedAt: string;
  language: Language;
  status: CodeRunStatus;
  passedTests: number;
  totalTests: number;
  durationMs: number;
  codeSnapshot?: string;
  diffFromPrevious?: LineDiffSummary;
}

export interface CorrectionDiagnosis {
  artifactId: string;
  runId?: string;
  category: DiagnosisCategory;
  createdAt: string;
}

export interface CorrectionEpisode {
  id: string;
  problemSlug: string;
  problemContentVersion: number;
  startedAt: string;
  diagnosedAt: string;
  endedAt: string;
  initialFailure: CorrectionFailureEvidence;
  diagnosisCategory: DiagnosisCategory;
  diagnoses: CorrectionDiagnosis[];
  attempts: CorrectionAttempt[];
  resolved: boolean;
  resolvedAt?: string;
  passedWithinThreeRuns: boolean;
  repairDurationMs?: number;
  repeatedDiagnosisCategories: DiagnosisCategory[];
}

export interface ReviewAttempt {
  id: string;
  problemSlug: string;
  problemContentVersion: number;
  answer: string;
  submittedAt: string;
  grade?: ReviewGrade;
  selectedRating?: ReviewRating;
  ratingOverride?: ReviewRating;
  gradedArtifactId?: string;
}

export interface ReviewGrade {
  suggestedRating: ReviewRating;
  coverage: number;
  matchedPoints: string[];
  missingPoints: string[];
  rationale?: string;
  gradedAt?: string;
}

export interface ReviewRatingDecision {
  suggestedRating: ReviewRating;
  selectedRating: ReviewRating;
  selectionSource: 'suggested' | 'override';
  effectiveRating: ReviewRating;
  answerCap?: ReviewRating;
  subsequentPassRunId?: string;
  adjustedForSubsequentPass: boolean;
}

export interface EvidenceBasedReviewSchedule extends ReviewScheduleResult {
  decision: ReviewRatingDecision;
}

export interface PracticeSession {
  problemSlug: string;
  problemContentVersion?: number;
  code: Partial<Record<Language, string>>;
  runs: CodeRunResult[];
  hintLevel: 0 | 1 | 2 | 3;
  diagnosisCount: number;
  correctedAfterDiagnosis: boolean;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ParsedProblemDraft {
  title: string;
  description: string;
  difficulty: Difficulty;
  constraints: string[];
  entryPoint?: string;
  templates?: ProblemTemplates;
  languageConfigs?: Partial<Record<Language, ProblemLanguageConfig>>;
  signature?: ProblemFunctionSignature;
  version?: ProblemVersionMetadata;
  tests: TestCase[];
  testCoverage: 'none';
  warnings: string[];
  source: 'imported';
  sourceStatement?: string;
  sourceUrl?: string;
}

export type DiagnosisCategory =
  | 'syntax'
  | 'runtime'
  | 'timeout'
  | 'wrong-answer'
  | 'edge-case'
  | 'unknown';

export interface CounterexamplePayload {
  input: JsonValue[];
  expected?: JsonValue;
  actual?: JsonValue;
  explanation: string;
  /** Whether this exact input/result pair has real execution evidence. */
  verification?: 'observed' | 'executed' | 'unverified';
  sourceTestId?: string;
}

export interface HintPayload {
  level: 1 | 2 | 3;
  principle: string;
  direction?: string;
  pseudocode?: string;
}

export interface ReviewCardPayload {
  front: string;
  back: string;
  tags: string[];
}

export interface ReviewGradePayload {
  hitConcepts: string[];
  missedConcepts: string[];
  feedback: string;
  suggestedRating: ReviewRating;
  confidence: number;
}

export type LearningArtifactType =
  | 'parse'
  | 'diagnose'
  | 'hint'
  | 'counterexample'
  | 'review_card'
  | 'review_grade';

export interface LearningArtifact {
  id: string;
  type: LearningArtifactType;
  locale: CoachLocale;
  problemSlug?: string;
  runId?: string;
  problemContentVersion?: number;
  title: string;
  summary: string;
  details: string[];
  evidence: string[];
  nextAction?: string;
  diagnosisCategory?: DiagnosisCategory;
  hint?: HintPayload;
  counterexample?: CounterexamplePayload;
  reviewCard?: ReviewCardPayload;
  reviewGrade?: ReviewGradePayload;
  draft?: ParsedProblemDraft;
  generationMode?: 'live' | 'local';
  model?: string;
  promptVersion?: string;
  traceId?: string;
  latencyMs?: number;
  createdAt: string;
}

export type AssessmentKind = 'baseline' | 'checkpoint' | 'practice';

export interface AssessmentComparison {
  baselineAssessmentId: string;
  scoreDelta: number;
  correctCountDelta: number;
  averageDurationDeltaMs?: number;
  hintCountDelta?: number;
  baselineErrorCategories?: DiagnosisCategory[];
  checkpointErrorCategories?: DiagnosisCategory[];
}

export interface AssessmentResult {
  id: string;
  kind?: AssessmentKind;
  baselineAssessmentId?: string;
  version?: string;
  verificationToken?: string;
  problemSlugs: string[];
  problemVersions?: ProblemVersionRef[];
  startedAt: string;
  completedAt: string;
  score: number;
  correctCount: number;
  totalCount: number;
  weakTopics: ProblemTopic[];
  recommendation: string;
  averageDurationMs?: number;
  hintCount?: number;
  errorCategories?: DiagnosisCategory[];
  comparison?: AssessmentComparison;
}

export interface AssessmentState {
  id: string;
  kind?: AssessmentKind;
  baselineAssessmentId?: string;
  problemSlugs: string[];
  problemVersions?: ProblemVersionRef[];
  startedAt: string;
  durationMinutes: number;
}

export interface CoachState {
  version: number;
  profile: LearningProfile | null;
  sessions: Record<string, PracticeSession>;
  artifacts: LearningArtifact[];
  events: ProductEvent[];
  activeAssessment: AssessmentState | null;
  assessments: AssessmentResult[];
  dailyPlans: Record<string, DailyLearningPlan>;
  reviewAttempts: ReviewAttempt[];
  correctionEpisodes: CorrectionEpisode[];
  /** Flat compatibility views used by simple UI consumers. */
  code: Record<string, Partial<Record<Language, string>>>;
  runs: CodeRunResult[];
  completedProblemIds: string[];
}

/**
 * A field-level learning-data change. Collections contain only records that
 * changed locally; the server merges them by their stable key.
 */
export interface CoachSyncMutation {
  id: string;
  baseRevision: number;
  createdAt: string;
  changes: {
    profile?: LearningProfile | null;
    sessions?: Record<string, PracticeSession>;
    artifacts?: LearningArtifact[];
    events?: ProductEvent[];
    activeAssessment?: AssessmentState | null;
    assessments?: AssessmentResult[];
    dailyPlans?: Record<string, DailyLearningPlan>;
    reviewAttempts?: ReviewAttempt[];
    correctionEpisodes?: CorrectionEpisode[];
    code?: Record<string, Partial<Record<Language, string>>>;
    runs?: CodeRunResult[];
    completedProblemIds?: string[];
    reviewItems?: Record<string, ReviewItem>;
  };
  importedProblem?: Problem | null;
  importedDraftUpserts?: ImportedDraftRecord[];
  deletedImportedDraftSlugs?: string[];
}

export interface CoachSyncResult {
  revision: number;
  appliedMutationIds: string[];
  replayedMutationIds: string[];
}

export type ProductEventName =
  | 'visitor_started'
  | 'onboarding_started'
  | 'activated'
  | 'practice_started'
  | 'first_code_run'
  | 'first_problem_passed'
  | 'code_run'
  | 'code_submitted'
  | 'hint_revealed'
  | 'diagnosis_requested'
  | 'corrected_after_diagnosis'
  | 'assessment_started'
  | 'assessment_completed'
  | 'baseline_started'
  | 'baseline_completed'
  | 'checkpoint_completed'
  | 'daily_plan_viewed'
  | 'daily_plan_task_started'
  | 'daily_plan_task_swapped'
  | 'daily_plan_task_skipped'
  | 'daily_plan_task_completed'
  | 'review_answered'
  | 'review_rating_overridden'
  | 'correction_episode_completed'
  | 'counterexample_requested'
  | 'review_card_created'
  | 'review_completed'
  | 'guest_data_claimed'
  | 'sync_succeeded'
  | 'sync_failed'
  | 'language_selected'
  | 'typescript_transpile_failed'
  | 'catalog_sync_completed'
  | 'catalog_candidate_rejected'
  | 'catalog_revision_published'
  | 'catalog_revision_rolled_back'
  | 'experiment_exposed'
  | 'imported_problem_saved'
  | 'coach_chat_message'
  | 'csat_submitted';

export interface ProductEvent {
  id: string;
  name: ProductEventName;
  timestamp: string;
  sessionId: string;
  problemSlug?: string;
  properties?: Record<string, JsonValue>;
}

export interface ProductMetrics {
  activated: boolean;
  completedProblems: number;
  attemptedProblems: number;
  hintedProblems: number;
  diagnosedProblems: number;
  correctedProblems: number;
  practiceCompletionRate: number;
  hintUsageRate: number;
  correctionEffectiveness: number;
  assessmentAverage: number;
  currentStreak: number;
  topicMastery: Record<ProblemTopic, number>;
}

export type CoachAction =
  | 'parse'
  | 'diagnose'
  | 'hint'
  | 'counterexample'
  | 'review_card'
  | 'review_grade';

export interface CoachProblemContext {
  slug?: string;
  title: string;
  description: string;
  difficulty?: Difficulty;
  topics?: string[];
  constraints?: string[];
  entryPoint?: string;
}

export interface CoachRequest {
  action: CoachAction;
  locale?: CoachLocale;
  problemSlug?: string;
  problemContentVersion?: number;
  problem?: CoachProblemContext;
  statement?: string;
  language?: Language;
  code?: string;
  runResult?: CodeRunResult;
  hintLevel?: 1 | 2 | 3;
  reviewResponse?: string;
  reviewCard?: ReviewCardPayload;
  experimentVariant?: 'A' | 'B';
}

export interface CoachTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Server-side generation metadata. Model selection is never client-controlled. */
export interface CoachGenerationResult {
  artifact: LearningArtifact;
  /** Raw provider classification retained for offline/live quality evaluation. */
  providerDiagnosisCategory?: DiagnosisCategory;
  selectedModel: string;
  attempts: number;
  fallbackFrom?: string;
  finishReason: string;
  usage: CoachTokenUsage;
  estimatedCostUsd: number;
}

export interface CoachResponse {
  artifact: LearningArtifact;
  mode: 'live' | 'local';
  model: string;
  promptVersion: string;
  latencyMs: number;
  traceId: string;
  attempts?: number;
  fallbackFrom?: string;
  finishReason?: string;
  usage?: CoachTokenUsage;
  estimatedCostUsd?: number;
}

export interface CoachChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachChatRequest {
  messages: CoachChatMessage[];
  locale?: CoachLocale;
  problemSlug?: string;
  problemContentVersion?: number;
  problem?: CoachProblemContext;
  language?: Language;
  code?: string;
  runResult?: CodeRunResult;
}
