export type Language = 'javascript' | 'python';

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
  entryPoint: string;
  templates: Record<Language, string>;
  tests: TestCase[];
  examples: ProblemExample[];
  constraints: LocalizedText[];
  hints: Record<CoachLocale, [string, string, string]>;
  reviewPoints: LocalizedText[];
  estimatedMinutes: number;
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
}

export type LearningGoal = 'foundation' | 'interview' | 'contest';

export interface LearningProfile {
  goal: LearningGoal;
  preferredLanguage: Language;
  weeklyTarget: number;
  weeklyGoal?: number;
  onboardingCompleted?: boolean;
  createdAt?: string;
  onboardedAt: string;
}

export interface PracticeSession {
  problemSlug: string;
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
  entryPoint: string;
  templates: Record<Language, string>;
  tests: TestCase[];
  testCoverage: 'none';
  warnings: string[];
  source: 'imported';
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

export type LearningArtifactType =
  | 'parse'
  | 'diagnose'
  | 'hint'
  | 'counterexample'
  | 'review_card';

export interface LearningArtifact {
  id: string;
  type: LearningArtifactType;
  locale: CoachLocale;
  problemSlug?: string;
  runId?: string;
  title: string;
  summary: string;
  details: string[];
  evidence: string[];
  nextAction?: string;
  diagnosisCategory?: DiagnosisCategory;
  hint?: HintPayload;
  counterexample?: CounterexamplePayload;
  reviewCard?: ReviewCardPayload;
  draft?: ParsedProblemDraft;
  generationMode?: 'live' | 'local';
  model?: string;
  promptVersion?: string;
  traceId?: string;
  latencyMs?: number;
  createdAt: string;
}

export interface AssessmentResult {
  id: string;
  version?: string;
  verificationToken?: string;
  problemSlugs: string[];
  startedAt: string;
  completedAt: string;
  score: number;
  correctCount: number;
  totalCount: number;
  weakTopics: ProblemTopic[];
  recommendation: string;
}

export interface AssessmentState {
  id: string;
  problemSlugs: string[];
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
    code?: Record<string, Partial<Record<Language, string>>>;
    runs?: CodeRunResult[];
    completedProblemIds?: string[];
  };
  importedProblem?: Problem | null;
}

export interface CoachSyncResult {
  revision: number;
  appliedMutationIds: string[];
  replayedMutationIds: string[];
}

export type ProductEventName =
  | 'activated'
  | 'practice_started'
  | 'code_run'
  | 'code_submitted'
  | 'hint_revealed'
  | 'diagnosis_requested'
  | 'corrected_after_diagnosis'
  | 'assessment_started'
  | 'assessment_completed'
  | 'counterexample_requested'
  | 'review_card_created'
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
  | 'review_card';

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
  problem?: CoachProblemContext;
  statement?: string;
  language?: Language;
  code?: string;
  runResult?: CodeRunResult;
  hintLevel?: 1 | 2 | 3;
  experimentVariant?: 'A' | 'B';
  model?: string;
}

export interface CoachResponse {
  artifact: LearningArtifact;
  mode: 'live' | 'local';
  model: string;
  promptVersion: string;
  latencyMs: number;
  traceId: string;
}

export interface CoachChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachChatRequest {
  messages: CoachChatMessage[];
  locale?: CoachLocale;
  problemSlug?: string;
  problem?: CoachProblemContext;
  language?: Language;
  code?: string;
  runResult?: CodeRunResult;
  model?: string;
}
