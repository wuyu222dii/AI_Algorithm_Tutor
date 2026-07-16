export type CatalogLanguage = 'javascript' | 'python' | 'typescript';

export type CatalogDifficulty = 'easy' | 'medium' | 'hard';

export type CatalogCandidateState =
  | 'discovered'
  | 'drafting'
  | 'quarantined'
  | 'validated'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'archived';

export type CatalogJsonValue =
  | string
  | number
  | boolean
  | null
  | CatalogJsonValue[]
  | { [key: string]: CatalogJsonValue };

export interface CatalogLocalizedText {
  zh: string;
  en: string;
}

export interface CatalogTestCase {
  id: string;
  args: CatalogJsonValue[];
  expected: CatalogJsonValue;
  isSample: boolean;
  sourceKind?: 'canonical' | 'manual' | 'legacy';
  sourceTestUuid?: string;
  reviewNote?: string;
}

export type CatalogTypeSpec =
  | { kind: 'unknown' }
  | { kind: 'integer' }
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'array'; items: CatalogTypeSpec }
  | { kind: 'object'; fields: Record<string, CatalogTypeSpec> }
  | { kind: 'union'; options: CatalogTypeSpec[] };

export interface CatalogFunctionSignature {
  parameters: Array<{ name: string; type: CatalogTypeSpec }>;
  returns: CatalogTypeSpec;
}

export interface CatalogLanguageConfig {
  entryPoint: string;
  template: string;
  signature: CatalogFunctionSignature;
  monacoId: CatalogLanguage;
  runner: 'quickjs' | 'typescript-quickjs' | 'pyodide';
  runtimeVersion: string;
}

export interface CatalogProblemOrigin {
  provider: 'exercism';
  externalId: string;
  upstreamUrl: string;
  statementPath: string;
  licenseSpdx: 'MIT';
  attribution: string;
  sourceRevision: string;
  contentHash: string;
}

export interface RawCatalogProblem {
  id: string;
  slug: string;
  title: CatalogLocalizedText;
  description: CatalogLocalizedText;
  difficulty: CatalogDifficulty;
  topics: string[];
  languageConfigs: Record<CatalogLanguage, CatalogLanguageConfig>;
  tests: CatalogTestCase[];
  constraints: CatalogLocalizedText[];
  hints: {
    zh: [string, string, string];
    en: [string, string, string];
  };
  reviewPoints: CatalogLocalizedText[];
  learningObjectives?: CatalogLocalizedText[];
  prerequisiteTopics?: string[];
  solutionPatterns?: string[];
  estimatedMinutes: number;
  origin: CatalogProblemOrigin;
}

export type RawCatalogProblemInput = Omit<RawCatalogProblem, 'origin'> & {
  origin: Omit<CatalogProblemOrigin, 'contentHash'>;
};

export interface ExercismUpstreamProblem {
  externalId: string;
  upstreamUrl: string;
  statementPath: string;
  statementMarkdown: string;
  statementHash: string;
  statementBlobSha: string;
  canonicalPath: string;
  canonicalBlobSha?: string;
  canonicalData: CatalogJsonValue;
  canonicalDataHash: string;
  canonicalDataStatus: 'available' | 'missing' | 'parse_error';
}

export interface ExercismSnapshot {
  provider: 'exercism';
  repository: 'exercism/problem-specifications';
  revision: string;
  etag: string;
  licenseSpdx: 'MIT';
  license: ExercismLicenseEvidence;
  localContentFingerprint: string;
  fetchedAt: string;
  problems: ExercismUpstreamProblem[];
}

export interface ExercismGitTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface ExercismLicenseEvidence {
  path: 'LICENSE';
  spdx: 'MIT';
  text: string;
  gitBlobSha: string;
  contentHash: string;
}

export type ExercismDiscoveredExercise = ExercismUpstreamProblem;

export interface ExercismDiscoveryAiMetadata {
  /** `openrouter` is retained only for already-persisted discovery evidence. */
  provider: 'ai-relay' | 'openrouter';
  model: string;
  attempts?: number;
  fallbackFrom?: string;
  promptVersion: string;
  finishReason:
    | 'stop'
    | 'length'
    | 'content-filter'
    | 'tool-calls'
    | 'error'
    | 'other'
    | 'unknown';
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  latencyMs: number;
  inputHash: string;
  outputHash: string;
}

export type ExercismDiscoveryAiFailureReason =
  | 'credential_invalid'
  | 'group_access_denied'
  | 'rate_limited'
  | 'channel_unavailable'
  | 'timeout'
  | 'invalid_output';

export interface ExercismDiscoveryAiFailureMetadata {
  attempts: number;
  models: string[];
  fallbackFrom?: string;
  latencyMs: number;
  reservedCostUsd: number;
}

export interface ExercismDiscoveryFunctionSignature
  extends CatalogFunctionSignature {
  entryPoint: string;
}

export interface ExercismDiscoverySnapshot {
  schemaVersion: 1;
  provider: 'exercism';
  repository: 'exercism/problem-specifications';
  revision: string;
  etag: string;
  fetchedAt: string;
  license: ExercismLicenseEvidence;
  treeExerciseCount: number;
  knownExerciseCount: number;
  newExerciseCount: number;
  changedExerciseCount: number;
  unchangedExerciseCount: number;
  undiscoveredExerciseCount: number;
  selectedExerciseCount: number;
  selectionTruncated: boolean;
  exercises: ExercismDiscoveredExercise[];
}

