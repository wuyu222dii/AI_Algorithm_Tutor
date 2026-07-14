import type {
  Problem,
  ProblemFunctionSignature,
  ResolvedProblemLanguageConfig,
} from './types';

export const LANGUAGE_IDS = [
  'javascript',
  'typescript',
  'python',
  'cpp',
  'java',
  'go',
  'rust',
] as const;

export const ENABLED_LANGUAGE_IDS = [
  'javascript',
  'typescript',
  'python',
] as const;

export type Language = (typeof LANGUAGE_IDS)[number];
export type EnabledLanguage = (typeof ENABLED_LANGUAGE_IDS)[number];

export type LanguageRunner =
  | 'quickjs'
  | 'typescript-quickjs'
  | 'pyodide'
  | 'remote';

export interface LanguageDefinition {
  id: Language;
  label: string;
  shortLabel: string;
  monacoId: string;
  runner: LanguageRunner;
  runtimeVersion: string;
  enabled: boolean;
}

export const LANGUAGE_REGISTRY: Record<Language, LanguageDefinition> = {
  javascript: {
    id: 'javascript',
    label: 'JavaScript',
    shortLabel: 'JS',
    monacoId: 'javascript',
    runner: 'quickjs',
    runtimeVersion: 'quickjs-emscripten@0.32.0',
    enabled: true,
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    shortLabel: 'TS',
    monacoId: 'typescript',
    runner: 'typescript-quickjs',
    runtimeVersion: 'typescript@5.9.2 / quickjs-emscripten@0.32.0',
    enabled: true,
  },
  python: {
    id: 'python',
    label: 'Python',
    shortLabel: 'PY',
    monacoId: 'python',
    runner: 'pyodide',
    runtimeVersion: 'pyodide@314.0.2',
    enabled: true,
  },
  cpp: {
    id: 'cpp',
    label: 'C++',
    shortLabel: 'C++',
    monacoId: 'cpp',
    runner: 'remote',
    runtimeVersion: 'unconfigured',
    enabled: false,
  },
  java: {
    id: 'java',
    label: 'Java',
    shortLabel: 'Java',
    monacoId: 'java',
    runner: 'remote',
    runtimeVersion: 'unconfigured',
    enabled: false,
  },
  go: {
    id: 'go',
    label: 'Go',
    shortLabel: 'Go',
    monacoId: 'go',
    runner: 'remote',
    runtimeVersion: 'unconfigured',
    enabled: false,
  },
  rust: {
    id: 'rust',
    label: 'Rust',
    shortLabel: 'Rust',
    monacoId: 'rust',
    runner: 'remote',
    runtimeVersion: 'unconfigured',
    enabled: false,
  },
};

export const LANGUAGE_OPTIONS = LANGUAGE_IDS.map(
  (language) => LANGUAGE_REGISTRY[language]
);

export function getEnabledLanguageIds(
  typescriptEnabled: boolean
): EnabledLanguage[] {
  return ENABLED_LANGUAGE_IDS.filter(
    (language) => language !== 'typescript' || typescriptEnabled
  );
}

export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === 'string' &&
    Object.hasOwn(LANGUAGE_REGISTRY, value as Language)
  );
}

export function isEnabledLanguage(value: unknown): value is EnabledLanguage {
  return (
    isLanguage(value) &&
    LANGUAGE_REGISTRY[value].enabled &&
    ENABLED_LANGUAGE_IDS.includes(value as EnabledLanguage)
  );
}

export function languageLabel(language: Language): string {
  return LANGUAGE_REGISTRY[language].label;
}

export function createTypeScriptTemplate(javascriptTemplate: string): string {
  const typed = javascriptTemplate.replace(
    /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/,
    (match, name: string, rawParameters: string) => {
      const parameters = rawParameters
        .split(',')
        .map((parameter) => parameter.trim())
        .filter(Boolean);
      if (
        parameters.some((parameter) => !/^[A-Za-z_$][\w$]*$/.test(parameter))
      ) {
        return match;
      }
      const typedParameters = parameters
        .map((parameter) => `${parameter}: any`)
        .join(', ');
      return `function ${name}(${typedParameters}): unknown {`;
    }
  );

  return `// Replace any with precise types as you refine the solution.\n${typed}`;
}

