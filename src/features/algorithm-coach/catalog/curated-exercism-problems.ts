import { withContentHash } from './content-hash';
import type {
  CatalogDifficulty,
  CatalogJsonValue,
  CatalogLocalizedText,
  CatalogTestCase,
  CatalogTypeSpec,
  RawCatalogProblem,
} from './raw-types';

export const EXERCISM_FIXTURE_REVISION =
  '4d18823c6abd89a60f2df65345d970a31fa12e49';

export const EXERCISM_ATTRIBUTION =
  'Adapted from Exercism problem-specifications. Copyright (c) 2014, 2019, 2021 Exercism. Licensed under the MIT License.';

const text = (zh: string, en: string): CatalogLocalizedText => ({ zh, en });

interface TemplateParameter {
  name: string;
  type: string;
}

interface ExerciseDefinition {
  id: string;
  externalId: string;
  statementFile: 'description.md' | 'instructions.md';
  slug: string;
  entryPoint: string;
  title: CatalogLocalizedText;
  description: CatalogLocalizedText;
  difficulty: CatalogDifficulty;
  topics: string[];
  parameters: TemplateParameter[];
  returnType: string;
  tests: CatalogTestCase[];
  constraints: CatalogLocalizedText[];
  hints: {
    zh: [string, string, string];
    en: [string, string, string];
  };
  reviewPoints: CatalogLocalizedText[];
  estimatedMinutes: number;
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toTypeSpec(value: string): CatalogTypeSpec {
  if (value === 'number') return { kind: 'number' };
  if (value === 'string') return { kind: 'string' };
  if (value === 'boolean') return { kind: 'boolean' };
  if (value === 'string[]') {
    return { kind: 'array', items: { kind: 'string' } };
  }
  if (value === 'Record<string, number> | null') {
    return {
      kind: 'union',
      options: [{ kind: 'object', fields: {} }, { kind: 'null' }],
    };
  }
  return { kind: 'unknown' };
}

function defineExercise(definition: ExerciseDefinition): RawCatalogProblem {
  const parameters = definition.parameters.map(({ name }) => name).join(', ');
  const typedParameters = definition.parameters
    .map(({ name, type }) => `${name}: ${type}`)
    .join(', ');
  const pythonEntryPoint = camelToSnake(definition.entryPoint);
  const statementPath = `exercises/${definition.externalId}/${definition.statementFile}`;
  const signature = {
    parameters: definition.parameters.map(({ name, type }) => ({
      name,
      type: toTypeSpec(type),
    })),
    returns: toTypeSpec(definition.returnType),
  };

  return withContentHash({
    id: definition.id,
    slug: definition.slug,
    title: definition.title,
    description: definition.description,
    difficulty: definition.difficulty,
    topics: definition.topics,
    languageConfigs: {
      javascript: {
        entryPoint: definition.entryPoint,
        template: `function ${definition.entryPoint}(${parameters}) {\n  // TODO: implement your solution.\n}`,
        signature,
        monacoId: 'javascript',
        runner: 'quickjs',
        runtimeVersion: 'quickjs-emscripten@0.32.0',
      },
      python: {
        entryPoint: pythonEntryPoint,
        template: `def ${pythonEntryPoint}(${parameters}):\n    # TODO: implement your solution.\n    pass`,
        signature,
        monacoId: 'python',
        runner: 'pyodide',
        runtimeVersion: 'pyodide@314.0.2',
      },
      typescript: {
        entryPoint: definition.entryPoint,
        template: `function ${definition.entryPoint}(${typedParameters}): ${definition.returnType} {\n  // TODO: implement your solution.\n  throw new Error('Not implemented');\n}`,
        signature,
        monacoId: 'typescript',
        runner: 'typescript-quickjs',
        runtimeVersion: 'typescript@5.9.2 / quickjs-emscripten@0.32.0',
      },
    },
    tests: definition.tests,
    constraints: definition.constraints,
    hints: definition.hints,
    reviewPoints: definition.reviewPoints,
    estimatedMinutes: definition.estimatedMinutes,
    origin: {
      provider: 'exercism',
      externalId: definition.externalId,
      upstreamUrl: `https://github.com/exercism/problem-specifications/tree/${EXERCISM_FIXTURE_REVISION}/exercises/${definition.externalId}`,
      statementPath,
      licenseSpdx: 'MIT',
      attribution: EXERCISM_ATTRIBUTION,
      sourceRevision: EXERCISM_FIXTURE_REVISION,
    },
  });
}

export const curatedExercismProblems: RawCatalogProblem[] = [
  defineExercise({
    id: 'ex-001',
    externalId: 'hello-world',
    statementFile: 'description.md',
    slug: 'exercism-hello-world',
    entryPoint: 'helloWorld',
    title: text('返回问候语', 'Return a Greeting'),
    description: text(
      '编写一个不接收参数的函数，返回精确字符串 "Hello, World!"。',
      'Write a function with no parameters that returns the exact string "Hello, World!".'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    parameters: [],
    returnType: 'string',
    tests: [
      { id: 'hello-1', args: [], expected: 'Hello, World!', isSample: true },
      { id: 'hello-2', args: [], expected: 'Hello, World!', isSample: false },
      { id: 'hello-3', args: [], expected: 'Hello, World!', isSample: false },
    ],
    constraints: [
      text('返回值必须完全匹配。', 'The return value must match exactly.'),
    ],
    hints: {
      zh: [
        '函数不需要读取输入。',
        '直接构造固定字符串。',
        '返回指定文本并保留标点和大小写。',
      ],
      en: [
        'The function does not need to read input.',
        'Construct the fixed string directly.',
        'Return the requested text with exact punctuation and casing.',
      ],
    },
    reviewPoints: [
      text('区分返回值与控制台输出。', 'Distinguish returning from printing.'),
    ],
    estimatedMinutes: 5,
  }),
  defineExercise({
    id: 'ex-002',
    externalId: 'two-fer',
    statementFile: 'instructions.md',
    slug: 'exercism-two-fer',
    entryPoint: 'twoFer',
    title: text('一人一份', 'One for You, One for Me'),
    description: text(
      '给定姓名，返回 "One for NAME, one for me."；姓名为空时使用 "you"。',
      'Given a name, return "One for NAME, one for me."; use "you" when the name is empty.'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    parameters: [{ name: 'name', type: 'string' }],
    returnType: 'string',
    tests: [
      {
        id: 'two-fer-1',
        args: ['Alice'],
        expected: 'One for Alice, one for me.',
        isSample: true,
      },
      {
        id: 'two-fer-2',
        args: [''],
        expected: 'One for you, one for me.',
        isSample: true,
      },
      {
        id: 'two-fer-3',
        args: ['Bob'],
        expected: 'One for Bob, one for me.',
        isSample: false,
      },
    ],
    constraints: [text('name 为字符串。', 'name is a string.')],
    hints: {
      zh: ['先处理空姓名。', '准备默认姓名 you。', '把最终姓名嵌入固定句式。'],
      en: [
        'Handle an empty name first.',
        'Prepare the default name "you".',
        'Insert the final name into the fixed sentence.',
      ],
    },
    reviewPoints: [
      text(
        '默认值可减少分支重复。',
        'A default value reduces duplicated branches.'
      ),
    ],
    estimatedMinutes: 8,
  }),
  defineExercise({
    id: 'ex-003',
    externalId: 'leap',
    statementFile: 'instructions.md',
    slug: 'exercism-leap-year',
    entryPoint: 'isLeapYear',
    title: text('判断闰年', 'Determine a Leap Year'),
    description: text(
      '年份能被 4 整除时通常为闰年，但能被 100 整除的年份必须同时能被 400 整除。',
      'A year is usually a leap year when divisible by 4, but a year divisible by 100 must also be divisible by 400.'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    parameters: [{ name: 'year', type: 'number' }],
    returnType: 'boolean',
    tests: [
      { id: 'leap-1', args: [1996], expected: true, isSample: true },
      { id: 'leap-2', args: [1900], expected: false, isSample: true },
      { id: 'leap-3', args: [2000], expected: true, isSample: false },
      { id: 'leap-4', args: [2019], expected: false, isSample: false },
    ],
    constraints: [text('year 为正整数。', 'year is a positive integer.')],
    hints: {
      zh: [
        '先考虑世纪年份。',
        '400 的规则优先级最高。',
        '能被 400 整除，或能被 4 但不能被 100 整除。',
      ],
      en: [
        'Consider century years first.',
        'The rule for 400 has the highest priority.',
        'Divisible by 400, or divisible by 4 but not 100.',
      ],
    },
    reviewPoints: [
      text(
        '布尔条件需要体现例外层级。',
        'Boolean conditions should encode exception precedence.'
      ),
    ],
    estimatedMinutes: 10,
  }),
  defineExercise({
    id: 'ex-004',
    externalId: 'raindrops',
    statementFile: 'instructions.md',
    slug: 'exercism-raindrop-sounds',
    entryPoint: 'raindropSounds',
    title: text('雨滴因子声音', 'Raindrop Factor Sounds'),
    description: text(
      '按顺序连接数字因子对应的声音：3 为 Pling、5 为 Plang、7 为 Plong；都不整除时返回数字文本。',
      'Concatenate sounds for factors in order: 3 is Pling, 5 is Plang, and 7 is Plong; return the number as text when none divide it.'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    parameters: [{ name: 'value', type: 'number' }],
    returnType: 'string',
    tests: [
      { id: 'rain-1', args: [28], expected: 'Plong', isSample: true },
      { id: 'rain-2', args: [30], expected: 'PlingPlang', isSample: true },
      { id: 'rain-3', args: [34], expected: '34', isSample: false },
      {
        id: 'rain-4',
        args: [105],
        expected: 'PlingPlangPlong',
        isSample: false,
      },
    ],
    constraints: [text('value 为正整数。', 'value is a positive integer.')],
    hints: {
      zh: [
        '每个因子独立判断。',
        '按 3、5、7 的顺序追加声音。',
        '结果为空时返回 value 的字符串。',
      ],
      en: [
        'Check every factor independently.',
        'Append sounds in 3, 5, 7 order.',
        'Return value as a string when no sound was appended.',
      ],
    },
    reviewPoints: [
      text(
        '这里不能使用互斥的 else-if。',
        'The factor checks must not be mutually exclusive.'
      ),
    ],
    estimatedMinutes: 12,
  }),
  defineExercise({
    id: 'ex-005',
    externalId: 'reverse-string',
    statementFile: 'instructions.md',
    slug: 'exercism-reverse-text',
    entryPoint: 'reverseText',
    title: text('反转文本', 'Reverse Text'),
    description: text(
      '返回输入字符串的字符逆序结果。',
      'Return the input string with its characters in reverse order.'
    ),
    difficulty: 'easy',
    topics: ['two-pointers'],
    parameters: [{ name: 'value', type: 'string' }],
    returnType: 'string',
    tests: [
      { id: 'reverse-1', args: ['robot'], expected: 'tobor', isSample: true },
      { id: 'reverse-2', args: [''], expected: '', isSample: true },
      {
        id: 'reverse-3',
        args: ['racecar'],
        expected: 'racecar',
        isSample: false,
      },
      { id: 'reverse-4', args: ['a b'], expected: 'b a', isSample: false },
    ],
    constraints: [
      text(
        '输入只包含 ASCII 字符。',
        'The input contains ASCII characters only.'
      ),
    ],
    hints: {
      zh: [
        '从末尾开始读取。',
        '可以使用双指针交换。',
        '持续交换 left 与 right，直到指针相遇。',
      ],
      en: [
        'Read from the end.',
        'Two pointers can swap characters.',
        'Keep swapping left and right until the pointers meet.',
      ],
    },
    reviewPoints: [
      text(
        '明确字符范围可避免 Unicode 歧义。',
        'An explicit character range avoids Unicode ambiguity.'
      ),
    ],
    estimatedMinutes: 10,
  }),
  defineExercise({
    id: 'ex-006',
    externalId: 'rna-transcription',
    statementFile: 'instructions.md',
    slug: 'exercism-rna-transcription',
    entryPoint: 'toRna',
    title: text('DNA 转录为 RNA', 'Transcribe DNA to RNA'),
    description: text(
      '按 G→C、C→G、T→A、A→U 的规则转录 DNA 字符串。',
      'Transcribe a DNA string using G→C, C→G, T→A, and A→U.'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    parameters: [{ name: 'dna', type: 'string' }],
    returnType: 'string',
    tests: [
      {
        id: 'rna-1',
        args: ['ACGTGGTCTTAA'],
        expected: 'UGCACCAGAAUU',
        isSample: true,
      },
      { id: 'rna-2', args: [''], expected: '', isSample: true },
      { id: 'rna-3', args: ['G'], expected: 'C', isSample: false },
      { id: 'rna-4', args: ['AAA'], expected: 'UUU', isSample: false },
    ],
    constraints: [
      text('dna 只包含 A、C、G、T。', 'dna contains only A, C, G, and T.'),
    ],
    hints: {
      zh: [
        '每个字符独立映射。',
        '用表保存四种对应关系。',
        '遍历 dna 并把映射结果连接起来。',
      ],
      en: [
        'Map each character independently.',
        'Store the four mappings in a table.',
        'Scan dna and concatenate mapped values.',
      ],
    },
    reviewPoints: [
      text(
        '查找表比多层条件更易审查。',
        'A lookup table is easier to audit than nested conditions.'
      ),
    ],
    estimatedMinutes: 12,
  }),
  defineExercise({
    id: 'ex-007',
    externalId: 'space-age',
    statementFile: 'instructions.md',
    slug: 'exercism-space-age',
    entryPoint: 'spaceAge',
    title: text('行星年龄', 'Age on a Planet'),
    description: text(
      '给定行星名称和秒数，根据地球年 31557600 秒及行星公转比计算年龄，四舍五入到两位小数。支持 earth、mercury、venus、mars。',
      'Given a planet and seconds, calculate age using an Earth year of 31557600 seconds and the orbital ratio, rounded to two decimals. Support earth, mercury, venus, and mars.'
    ),
    difficulty: 'medium',
    topics: ['array-hash'],
    parameters: [
      { name: 'planet', type: 'string' },
      { name: 'seconds', type: 'number' },
    ],
    returnType: 'number',
    tests: [
      { id: 'space-1', args: ['earth', 31557600], expected: 1, isSample: true },
      {
        id: 'space-2',
        args: ['mercury', 2134835688],
        expected: 280.88,
        isSample: true,
      },
      {
        id: 'space-3',
        args: ['venus', 189839836],
        expected: 9.78,
        isSample: false,
      },
      {
        id: 'space-4',
        args: ['mars', 2129871239],
        expected: 35.88,
        isSample: false,
      },
    ],
    constraints: [
      text('seconds 为非负整数。', 'seconds is a non-negative integer.'),
    ],
    hints: {
      zh: [
        '先换算为地球年。',
        '再除以行星公转比。',
        '用 Math.round(value * 100) / 100 保留两位。',
      ],
      en: [
        'Convert seconds to Earth years first.',
        'Then divide by the orbital ratio.',
        'Use Math.round(value * 100) / 100 for two decimals.',
      ],
    },
    reviewPoints: [
      text(
        '把常量集中在映射表中。',
        'Keep constants together in a lookup table.'
      ),
    ],
    estimatedMinutes: 18,
  }),
  defineExercise({
    id: 'ex-008',
    externalId: 'grains',
    statementFile: 'instructions.md',
    slug: 'exercism-chessboard-grains',
    entryPoint: 'grainsOnSquare',
    title: text('棋盘麦粒数', 'Grains on a Chessboard Square'),
    description: text(
      '第 1 格有 1 粒，之后每格翻倍。返回第 square 格的麦粒数字符串。',
      'The first square has 1 grain and each following square doubles it. Return the grain count on square as a decimal string.'
    ),
    difficulty: 'medium',
    topics: ['dynamic-programming'],
    parameters: [{ name: 'square', type: 'number' }],
    returnType: 'string',
    tests: [
      { id: 'grains-1', args: [1], expected: '1', isSample: true },
      { id: 'grains-2', args: [2], expected: '2', isSample: true },
      { id: 'grains-3', args: [16], expected: '32768', isSample: false },
      {
        id: 'grains-4',
        args: [64],
        expected: '9223372036854775808',
        isSample: false,
      },
    ],
    constraints: [text('1 <= square <= 64。', '1 <= square <= 64.')],
    hints: {
      zh: [
        '观察相邻格的倍数关系。',
        '第 n 格是 2 的 n-1 次方。',
        '使用任意精度整数并转为字符串。',
      ],
      en: [
        'Observe the ratio between adjacent squares.',
        'Square n contains 2 to the power n-1.',
        'Use arbitrary-precision integers and convert to a string.',
      ],
    },
    reviewPoints: [
      text(
        '大整数不能用普通 JSON 数字可靠表示。',
        'Large integers cannot be represented reliably as ordinary JSON numbers.'
      ),
    ],
    estimatedMinutes: 18,
  }),
  defineExercise({
    id: 'ex-009',
    externalId: 'hamming',
    statementFile: 'instructions.md',
    slug: 'exercism-hamming-distance',
    entryPoint: 'hammingDistance',
    title: text('汉明距离', 'Hamming Distance'),
    description: text(
      '统计两个等长 DNA 字符串在相同位置上不同字符的数量；长度不同时返回 -1。',
      'Count positions with different characters in two equal-length DNA strings; return -1 when lengths differ.'
    ),
    difficulty: 'easy',
    topics: ['two-pointers'],
    parameters: [
      { name: 'left', type: 'string' },
      { name: 'right', type: 'string' },
    ],
    returnType: 'number',
    tests: [
      {
        id: 'hamming-1',
        args: ['GAGCCT', 'CATCGT'],
        expected: 3,
        isSample: true,
      },
      { id: 'hamming-2', args: ['', ''], expected: 0, isSample: true },
      { id: 'hamming-3', args: ['A', 'G'], expected: 1, isSample: false },
      { id: 'hamming-4', args: ['AA', 'A'], expected: -1, isSample: false },
    ],
    constraints: [
      text('字符串只包含 A、C、G、T。', 'Strings contain only A, C, G, and T.'),
    ],
    hints: {
      zh: ['先检查长度。', '逐个比较对应位置。', '字符不同时将计数加一。'],
      en: [
        'Check lengths first.',
        'Compare corresponding positions.',
        'Increment the count when characters differ.',
      ],
    },
    reviewPoints: [
      text(
        '输入前置条件应显式处理。',
        'Input preconditions should be handled explicitly.'
      ),
    ],
    estimatedMinutes: 12,
  }),
  defineExercise({
    id: 'ex-010',
    externalId: 'pangram',
    statementFile: 'instructions.md',
    slug: 'exercism-pangram',
    entryPoint: 'isPangram',
    title: text('全字母句', 'Pangram Check'),
    description: text(
      '忽略大小写，判断文本是否至少包含一次英文字母 a 到 z。',
      'Ignoring case, determine whether the text contains every English letter from a through z at least once.'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    parameters: [{ name: 'text', type: 'string' }],
    returnType: 'boolean',
    tests: [
      {
        id: 'pangram-1',
        args: ['The quick brown fox jumps over the lazy dog.'],
        expected: true,
        isSample: true,
      },
      {
        id: 'pangram-2',
        args: ['Five quacking Zephyrs jolt my wax bed.'],
        expected: true,
        isSample: true,
      },
      {
        id: 'pangram-3',
        args: ['abcdefghijklmnopqrstuvwxy'],
        expected: false,
        isSample: false,
      },
      { id: 'pangram-4', args: [''], expected: false, isSample: false },
    ],
    constraints: [text('只统计英文字母。', 'Only English letters count.')],
    hints: {
      zh: [
        '统一转为小写。',
        '集合可去除重复字母。',
        '过滤 a-z 后检查集合大小是否为 26。',
      ],
      en: [
        'Normalize to lowercase.',
        'A set removes duplicate letters.',
        'Filter a-z and check whether the set size is 26.',
      ],
    },
    reviewPoints: [
      text('规范化输入后再聚合。', 'Normalize input before aggregation.'),
    ],
    estimatedMinutes: 14,
  }),
  defineExercise({
    id: 'ex-011',
    externalId: 'isogram',
    statementFile: 'description.md',
    slug: 'exercism-isogram',
    entryPoint: 'isIsogram',
    title: text('无重复字母词组', 'Isogram Check'),
    description: text(
      '忽略大小写、空格和连字符，判断每个英文字母是否最多出现一次。',
      'Ignoring case, spaces, and hyphens, determine whether every English letter appears at most once.'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    parameters: [{ name: 'text', type: 'string' }],
    returnType: 'boolean',
    tests: [
      {
        id: 'isogram-1',
        args: ['lumberjacks'],
        expected: true,
        isSample: true,
      },
      { id: 'isogram-2', args: ['background'], expected: true, isSample: true },
      {
        id: 'isogram-3',
        args: ['six-year-old'],
        expected: true,
        isSample: false,
      },
      { id: 'isogram-4', args: ['Alphabet'], expected: false, isSample: false },
    ],
    constraints: [
      text(
        '非字母分隔符不参与重复判断。',
        'Non-letter separators do not participate in duplicate checks.'
      ),
    ],
    hints: {
      zh: [
        '先规范化大小写。',
        '跳过非字母字符。',
        '字母已在集合中时立即返回 false。',
      ],
      en: [
        'Normalize case first.',
        'Skip non-letter characters.',
        'Return false as soon as a letter is already in the set.',
      ],
    },
    reviewPoints: [
      text(
        '提前返回可以减少无效扫描。',
        'Early return avoids unnecessary scanning.'
      ),
    ],
    estimatedMinutes: 14,
  }),
  defineExercise({
    id: 'ex-012',
    externalId: 'anagram',
    statementFile: 'instructions.md',
    slug: 'exercism-anagram-filter',
    entryPoint: 'findAnagrams',
    title: text('筛选异序词', 'Filter Anagrams'),
    description: text(
      '从候选词中返回目标词的异序词，忽略大小写但排除与目标词完全相同的词。',
      'Return candidates that are anagrams of the target, ignoring case while excluding the same word as the target.'
    ),
    difficulty: 'medium',
    topics: ['array-hash'],
    parameters: [
      { name: 'target', type: 'string' },
      { name: 'candidates', type: 'string[]' },
    ],
    returnType: 'string[]',
    tests: [
      {
        id: 'anagram-1',
        args: ['stone', ['stone', 'tones', 'banana', 'notes']],
        expected: ['tones', 'notes'],
        isSample: true,
      },
      {
        id: 'anagram-2',
        args: ['Orchestra', ['cashregister', 'Carthorse', 'radishes']],
        expected: ['Carthorse'],
        isSample: true,
      },
      {
        id: 'anagram-3',
        args: ['allergy', ['gallery', 'ballerina', 'regally']],
        expected: ['gallery', 'regally'],
        isSample: false,
      },
      { id: 'anagram-4', args: ['a', []], expected: [], isSample: false },
    ],
    constraints: [
      text('候选词顺序必须保留。', 'Candidate order must be preserved.'),
    ],
    hints: {
      zh: [
        '为目标词建立规范签名。',
        '排序后的字母序列可以作为签名。',
        '排除同词后比较每个候选签名。',
      ],
      en: [
        'Build a normalized signature for the target.',
        'Sorted letters can serve as a signature.',
        'Exclude the same word, then compare every candidate signature.',
      ],
    },
    reviewPoints: [
      text(
        '签名将排列比较转为相等比较。',
        'A signature turns permutation comparison into equality comparison.'
      ),
    ],
    estimatedMinutes: 20,
  }),
  defineExercise({
    id: 'ex-013',
    externalId: 'scrabble-score',
    statementFile: 'instructions.md',
    slug: 'exercism-scrabble-score',
    entryPoint: 'scrabbleScore',
    title: text('字母拼词得分', 'Letter Tile Score'),
    description: text(
      '忽略大小写，根据标准英文拼字游戏字母分值计算单词总分；非字母不计分。',
      'Ignoring case, calculate a word score with standard English letter-tile values; non-letters score zero.'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    parameters: [{ name: 'word', type: 'string' }],
    returnType: 'number',
    tests: [
      { id: 'score-1', args: ['cabbage'], expected: 14, isSample: true },
      { id: 'score-2', args: ['quirky'], expected: 22, isSample: true },
      {
        id: 'score-3',
        args: ['OXYPHENBUTAZONE'],
        expected: 41,
        isSample: false,
      },
      { id: 'score-4', args: [''], expected: 0, isSample: false },
    ],
    constraints: [
      text('输入长度不超过 1000。', 'The input length is at most 1000.'),
    ],
    hints: {
      zh: [
        '统一字母大小写。',
        '建立字符到分值的映射。',
        '遍历字符并累加存在于映射中的分值。',
      ],
      en: [
        'Normalize letter case.',
        'Build a character-to-score lookup.',
        'Scan characters and add scores found in the lookup.',
      ],
    },
    reviewPoints: [
      text(
        '数据驱动映射便于核对规则。',
        'A data-driven lookup makes rules easier to verify.'
      ),
    ],
    estimatedMinutes: 16,
  }),
  defineExercise({
    id: 'ex-014',
    externalId: 'nucleotide-count',
    statementFile: 'description.md',
    slug: 'exercism-nucleotide-count',
    entryPoint: 'countNucleotides',
    title: text('核苷酸计数', 'Nucleotide Counts'),
    description: text(
      '统计 DNA 中 A、C、G、T 的数量并返回对象；出现其他字符时返回 null。',
      'Count A, C, G, and T in DNA and return an object; return null if another character appears.'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    parameters: [{ name: 'dna', type: 'string' }],
    returnType: 'Record<string, number> | null',
    tests: [
      {
        id: 'nucleotide-1',
        args: ['GATTACA'],
        expected: { A: 3, C: 1, G: 1, T: 2 },
        isSample: true,
      },
      {
        id: 'nucleotide-2',
        args: [''],
        expected: { A: 0, C: 0, G: 0, T: 0 },
        isSample: true,
      },
      {
        id: 'nucleotide-3',
        args: ['CCCC'],
        expected: { A: 0, C: 4, G: 0, T: 0 },
        isSample: false,
      },
      { id: 'nucleotide-4', args: ['ACX'], expected: null, isSample: false },
    ],
    constraints: [
      text(
        '有效 DNA 只包含 A、C、G、T。',
        'Valid DNA contains only A, C, G, and T.'
      ),
    ],
    hints: {
      zh: [
        '先初始化四个计数。',
        '每个字符更新对应计数。',
        '找不到对应键时立即返回 null。',
      ],
      en: [
        'Initialize all four counts.',
        'Update the matching count for each character.',
        'Return null immediately when no matching key exists.',
      ],
    },
    reviewPoints: [
      text(
        '固定输出结构让边界情况更稳定。',
        'A fixed output shape keeps edge cases stable.'
      ),
    ],
    estimatedMinutes: 14,
  }),
  defineExercise({
    id: 'ex-015',
    externalId: 'collatz-conjecture',
    statementFile: 'instructions.md',
    slug: 'exercism-collatz-steps',
    entryPoint: 'collatzSteps',
    title: text('考拉兹步数', 'Collatz Step Count'),
    description: text(
      '从正整数开始，偶数除以 2，奇数变为 3n+1，返回到达 1 的步数；非正数返回 -1。',
      'Starting from a positive integer, halve even values and replace odd values with 3n+1. Return the steps to reach 1; return -1 for non-positive input.'
    ),
    difficulty: 'medium',
    topics: ['dynamic-programming'],
    parameters: [{ name: 'value', type: 'number' }],
    returnType: 'number',
    tests: [
      { id: 'collatz-1', args: [1], expected: 0, isSample: true },
      { id: 'collatz-2', args: [12], expected: 9, isSample: true },
      { id: 'collatz-3', args: [19], expected: 20, isSample: false },
      { id: 'collatz-4', args: [0], expected: -1, isSample: false },
    ],
    constraints: [text('0 <= value <= 1000000。', '0 <= value <= 1000000.')],
    hints: {
      zh: [
        '每轮只需要当前值。',
        '按奇偶选择更新规则。',
        '循环到 1，并在每次更新后增加步数。',
      ],
      en: [
        'Only the current value is needed.',
        'Choose the update rule by parity.',
        'Loop until 1 and increment after every update.',
      ],
    },
    reviewPoints: [
      text(
        '循环不变量是步数对应已执行的变换数。',
        'The loop invariant ties the count to completed transformations.'
      ),
    ],
    estimatedMinutes: 18,
  }),
  defineExercise({
    id: 'ex-016',
    externalId: 'armstrong-numbers',
    statementFile: 'description.md',
    slug: 'exercism-armstrong-number',
    entryPoint: 'isArmstrongNumber',
    title: text('阿姆斯特朗数', 'Armstrong Number'),
    description: text(
      '判断非负整数是否等于其每一位数字的“位数次幂”之和。',
      'Determine whether a non-negative integer equals the sum of each digit raised to the number of digits.'
    ),
    difficulty: 'medium',
    topics: ['array-hash'],
    parameters: [{ name: 'value', type: 'number' }],
    returnType: 'boolean',
    tests: [
      { id: 'armstrong-1', args: [153], expected: true, isSample: true },
      { id: 'armstrong-2', args: [9474], expected: true, isSample: true },
      { id: 'armstrong-3', args: [9475], expected: false, isSample: false },
      { id: 'armstrong-4', args: [0], expected: true, isSample: false },
    ],
    constraints: [
      text('value 为非负安全整数。', 'value is a non-negative safe integer.'),
    ],
    hints: {
      zh: [
        '先取得所有十进制位。',
        '指数等于位数。',
        '计算各位幂之和并与原数比较。',
      ],
      en: [
        'Extract all decimal digits first.',
        'The exponent equals the digit count.',
        'Sum digit powers and compare with the original.',
      ],
    },
    reviewPoints: [
      text(
        '字符串形式便于稳定拆分数字位。',
        'String form makes digit extraction straightforward.'
      ),
    ],
    estimatedMinutes: 16,
  }),
  defineExercise({
    id: 'ex-017',
    externalId: 'perfect-numbers',
    statementFile: 'description.md',
    slug: 'exercism-number-classification',
    entryPoint: 'classifyNumber',
    title: text('按真因子和分类', 'Classify by Aliquot Sum'),
    description: text(
      '根据所有小于自身的正因子之和，将正整数分类为 perfect、abundant 或 deficient；非正数返回 invalid。',
      'Classify a positive integer as perfect, abundant, or deficient by the sum of its positive factors below itself; return invalid for non-positive input.'
    ),
    difficulty: 'medium',
    topics: ['two-pointers'],
    parameters: [{ name: 'value', type: 'number' }],
    returnType: 'string',
    tests: [
      { id: 'perfect-1', args: [6], expected: 'perfect', isSample: true },
      { id: 'perfect-2', args: [12], expected: 'abundant', isSample: true },
      { id: 'perfect-3', args: [8], expected: 'deficient', isSample: false },
      { id: 'perfect-4', args: [0], expected: 'invalid', isSample: false },
    ],
    constraints: [text('value 不超过 1000000。', 'value is at most 1000000.')],
    hints: {
      zh: [
        '1 是大多数正整数的真因子。',
        '因子通常成对出现。',
        '枚举到平方根并避免重复加入平方根。',
      ],
      en: [
        '1 is a proper factor of most positive integers.',
        'Factors usually occur in pairs.',
        'Scan to the square root and avoid adding it twice.',
      ],
    },
    reviewPoints: [
      text(
        '平方根边界把枚举降到 O(√n)。',
        'The square-root bound reduces enumeration to O(√n).'
      ),
    ],
    estimatedMinutes: 22,
  }),
  defineExercise({
    id: 'ex-018',
    externalId: 'allergies',
    statementFile: 'description.md',
    slug: 'exercism-allergy-list',
    entryPoint: 'allergyList',
    title: text('过敏原位掩码', 'Allergen Bit Mask'),
    description: text(
      '分数的低八位依次代表 eggs、peanuts、shellfish、strawberries、tomatoes、chocolate、pollen、cats，返回被设置项。',
      'The low eight bits represent eggs, peanuts, shellfish, strawberries, tomatoes, chocolate, pollen, and cats in order. Return the selected items.'
    ),
    difficulty: 'medium',
    topics: ['array-hash'],
    parameters: [{ name: 'score', type: 'number' }],
    returnType: 'string[]',
    tests: [
      { id: 'allergy-1', args: [0], expected: [], isSample: true },
      {
        id: 'allergy-2',
        args: [3],
        expected: ['eggs', 'peanuts'],
        isSample: true,
      },
      {
        id: 'allergy-3',
        args: [255],
        expected: [
          'eggs',
          'peanuts',
          'shellfish',
          'strawberries',
          'tomatoes',
          'chocolate',
          'pollen',
          'cats',
        ],
        isSample: false,
      },
      { id: 'allergy-4', args: [257], expected: ['eggs'], isSample: false },
    ],
    constraints: [
      text('score 为非负整数。', 'score is a non-negative integer.'),
    ],
    hints: {
      zh: [
        '只需要低八位。',
        '每一项对应一个二进制位。',
        '按固定顺序检查 score & (1 << index)。',
      ],
      en: [
        'Only the low eight bits matter.',
        'Each item corresponds to one bit.',
        'Check score & (1 << index) in fixed order.',
      ],
    },
    reviewPoints: [
      text(
        '位掩码可以紧凑表达布尔集合。',
        'A bit mask compactly represents a set of booleans.'
      ),
    ],
    estimatedMinutes: 18,
  }),
  defineExercise({
    id: 'ex-019',
    externalId: 'resistor-color',
    statementFile: 'description.md',
    slug: 'exercism-resistor-color',
    entryPoint: 'resistorColorValue',
    title: text('电阻色环数值', 'Resistor Color Value'),
    description: text(
      '将 black、brown、red、orange、yellow、green、blue、violet、grey、white 映射为 0 到 9；未知颜色返回 -1。',
      'Map black, brown, red, orange, yellow, green, blue, violet, grey, and white to 0 through 9; return -1 for an unknown color.'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    parameters: [{ name: 'color', type: 'string' }],
    returnType: 'number',
    tests: [
      { id: 'resistor-1', args: ['black'], expected: 0, isSample: true },
      { id: 'resistor-2', args: ['white'], expected: 9, isSample: true },
      { id: 'resistor-3', args: ['blue'], expected: 6, isSample: false },
      { id: 'resistor-4', args: ['cyan'], expected: -1, isSample: false },
    ],
    constraints: [
      text('颜色名称使用小写英文。', 'Color names use lowercase English.'),
    ],
    hints: {
      zh: [
        '顺序就是数值。',
        '把颜色按规则放入数组。',
        '返回颜色的下标，找不到时自然为 -1。',
      ],
      en: [
        'The order is the value.',
        'Place colors in rule order in an array.',
        'Return the color index; a missing color naturally yields -1.',
      ],
    },
    reviewPoints: [
      text(
        '有序常量表能直接编码连续编号。',
        'An ordered constant table directly encodes consecutive values.'
      ),
    ],
    estimatedMinutes: 10,
  }),
  defineExercise({
    id: 'ex-020',
    externalId: 'difference-of-squares',
    statementFile: 'description.md',
    slug: 'exercism-difference-of-squares',
    entryPoint: 'differenceOfSquares',
    title: text('平方和之差', 'Difference of Squares'),
    description: text(
      '返回前 n 个正整数之和的平方与这些整数平方之和的差。',
      'Return the difference between the square of the sum of the first n positive integers and the sum of their squares.'
    ),
    difficulty: 'easy',
    topics: ['dynamic-programming'],
    parameters: [{ name: 'n', type: 'number' }],
    returnType: 'number',
    tests: [
      { id: 'squares-1', args: [1], expected: 0, isSample: true },
      { id: 'squares-2', args: [5], expected: 170, isSample: true },
      { id: 'squares-3', args: [10], expected: 2640, isSample: false },
      { id: 'squares-4', args: [100], expected: 25164150, isSample: false },
    ],
    constraints: [text('1 <= n <= 10000。', '1 <= n <= 10000.')],
    hints: {
      zh: [
        '分别计算两个量。',
        '前 n 项和为 n(n+1)/2。',
        '平方和为 n(n+1)(2n+1)/6，再相减。',
      ],
      en: [
        'Calculate the two quantities separately.',
        'The first n sum is n(n+1)/2.',
        'The square sum is n(n+1)(2n+1)/6; subtract it.',
      ],
    },
    reviewPoints: [
      text(
        '闭式公式把循环降为常数时间。',
        'Closed-form formulas reduce a loop to constant time.'
      ),
    ],
    estimatedMinutes: 12,
  }),
];

export const curatedExercismProblemByExternalId = new Map(
  curatedExercismProblems.map((problem) => [problem.origin.externalId, problem])
);

export function cloneCatalogValue<T extends CatalogJsonValue>(value: T): T {
  return structuredClone(value);
}