export interface ExercismDiscoveryDraft {
  schemaVersion: 1;
  externalId: string;
  discoveryContentHash: string;
  status: 'needs_human_review' | 'rejected';
  publishable: false;
  /** Immutable upstream material retained for human review and normalization. */
  upstream: ExercismDiscoveredExercise;
  /** Present only when a live provider successfully produced the proposal. */
  aiMetadata?: ExercismDiscoveryAiMetadata;
  /** Safe failure classification when the deterministic fallback was retained. */
  aiFailureReason?: ExercismDiscoveryAiFailureReason;
  /** Bounded operational metadata; never contains prompts, bodies or credentials. */
  aiFailureMetadata?: ExercismDiscoveryAiFailureMetadata;
  source: {
    provider: 'exercism';
    repository: 'exercism/problem-specifications';
    revision: string;
    upstreamUrl: string;
    statementPath: string;
    statementHash: string;
    statementBlobSha: string;
    canonicalPath: string;
    canonicalDataHash: string;
    canonicalBlobSha?: string;
    licenseSpdx: 'MIT';
    licenseText: string;
    licenseGitBlobSha: string;
    licenseContentHash: string;
    attribution: string;
  };
  proposed: {
    title: CatalogLocalizedText;
    description: CatalogLocalizedText;
    difficulty: CatalogDifficulty | null;
    topics: string[];
    learningObjectives: CatalogLocalizedText[];
    functionSignature: ExercismDiscoveryFunctionSignature | null;
    starterTemplates: Partial<Record<CatalogLanguage, string>>;
    tests: [];
  };
  warnings: string[];
}

export interface ExercismDiscoveryReport {
  schemaVersion: 1;
  notModified: false;
  generatedAt: string;
  revision: string;
  etag: string;
  repository: 'exercism/problem-specifications';
  generatorId: string;
  license: ExercismLicenseEvidence;
  counts: {
    treeExercises: number;
    knownExercises: number;
    newExercises: number;
    changedExercises: number;
    unchangedExercises: number;
    undiscoveredExercises: number;
    selectedExercises: number;
    selectionTruncated: boolean;
  };
  drafts: ExercismDiscoveryDraft[];
}

export interface ExercismDiscoveryNotModifiedReport {
  schemaVersion: 1;
  notModified: true;
  generatedAt: string;
  revision: string;
  etag: string;
  repository: 'exercism/problem-specifications';
  drafts: [];
}

export type ExercismDiscoveryArtifact =
  | ExercismDiscoveryReport
  | ExercismDiscoveryNotModifiedReport;

export interface CatalogBootstrapSummary {
  runId: string;
  revision: string;
  etag?: string;
  localContentFingerprint: string;
  baselined: number;
  alreadyBaselined: number;
}

export interface CatalogValidationIssue {
  code:
    | 'dangerous_content'
    | 'duplicate_content'
    | 'duplicate_external_id'
    | 'duplicate_id'
    | 'duplicate_slug'
    | 'invalid_content_hash'
    | 'invalid_function_protocol'
    | 'invalid_license'
    | 'invalid_origin'
    | 'invalid_problem'
    | 'invalid_source_revision'
    | 'invalid_upstream_data'
    | 'manual_review_required';
  message: string;
  path?: string;
}

export interface CatalogRunnerCompatibilityEvidence {
  valid: boolean;
  testCount: number;
  checks: Array<{
    language: CatalogLanguage;
    runner: string;
    runtimeVersion: string;
    starter: {
      loaded: boolean;
      entryPointFound: boolean;
      compatible: boolean;
      durationMs: number;
    };
    oracle: {
      executedTests: number;
      passedTests: number;
      durationMs: number;
    };
  }>;
  issues: Array<{
    code: string;
    stage: string;
    message: string;
    language?: CatalogLanguage;
    path?: string;
    testId?: string;
  }>;
}

export interface CatalogValidationResult {
  valid: boolean;
  issues: CatalogValidationIssue[];
  runnerCompatibility?: CatalogRunnerCompatibilityEvidence;
  fingerprint?: string;
  policyVersion?: string;
  runnerVersion?: string;
}

export interface CatalogCandidate {
  id: string;
  state: CatalogCandidateState;
  problem: RawCatalogProblem;
  upstream: ExercismUpstreamProblem;
  contentHash: string;
  validation?: CatalogValidationResult;
  reviewedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogRelease {
  id: string;
  createdAt: string;
  reviewer: string;
  previousReleaseId?: string;
  sourceRevision: string;
  candidateIds: string[];
  problems: RawCatalogProblem[];
}

export interface CatalogSourceState {
  etag?: string;
  revision?: string;
  localContentFingerprint?: string;
  lastCheckedAt?: string;
}

export interface CatalogAuditEntry {
  action: 'sync' | 'validate' | 'approve' | 'publish' | 'rollback';
  actor: string;
  at: string;
  details: Record<string, CatalogJsonValue>;
}

export interface CatalogWorkspace {
  schemaVersion: 1;
  source: CatalogSourceState;
  candidates: CatalogCandidate[];
  releases: CatalogRelease[];
  activeReleaseId?: string;
  audit: CatalogAuditEntry[];
}

export interface CatalogSyncResult {
  notModified: boolean;
  snapshot?: ExercismSnapshot;
  workspace: CatalogWorkspace;
  discoveredCandidateIds: string[];
}