export function getProblemLanguageConfig(
  problem: Pick<
    Problem,
    'entryPoint' | 'templates' | 'languageConfigs' | 'signature' | 'version'
  >,
  language: Language
): ResolvedProblemLanguageConfig | undefined {
  const explicit = problem.languageConfigs?.[language];
  const definition = LANGUAGE_REGISTRY[language];
  if (explicit) {
    return {
      ...explicit,
      signature:
        explicit.signature ??
        problem.signature ??
        inferFunctionSignature(
          explicit.template,
          explicit.entryPoint,
          language
        ),
      monacoId: explicit.monacoId ?? definition.monacoId,
      runner: explicit.runner ?? definition.runner,
      runtimeVersion: explicit.runtimeVersion ?? definition.runtimeVersion,
    };
  }

  const storedTemplate = problem.templates?.[language];
  const template =
    storedTemplate ??
    (language === 'typescript' && problem.templates?.javascript
      ? createTypeScriptTemplate(problem.templates.javascript)
      : undefined);
  if (!template) return undefined;

  const legacyEntryPoint = problem.entryPoint;
  if (!legacyEntryPoint) return undefined;
  const entryPoint =
    language === 'python' ? toSnakeCase(legacyEntryPoint) : legacyEntryPoint;

  return {
    entryPoint,
    template,
    signature:
      problem.signature ??
      inferFunctionSignature(template, entryPoint, language),
    monacoId: definition.monacoId,
    runner: definition.runner,
    runtimeVersion:
      problem.version?.runtimeVersions?.[language] ?? definition.runtimeVersion,
  };
}

export function getProblemTemplate(
  problem: Pick<
    Problem,
    'entryPoint' | 'templates' | 'languageConfigs' | 'signature' | 'version'
  >,
  language: Language
): string {
  return getProblemLanguageConfig(problem, language)?.template ?? '';
}

export function getProblemEntryPoint(
  problem: Pick<
    Problem,
    'entryPoint' | 'templates' | 'languageConfigs' | 'signature' | 'version'
  >,
  language: Language
): string {
  return getProblemLanguageConfig(problem, language)?.entryPoint ?? '';
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toLowerCase();
}

export function normalizeProblemLanguageConfigs(
  problem: Pick<
    Problem,
    'entryPoint' | 'templates' | 'languageConfigs' | 'signature' | 'version'
  >
): Partial<Record<Language, ResolvedProblemLanguageConfig>> {
  return Object.fromEntries(
    LANGUAGE_IDS.flatMap((language) => {
      const config = getProblemLanguageConfig(problem, language);
      return config ? [[language, config] as const] : [];
    })
  );
}

export function problemSupportsLanguage(
  problem: Pick<
    Problem,
    'entryPoint' | 'templates' | 'languageConfigs' | 'signature' | 'version'
  >,
  language: Language
): boolean {
  return Boolean(getProblemLanguageConfig(problem, language));
}

export function getProblemContentVersion(
  problem: Pick<Problem, 'version'>
): number {
  return problem.version?.contentVersion ?? 1;
}

function inferFunctionSignature(
  template: string,
  entryPoint: string,
  language: Language
): ProblemFunctionSignature {
  const escapedEntryPoint = entryPoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match =
    language === 'python'
      ? template.match(
          new RegExp(`def\\s+${escapedEntryPoint}\\s*\\(([^)]*)\\)`)
        )
      : template.match(
          new RegExp(`function\\s+${escapedEntryPoint}\\s*\\(([^)]*)\\)`)
        );
  const parameters = (match?.[1] ?? '')
    .split(',')
    .map((parameter) => parameter.trim())
    .filter(Boolean)
    .map((parameter, index) => {
      const name = parameter
        .replace(/:.*/, '')
        .replace(/=.*/, '')
        .replace(/^\.\.\./, '')
        .trim();
      return {
        name: /^[A-Za-z_$][\w$]*$/.test(name) ? name : `arg${index + 1}`,
        type: { kind: 'unknown' as const },
      };
    });
  return { parameters, returns: { kind: 'unknown' } };
}
