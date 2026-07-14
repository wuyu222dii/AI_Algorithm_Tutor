export type CatalogLanguage = 'javascript' | 'python' | 'typescript';

export type CatalogDifficulty = 'easy' | 'medium' | 'hard';

export type CatalogCandidateState =
  | 'discovered'
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
  localContentFingerprint: string;
  fetchedAt: string;
  problems: ExercismUpstreamProblem[];
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

export interface CatalogValidationResult {
  valid: boolean;
  issues: CatalogValidationIssue[];
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
