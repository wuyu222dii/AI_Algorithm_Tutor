import { CoachLocale, Difficulty, Language, ParsedProblemDraft } from './types';

const TITLE_PREFIX = /^(?:题目|标题|problem|title)\s*[:：]\s*/i;
const CONSTRAINT_MARKER =
  /(?:限制|约束|constraint|1\s*<=|0\s*<=|10\^|length|范围)/i;

function inferDifficulty(statement: string): Difficulty {
  const normalized = statement.toLowerCase();
  const hardSignals = [
    'hard',
    '困难',
    '最优',
    'segment tree',
    'trie',
    '并查集',
    '状态压缩',
  ];
  const mediumSignals = [
    'medium',
    '中等',
    'binary search',
    'dynamic programming',
    'bfs',
    'dfs',
    '二分',
    '动态规划',
    '图',
  ];

  if (hardSignals.some((signal) => normalized.includes(signal))) return 'hard';
  if (
    mediumSignals.some((signal) => normalized.includes(signal)) ||
    statement.length > 900
  ) {
    return 'medium';
  }
  return 'easy';
}

function inferEntryPoint(statement: string): string {
  const patterns = [
    /function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /def\s+([A-Za-z_]\w*)\s*\(/,
    /(?:函数名|方法名|function name)\s*[:：]\s*([A-Za-z_$][\w$]*)/i,
  ];

  for (const pattern of patterns) {
    const match = statement.match(pattern);
    if (match?.[1]) return match[1];
  }
  return 'solveProblem';
}

function toPythonName(entryPoint: string): string {
  return entryPoint
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toLowerCase();
}

function createTemplates(entryPoint: string): Record<Language, string> {
  return {
    javascript: `function ${entryPoint}(input) {
  // TODO: implement your solution.
  
}`,
    python: `def ${toPythonName(entryPoint)}(input):
    # TODO: implement your solution.
    pass`,
  };
}

function inferTitle(lines: string[], locale: CoachLocale): string {
  const firstMeaningful = lines.find(
    (line) => line.length > 0 && !CONSTRAINT_MARKER.test(line)
  );
  if (!firstMeaningful) {
    return locale === 'zh' ? '导入题目' : 'Imported problem';
  }

  const title = firstMeaningful.replace(TITLE_PREFIX, '').trim();
  if (title.length <= 80) return title;
  return `${title.slice(0, 77)}...`;
}

export function parseProblemDraft(
  rawStatement: string,
  locale: CoachLocale = 'zh'
): ParsedProblemDraft {
  const statement = rawStatement.replace(/\r\n/g, '\n').trim();
  const lines = statement
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const title = inferTitle(lines, locale);
  const entryPoint = inferEntryPoint(statement);
  const constraints = lines
    .filter((line) => CONSTRAINT_MARKER.test(line))
    .map((line) => line.replace(/^[-*•]\s*/, ''))
    .slice(0, 8);

  const warnings = [
    locale === 'zh'
      ? '导入结果是可编辑草稿，请确认函数参数与返回值。'
      : 'This import is an editable draft; verify parameters and return type.',
    locale === 'zh'
      ? '演示模式不会生成隐藏测试；请自行添加可验证的测试用例。'
      : 'Demo mode does not invent hidden tests; add test cases you can verify.',
  ];

  if (!statement) {
    warnings.unshift(
      locale === 'zh'
        ? '未检测到题面内容。'
        : 'No problem statement was detected.'
    );
  }
  if (constraints.length === 0) {
    warnings.push(
      locale === 'zh'
        ? '未识别到明确约束，请手动补充输入范围。'
        : 'No explicit constraints were found; add the input bounds manually.'
    );
  }

  return {
    title,
    description: statement,
    difficulty: inferDifficulty(statement),
    constraints,
    entryPoint,
    templates: createTemplates(entryPoint),
    tests: [],
    testCoverage: 'none',
    warnings,
    source: 'imported',
  };
}

export const parseProblemStatement = parseProblemDraft;
