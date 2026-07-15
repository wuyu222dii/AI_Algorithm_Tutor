import { LANGUAGE_REGISTRY } from '../languages';
import type {
  Difficulty,
  JsonValue,
  LocalizedText,
  Problem,
  ProblemLanguageConfig,
  ProblemTopic,
  TypeSpec,
} from '../types';

type Pair = [zh: string, en: string];

interface ParameterDefinition {
  name: string;
  type: TypeSpec;
  typeScriptType: string;
}

interface P1ProblemSeed {
  number: number;
  slug: string;
  title: Pair;
  description: Pair;
  difficulty: Difficulty;
  topic: ProblemTopic;
  entryPoint: string;
  parameters: ParameterDefinition[];
  returns: TypeSpec;
  typeScriptReturnType: string;
  tests: Array<{ args: JsonValue[]; expected: JsonValue }>;
  constraints: Pair[];
  hints: [Pair, Pair, Pair];
  reviewPoints: Pair[];
  estimatedMinutes: number;
  learningObjectives: Pair[];
  prerequisiteTopics: ProblemTopic[];
  solutionPatterns: string[];
}

export interface P1LearningProblem extends Problem {
  learningObjectives: LocalizedText[];
  prerequisiteTopics: ProblemTopic[];
  solutionPatterns: string[];
}

const INTEGER: TypeSpec = { kind: 'integer' };
const STRING: TypeSpec = { kind: 'string' };
const INTEGER_ARRAY: TypeSpec = { kind: 'array', items: INTEGER };
const INTEGER_GRID: TypeSpec = { kind: 'array', items: INTEGER_ARRAY };

const parameter = (
  name: string,
  type: TypeSpec,
  typeScriptType: string
): ParameterDefinition => ({ name, type, typeScriptType });

const text = ([zh, en]: Pair): LocalizedText => ({ zh, en });

const toSnakeCase = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

function buildLanguageConfigs(
  seed: P1ProblemSeed
): P1LearningProblem['languageConfigs'] {
  const parameterNames = seed.parameters.map(({ name }) => name).join(', ');
  const typedParameters = seed.parameters
    .map(({ name, typeScriptType }) => `${name}: ${typeScriptType}`)
    .join(', ');
  const signature = {
    parameters: seed.parameters.map(({ name, type }) => ({ name, type })),
    returns: seed.returns,
  };
  const configs: Record<
    'javascript' | 'python' | 'typescript',
    ProblemLanguageConfig
  > = {
    javascript: {
      entryPoint: seed.entryPoint,
      template: `function ${seed.entryPoint}(${parameterNames}) {\n  // TODO: implement your solution.\n}`,
      signature,
      monacoId: LANGUAGE_REGISTRY.javascript.monacoId,
      runner: LANGUAGE_REGISTRY.javascript.runner,
      runtimeVersion: LANGUAGE_REGISTRY.javascript.runtimeVersion,
    },
    python: {
      entryPoint: toSnakeCase(seed.entryPoint),
      template: `def ${toSnakeCase(seed.entryPoint)}(${parameterNames}):\n    # TODO: implement your solution.\n    pass`,
      signature,
      monacoId: LANGUAGE_REGISTRY.python.monacoId,
      runner: LANGUAGE_REGISTRY.python.runner,
      runtimeVersion: LANGUAGE_REGISTRY.python.runtimeVersion,
    },
    typescript: {
      entryPoint: seed.entryPoint,
      template: `function ${seed.entryPoint}(${typedParameters}): ${seed.typeScriptReturnType} {\n  // TODO: implement your solution.\n  throw new Error('Not implemented');\n}`,
      signature,
      monacoId: LANGUAGE_REGISTRY.typescript.monacoId,
      runner: LANGUAGE_REGISTRY.typescript.runner,
      runtimeVersion: LANGUAGE_REGISTRY.typescript.runtimeVersion,
    },
  };

  return configs;
}

function buildProblem(seed: P1ProblemSeed): P1LearningProblem {
  const id = `p1-${String(seed.number).padStart(3, '0')}`;
  const tests = seed.tests.map((test, index) => ({
    id: `${id}-test-${index + 1}`,
    ...test,
    isSample: index === 0,
  }));
  const sample = tests[0];

  return {
    id,
    slug: seed.slug,
    title: text(seed.title),
    description: text(seed.description),
    difficulty: seed.difficulty,
    topics: [seed.topic],
    languageConfigs: buildLanguageConfigs(seed),
    signature: {
      parameters: seed.parameters.map(({ name, type }) => ({ name, type })),
      returns: seed.returns,
    },
    version: { contentVersion: 1, catalogVersion: 'p1-learning-v1' },
    tests,
    examples: sample
      ? [
          {
            id: `${id}-example`,
            input: sample.args.length === 1 ? sample.args[0] : sample.args,
            expected: sample.expected,
          },
        ]
      : [],
    constraints: seed.constraints.map(text),
    hints: {
      zh: seed.hints.map(([zh]) => zh) as [string, string, string],
      en: seed.hints.map(([, en]) => en) as [string, string, string],
    },
    reviewPoints: seed.reviewPoints.map(text),
    estimatedMinutes: seed.estimatedMinutes,
    learningObjectives: seed.learningObjectives.map(text),
    prerequisiteTopics: seed.prerequisiteTopics,
    solutionPatterns: seed.solutionPatterns,
  };
}

const seeds: P1ProblemSeed[] = [
  {
    number: 1,
    slug: 'first-index-at-least',
    title: ['第一个不小于目标的位置', 'First Position At Least the Target'],
    description: [
      '给定非递减整数数组和目标值，返回第一个大于或等于目标值的下标；若不存在则返回 -1。',
      'Given a non-decreasing integer array and a target, return the first index whose value is at least the target, or -1 if none exists.',
    ],
    difficulty: 'easy',
    topic: 'binary-search',
    entryPoint: 'firstIndexAtLeast',
    parameters: [
      parameter('values', INTEGER_ARRAY, 'number[]'),
      parameter('target', INTEGER, 'number'),
    ],
    returns: INTEGER,
    typeScriptReturnType: 'number',
    tests: [
      { args: [[1, 3, 3, 7], 3], expected: 1 },
      { args: [[1, 3, 3, 7], 4], expected: 3 },
      { args: [[1, 3, 3, 7], 8], expected: -1 },
      { args: [[], 2], expected: -1 },
    ],
    constraints: [
      ['0 <= values.length <= 100000', '0 <= values.length <= 100000'],
      [
        'values 按非递减顺序排列。',
        'values is sorted in non-decreasing order.',
      ],
    ],
    hints: [
      [
        '答案左侧的值都小于 target。',
        'Every value to the left of the answer is below target.',
      ],
      [
        '维护一个可能包含答案的半开区间。',
        'Maintain a half-open interval that may contain the answer.',
      ],
      [
        '当 values[mid] >= target 时收缩右边界，否则移动左边界。',
        'Shrink the right boundary when values[mid] >= target; otherwise move the left boundary.',
      ],
    ],
    reviewPoints: [
      [
        '明确搜索区间的开闭规则。',
        'State the open/closed convention of the search interval.',
      ],
      [
        '重复值要求寻找左边界。',
        'Duplicates require locating the left boundary.',
      ],
    ],
    estimatedMinutes: 14,
    learningObjectives: [
      [
        '掌握二分查找左边界模板。',
        'Master the left-boundary binary-search pattern.',
      ],
    ],
    prerequisiteTopics: ['binary-search'],
    solutionPatterns: ['lower-bound'],
  },
  {
    number: 2,
    slug: 'last-index-at-most',
    title: ['最后一个不大于目标的位置', 'Last Position At Most the Target'],
    description: [
      '给定非递减整数数组和目标值，返回最后一个小于或等于目标值的下标；若不存在则返回 -1。',
      'Given a non-decreasing integer array and a target, return the last index whose value is at most the target, or -1 if none exists.',
    ],
    difficulty: 'easy',
    topic: 'binary-search',
    entryPoint: 'lastIndexAtMost',
    parameters: [
      parameter('values', INTEGER_ARRAY, 'number[]'),
      parameter('target', INTEGER, 'number'),
    ],
    returns: INTEGER,
    typeScriptReturnType: 'number',
    tests: [
      { args: [[1, 3, 3, 7], 3], expected: 2 },
      { args: [[1, 3, 3, 7], 6], expected: 2 },
      { args: [[1, 3, 3, 7], 0], expected: -1 },
      { args: [[5], 5], expected: 0 },
    ],
    constraints: [
      ['0 <= values.length <= 100000', '0 <= values.length <= 100000'],
      [
        'values 按非递减顺序排列。',
        'values is sorted in non-decreasing order.',
      ],
    ],
    hints: [
      [
        '将问题看成寻找第一个大于 target 的位置。',
        'View the task as finding the first value greater than target.',
      ],
      [
        '找到右侧边界后，答案在它的前一个位置。',
        'After finding the right boundary, the answer is one position before it.',
      ],
      [
        'values[mid] <= target 时继续向右搜索，否则收缩右边界。',
        'Continue right when values[mid] <= target; otherwise shrink the right boundary.',
      ],
    ],
    reviewPoints: [
      [
        '右边界查找要正确处理重复值。',
        'Right-boundary search must handle duplicates correctly.',
      ],
      [
        '空数组和无可行值都返回 -1。',
        'Empty input and no feasible value both return -1.',
      ],
    ],
    estimatedMinutes: 14,
    learningObjectives: [
      [
        '区分左边界与右边界二分。',
        'Distinguish left- and right-boundary searches.',
      ],
    ],
    prerequisiteTopics: ['binary-search'],
    solutionPatterns: ['upper-bound'],
  },
  {
    number: 3,
    slug: 'maximize-router-spacing',
    title: ['最大化路由器间距', 'Maximize Router Spacing'],
    description: [
      '给定严格递增的位置数组和需要放置的路由器数量，返回任意两台相邻路由器之间可达到的最大最小距离。',
      'Given strictly increasing positions and a router count, return the largest achievable minimum distance between adjacent placed routers.',
    ],
    difficulty: 'medium',
    topic: 'binary-search',
    entryPoint: 'maximizeRouterSpacing',
    parameters: [
      parameter('positions', INTEGER_ARRAY, 'number[]'),
      parameter('routers', INTEGER, 'number'),
    ],
    returns: INTEGER,
    typeScriptReturnType: 'number',
    tests: [
      { args: [[1, 2, 4, 8, 9], 3], expected: 3 },
      { args: [[0, 10], 2], expected: 10 },
      { args: [[1, 2, 3, 4, 5], 4], expected: 1 },
      { args: [[2, 7, 12, 17], 3], expected: 5 },
    ],
    constraints: [
      [
        '2 <= routers <= positions.length <= 100000',
        '2 <= routers <= positions.length <= 100000',
      ],
      ['positions 严格递增。', 'positions is strictly increasing.'],
    ],
    hints: [
      [
        '固定一个候选间距后，可以贪心判断能否放够路由器。',
        'For a fixed spacing, greedily test whether enough routers fit.',
      ],
      [
        '可行性会随候选间距增大而单调下降。',
        'Feasibility decreases monotonically as the candidate spacing grows.',
      ],
      [
        '二分距离；每次从首个位置开始，尽早放置下一台路由器。',
        'Binary-search the distance; start at the first position and place each next router as early as possible.',
      ],
    ],
    reviewPoints: [
      [
        '答案二分需要单调判定函数。',
        'Binary search on the answer needs a monotone predicate.',
      ],
      [
        '贪心判定只需线性扫描。',
        'The greedy feasibility check needs one linear scan.',
      ],
    ],
    estimatedMinutes: 26,
    learningObjectives: [
      [
        '识别答案空间上的单调性。',
        'Recognize monotonicity over an answer space.',
      ],
    ],
    prerequisiteTopics: ['binary-search'],
    solutionPatterns: ['binary-search-on-answer'],
  },
  {
    number: 4,
    slug: 'minimum-capacity-for-days',
    title: ['限定天数内的最小运载量', 'Minimum Capacity Within a Day Limit'],
    description: [
      '货物必须按给定顺序运输，每天装载连续的一段且总重量不超过容量。返回在 days 天内运完的最小整数容量。',
      'Packages must be shipped in order; each day takes one contiguous segment whose total weight does not exceed capacity. Return the minimum integer capacity that finishes within days.',
    ],
    difficulty: 'medium',
    topic: 'binary-search',
    entryPoint: 'minimumCapacityForDays',
    parameters: [
      parameter('weights', INTEGER_ARRAY, 'number[]'),
      parameter('days', INTEGER, 'number'),
    ],
    returns: INTEGER,
    typeScriptReturnType: 'number',
    tests: [
      { args: [[1, 2, 3, 1, 1], 4], expected: 3 },
      { args: [[3, 2, 2, 4, 1, 4], 3], expected: 6 },
      { args: [[5], 1], expected: 5 },
      { args: [[1, 2, 3, 4, 5], 1], expected: 15 },
    ],
    constraints: [
      ['1 <= weights.length <= 100000', '1 <= weights.length <= 100000'],
      [
        '1 <= days <= weights.length，重量均为正整数。',
        '1 <= days <= weights.length, and every weight is positive.',
      ],
    ],
    hints: [
      [
        '容量至少是最大单件重量，至多是总重量。',
        'Capacity is at least the heaviest package and at most the total weight.',
      ],
      [
        '固定容量后，按顺序装载可以计算所需最少天数。',
        'For fixed capacity, sequential loading gives the minimum days needed.',
      ],
      [
        '二分容量；模拟装载所需天数不超过 days 时收缩右边界。',
        'Binary-search capacity; shrink right when simulated days do not exceed days.',
      ],
    ],
    reviewPoints: [
      [
        '搜索上下界直接来自问题约束。',
        'Search bounds follow directly from the constraints.',
      ],
      [
        '判定过程不能改变货物顺序。',
        'The feasibility check must preserve package order.',
      ],
    ],
    estimatedMinutes: 28,
    learningObjectives: [
      [
        '把最小可行值问题转为二分查找。',
        'Transform a minimum-feasible-value task into binary search.',
      ],
    ],
    prerequisiteTopics: ['binary-search'],
    solutionPatterns: ['minimum-feasible-answer'],
  },
  {
    number: 5,
    slug: 'merge-linked-sequences',
    title: ['合并两个有序链表序列', 'Merge Two Sorted Linked Sequences'],
    description: [
      '两个数组按链表从头到尾的节点顺序表示两个非递减单链表。返回合并后链表的节点值顺序，不修改输入。',
      'Two arrays encode node values from head to tail for non-decreasing singly linked lists. Return the merged node order without modifying the inputs.',
    ],
    difficulty: 'easy',
    topic: 'linked-list',
    entryPoint: 'mergeLinkedSequences',
    parameters: [
      parameter('first', INTEGER_ARRAY, 'number[]'),
      parameter('second', INTEGER_ARRAY, 'number[]'),
    ],
    returns: INTEGER_ARRAY,
    typeScriptReturnType: 'number[]',
    tests: [
      {
        args: [
          [1, 3, 6],
          [2, 4, 5],
        ],
        expected: [1, 2, 3, 4, 5, 6],
      },
      { args: [[], [1, 2]], expected: [1, 2] },
      { args: [[1, 1], [1]], expected: [1, 1, 1] },
      { args: [[], []], expected: [] },
    ],
    constraints: [
      [
        '0 <= first.length + second.length <= 100000',
        '0 <= first.length + second.length <= 100000',
      ],
      [
        '两个序列均按非递减顺序排列。',
        'Both sequences are sorted in non-decreasing order.',
      ],
    ],
    hints: [
      ['比较两个当前头节点。', 'Compare the two current head nodes.'],
      [
        '较小节点接到结果尾部，并移动对应指针。',
        'Append the smaller node and advance its pointer.',
      ],
      [
        '重复比较直到一方为空，再接上另一方剩余节点。',
        'Repeat until one side is empty, then append the remaining nodes.',
      ],
    ],
    reviewPoints: [
      [
        '虚拟头节点可统一处理结果链表的首节点。',
        'A dummy head unifies handling of the result head.',
      ],
      ['每个节点只被访问一次。', 'Each node is visited once.'],
    ],
    estimatedMinutes: 16,
    learningObjectives: [
      [
        '理解双链表同步推进。',
        'Understand synchronized traversal of two lists.',
      ],
    ],
    prerequisiteTopics: ['linked-list', 'two-pointers'],
    solutionPatterns: ['two-list-merge'],
  },
  {
    number: 6,
    slug: 'remove-linked-target-values',
    title: ['删除链表中的目标值', 'Remove Target Values From a Linked List'],
    description: [
      '数组按单链表从头到尾的节点顺序表示链表。删除值等于 target 的所有节点并返回剩余节点顺序。',
      'An array encodes a singly linked list from head to tail. Remove every node whose value equals target and return the remaining node order.',
    ],
    difficulty: 'easy',
    topic: 'linked-list',
    entryPoint: 'removeLinkedTargetValues',
    parameters: [
      parameter('values', INTEGER_ARRAY, 'number[]'),
      parameter('target', INTEGER, 'number'),
    ],
    returns: INTEGER_ARRAY,
    typeScriptReturnType: 'number[]',
    tests: [
      { args: [[1, 2, 6, 3, 6], 6], expected: [1, 2, 3] },
      { args: [[7, 7, 7], 7], expected: [] },
      { args: [[1, 2, 3], 4], expected: [1, 2, 3] },
      { args: [[], 0], expected: [] },
    ],
    constraints: [
      ['0 <= values.length <= 100000', '0 <= values.length <= 100000'],
      [
        '节点值和 target 均为安全整数。',
        'Node values and target are safe integers.',
      ],
    ],
    hints: [
      ['头节点也可能需要删除。', 'The head node may also need removal.'],
      [
        '虚拟头节点可以让每次删除都有前驱节点。',
        'A dummy head gives every removed node a predecessor.',
      ],
      [
        '检查 next；命中就跳过，否则向前移动 current。',
        'Inspect next; bypass it on a match, otherwise advance current.',
      ],
    ],
    reviewPoints: [
      [
        '删除节点时不要提前移动前驱指针。',
        'Do not advance the predecessor too early when deleting.',
      ],
      [
        '虚拟头节点消除头部特判。',
        'A dummy head removes the head special case.',
      ],
    ],
    estimatedMinutes: 16,
    learningObjectives: [
      [
        '掌握链表删除中的前驱维护。',
        'Maintain predecessors during linked-list deletion.',
      ],
    ],
    prerequisiteTopics: ['linked-list'],
    solutionPatterns: ['dummy-head'],
  },
  {
    number: 7,
    slug: 'reverse-linked-range',
    title: ['反转链表指定区间', 'Reverse a Linked-List Range'],
    description: [
      '数组按单链表节点顺序表示链表。将从 left 到 right 的节点区间原地反转并返回最终节点顺序，位置从 1 开始。',
      'An array encodes linked-list node order. Reverse positions left through right in place and return the final node order; positions are one-based.',
    ],
    difficulty: 'medium',
    topic: 'linked-list',
    entryPoint: 'reverseLinkedRange',
    parameters: [
      parameter('values', INTEGER_ARRAY, 'number[]'),
      parameter('left', INTEGER, 'number'),
      parameter('right', INTEGER, 'number'),
    ],
    returns: INTEGER_ARRAY,
    typeScriptReturnType: 'number[]',
    tests: [
      { args: [[1, 2, 3, 4, 5], 2, 4], expected: [1, 4, 3, 2, 5] },
      { args: [[1, 2], 1, 2], expected: [2, 1] },
      { args: [[7], 1, 1], expected: [7] },
      { args: [[1, 2, 3], 2, 2], expected: [1, 2, 3] },
    ],
    constraints: [
      [
        '1 <= left <= right <= values.length <= 100000',
        '1 <= left <= right <= values.length <= 100000',
      ],
      ['位置从 1 开始计数。', 'Positions are one-based.'],
    ],
    hints: [
      [
        '先找到反转区间前的节点。',
        'First find the node before the reversed range.',
      ],
      [
        '区间内可以逐个把后继节点移到区间头部。',
        'Within the range, repeatedly move the next node to the front.',
      ],
      [
        '使用虚拟头节点；执行 right-left 次头插操作。',
        'Use a dummy head and perform right-left front-insertion steps.',
      ],
    ],
    reviewPoints: [
      [
        '保存区间前驱和区间尾部的连接。',
        'Preserve connections before and after the range.',
      ],
      ['left=1 时虚拟头节点仍然适用。', 'The dummy head also handles left=1.'],
    ],
    estimatedMinutes: 24,
    learningObjectives: [
      [
        '完成局部链表反转并保持外部连接。',
        'Reverse a local list segment while preserving outer links.',
      ],
    ],
    prerequisiteTopics: ['linked-list'],
    solutionPatterns: ['in-place-sublist-reversal'],
  },
  {
    number: 8,
    slug: 'reorder-linked-ends',
    title: ['首尾交替重排链表', 'Reorder a Linked List From Both Ends'],
    description: [
      '数组按链表节点顺序表示 L0→L1→…→Ln。返回 L0→Ln→L1→Ln-1→… 的节点顺序。',
      'An array encodes L0→L1→…→Ln. Return the node order L0→Ln→L1→Ln-1→….',
    ],
    difficulty: 'medium',
    topic: 'linked-list',
    entryPoint: 'reorderLinkedEnds',
    parameters: [parameter('values', INTEGER_ARRAY, 'number[]')],
    returns: INTEGER_ARRAY,
    typeScriptReturnType: 'number[]',
    tests: [
      { args: [[1, 2, 3, 4]], expected: [1, 4, 2, 3] },
      { args: [[1, 2, 3, 4, 5]], expected: [1, 5, 2, 4, 3] },
      { args: [[]], expected: [] },
      { args: [[7]], expected: [7] },
    ],
    constraints: [
      ['0 <= values.length <= 100000', '0 <= values.length <= 100000'],
    ],
    hints: [
      [
        '目标顺序交替取自前半段与反向后半段。',
        'The target alternates between the first half and the reversed second half.',
      ],
      [
        '先用快慢指针找到中点，再反转后半段。',
        'Use fast/slow pointers to find the middle, then reverse the second half.',
      ],
      [
        '断开两段，将 first 和 reversedSecond 交替合并。',
        'Split the list and alternately merge first with reversedSecond.',
      ],
    ],
    reviewPoints: [
      [
        '先断开链表可避免合并时形成环。',
        'Splitting first prevents a cycle during merging.',
      ],
      [
        '奇数长度时前半段多一个节点。',
        'For odd length, the first half owns one extra node.',
      ],
    ],
    estimatedMinutes: 28,
    learningObjectives: [
      [
        '组合中点查找、反转与归并。',
        'Combine midpoint search, reversal, and merging.',
      ],
    ],
    prerequisiteTopics: ['linked-list', 'two-pointers'],
    solutionPatterns: ['split-reverse-merge'],
  },
  {
    number: 9,
    slug: 'simplify-absolute-path',
    title: ['简化绝对路径', 'Simplify an Absolute Path'],
    description: [
      '给定 Unix 风格绝对路径，解析重复斜杠、当前目录 . 和父目录 ..，返回规范路径。根目录的父目录仍是根目录。',
      'Given a Unix-style absolute path, resolve repeated slashes, current-directory ., and parent-directory .. components. The parent of root remains root.',
    ],
    difficulty: 'medium',
    topic: 'stack',
    entryPoint: 'simplifyAbsolutePath',
    parameters: [parameter('path', STRING, 'string')],
    returns: STRING,
    typeScriptReturnType: 'string',
    tests: [
      { args: ['/home//foo/'], expected: '/home/foo' },
      { args: ['/a/./b/../../c/'], expected: '/c' },
      { args: ['/../'], expected: '/' },
      { args: ['/a/../../b/../c//.//'], expected: '/c' },
    ],
    constraints: [
      ['1 <= path.length <= 100000', '1 <= path.length <= 100000'],
      ['path 以 / 开头。', 'path starts with /.'],
    ],
    hints: [
      [
        '按斜杠拆分后逐个处理路径段。',
        'Split on slashes and process one component at a time.',
      ],
      [
        '普通目录入栈，.. 弹出，空段和 . 忽略。',
        'Push normal names, pop for .., and ignore empty or . components.',
      ],
      [
        '最终用 / 连接栈内容并补上开头的 /。',
        'Join the stack with / and prepend the root slash.',
      ],
    ],
    reviewPoints: [
      [
        '栈表示当前规范路径的目录层级。',
        'The stack represents the current canonical directory hierarchy.',
      ],
      ['根目录不能继续向上弹出。', 'Root cannot be popped further.'],
    ],
    estimatedMinutes: 20,
    learningObjectives: [
      [
        '使用栈解释嵌套导航语义。',
        'Use a stack to interpret hierarchical navigation.',
      ],
    ],
    prerequisiteTopics: ['stack'],
    solutionPatterns: ['component-stack'],
  },
  {
    number: 10,
    slug: 'asteroid-line-collisions',
    title: ['直线小行星碰撞', 'Asteroid Collisions on a Line'],
    description: [
      '整数绝对值表示小行星大小，正负号表示向右或向左。相向时较小者消失，相同则都消失。返回所有碰撞结束后的顺序。',
      'An integer magnitude is asteroid size and its sign is direction. On a head-on collision the smaller disappears, or both disappear when equal. Return the final order.',
    ],
    difficulty: 'medium',
    topic: 'stack',
    entryPoint: 'resolveAsteroidCollisions',
    parameters: [parameter('asteroids', INTEGER_ARRAY, 'number[]')],
    returns: INTEGER_ARRAY,
    typeScriptReturnType: 'number[]',
    tests: [
      { args: [[5, 10, -5]], expected: [5, 10] },
      { args: [[8, -8]], expected: [] },
      { args: [[10, 2, -5]], expected: [10] },
      { args: [[-2, -1, 1, 2]], expected: [-2, -1, 1, 2] },
    ],
    constraints: [
      ['0 <= asteroids.length <= 100000', '0 <= asteroids.length <= 100000'],
      [
        '每个值非 0 且绝对值不超过 100000。',
        'Each value is non-zero with magnitude at most 100000.',
      ],
    ],
    hints: [
      [
        '只有栈顶向右且当前小行星向左时会碰撞。',
        'A collision occurs only when the stack top moves right and the current asteroid moves left.',
      ],
      [
        '当前小行星可能连续击毁多个栈顶。',
        'The current asteroid may destroy several stack tops.',
      ],
      [
        '循环比较大小：栈顶小则弹出，相等则双方消失，栈顶大则当前消失。',
        'Compare in a loop: pop a smaller top, remove both if equal, or remove the current one if the top is larger.',
      ],
    ],
    reviewPoints: [
      [
        '栈保存尚未确定最终命运的小行星。',
        'The stack stores asteroids whose final fate is not yet known.',
      ],
      [
        '一次输入可能触发多次碰撞。',
        'One input asteroid may trigger multiple collisions.',
      ],
    ],
    estimatedMinutes: 24,
    learningObjectives: [
      [
        '建模需要反复消解的相邻冲突。',
        'Model adjacent conflicts that may resolve repeatedly.',
      ],
    ],
    prerequisiteTopics: ['stack'],
    solutionPatterns: ['collision-stack'],
  },
  {
    number: 11,
    slug: 'decode-repeat-blocks',
    title: ['解码重复块', 'Decode Repeated Blocks'],
    description: [
      '字符串由小写字母、正整数和方括号组成，k[segment] 表示 segment 重复 k 次，结构可以嵌套。返回解码结果。',
      'A string contains lowercase letters, positive integers, and brackets; k[segment] repeats segment k times, and blocks may nest. Return the decoded string.',
    ],
    difficulty: 'medium',
    topic: 'stack',
    entryPoint: 'decodeRepeatBlocks',
    parameters: [parameter('encoded', STRING, 'string')],
    returns: STRING,
    typeScriptReturnType: 'string',
    tests: [
      { args: ['3[a]2[bc]'], expected: 'aaabcbc' },
      { args: ['3[a2[c]]'], expected: 'accaccacc' },
      { args: ['2[abc]3[cd]ef'], expected: 'abcabccdcdcdef' },
      { args: ['10[z]'], expected: 'zzzzzzzzzz' },
    ],
    constraints: [
      ['1 <= encoded.length <= 30000', '1 <= encoded.length <= 30000'],
      [
        '输入合法，解码结果长度不超过 100000。',
        'The input is valid and decoded length is at most 100000.',
      ],
    ],
    hints: [
      [
        '进入新括号层时需要保存外层状态。',
        'Entering a bracket requires saving the outer state.',
      ],
      [
        '分别保存重复次数和括号前已构造的字符串。',
        'Store both the repeat count and the string built before the bracket.',
      ],
      [
        '遇 ] 时弹出外层字符串与次数，拼接 outer + current.repeat(k)。',
        'At ], pop the outer string and count, then combine outer + current.repeat(k).',
      ],
    ],
    reviewPoints: [
      [
        '多位重复次数需要连续解析数字。',
        'Multi-digit repeat counts require accumulating consecutive digits.',
      ],
      [
        '栈帧对应一层嵌套上下文。',
        'Each stack frame represents one nesting context.',
      ],
    ],
    estimatedMinutes: 25,
    learningObjectives: [
      [
        '用栈保存嵌套解析上下文。',
        'Use a stack to preserve nested parsing contexts.',
      ],
    ],
    prerequisiteTopics: ['stack'],
    solutionPatterns: ['nested-context-stack'],
  },
  {
    number: 12,
    slug: 'minimum-balanced-partition-difference',
    title: [
      '两组平衡划分的最小差',
      'Minimum Difference of a Balanced Partition',
    ],
    description: [
      '将非负整数数组的每个元素恰好分到两组之一，返回两组元素和之差的最小绝对值。',
      'Assign every non-negative integer to exactly one of two groups and return the minimum absolute difference between their sums.',
    ],
    difficulty: 'hard',
    topic: 'dynamic-programming',
    entryPoint: 'minimumPartitionDifference',
    parameters: [parameter('values', INTEGER_ARRAY, 'number[]')],
    returns: INTEGER,
    typeScriptReturnType: 'number',
    tests: [
      { args: [[1, 6, 11, 5]], expected: 1 },
      { args: [[3, 1, 4, 2, 2]], expected: 0 },
      { args: [[]], expected: 0 },
      { args: [[7]], expected: 7 },
    ],
    constraints: [
      ['0 <= values.length <= 200', '0 <= values.length <= 200'],
      [
        '0 <= values[i] <= 100，元素总和不超过 20000。',
        '0 <= values[i] <= 100, and the total sum is at most 20000.',
      ],
    ],
    hints: [
      [
        '若一组的和接近总和的一半，两组差值就最小。',
        'The difference is minimized when one group sum is close to half the total.',
      ],
      [
        '记录使用前若干元素能够组成的所有和。',
        'Track every sum reachable using the processed prefix.',
      ],
      [
        '做 0/1 背包到 floor(total/2)，找到最大可达和 best，答案为 total-2*best。',
        'Run 0/1 knapsack up to floor(total/2); for maximum reachable best, return total-2*best.',
      ],
    ],
    reviewPoints: [
      [
        '每个元素只能使用一次，因此容量要逆序更新。',
        'Each item is used once, so capacity updates run backward.',
      ],
      ['只需搜索总和一半以内。', 'Only sums up to half the total are needed.'],
    ],
    estimatedMinutes: 38,
    learningObjectives: [
      [
        '把划分问题转化为 0/1 背包可达性。',
        'Reduce partitioning to 0/1-knapsack reachability.',
      ],
    ],
    prerequisiteTopics: ['dynamic-programming'],
    solutionPatterns: ['zero-one-knapsack'],
  },
  {
    number: 13,
    slug: 'count-target-sign-assignments',
    title: ['目标和符号分配计数', 'Count Sign Assignments for a Target Sum'],
    description: [
      '为每个非负整数分别添加 + 或 -，返回最终表达式结果等于 target 的不同符号分配数量。',
      'Assign either + or - to every non-negative integer and return the number of distinct assignments whose expression equals target.',
    ],
    difficulty: 'hard',
    topic: 'dynamic-programming',
    entryPoint: 'countTargetSignAssignments',
    parameters: [
      parameter('values', INTEGER_ARRAY, 'number[]'),
      parameter('target', INTEGER, 'number'),
    ],
    returns: INTEGER,
    typeScriptReturnType: 'number',
    tests: [
      { args: [[1, 1, 1, 1, 1], 3], expected: 5 },
      { args: [[1], 1], expected: 1 },
      { args: [[1], 2], expected: 0 },
      { args: [[0, 0, 1], 1], expected: 4 },
    ],
    constraints: [
      ['1 <= values.length <= 30', '1 <= values.length <= 30'],
      [
        '0 <= values[i] <= 1000，答案为安全整数。',
        '0 <= values[i] <= 1000, and the answer is a safe integer.',
      ],
    ],
    hints: [
      [
        '设正号元素之和为 P，负号元素之和为 N。',
        'Let P be the positive-sign sum and N the negative-sign sum.',
      ],
      [
        '由 P-N=target 与 P+N=total 推出 P=(total+target)/2。',
        'From P-N=target and P+N=total, derive P=(total+target)/2.',
      ],
      [
        '若目标子集和合法，用一维背包累计组成它的方案数；0 会自然使方案数翻倍。',
        'If the subset target is valid, use one-dimensional knapsack to count it; zeros naturally double the count.',
      ],
    ],
    reviewPoints: [
      [
        '先检查 total+target 的非负性和奇偶性。',
        'First check non-negativity and parity of total+target.',
      ],
      [
        '计数背包的初始状态是 dp[0]=1。',
        'Counting knapsack starts with dp[0]=1.',
      ],
    ],
    estimatedMinutes: 40,
    learningObjectives: [
      [
        '通过代数变换识别子集计数模型。',
        'Recognize subset counting through an algebraic transformation.',
      ],
    ],
    prerequisiteTopics: ['dynamic-programming'],
    solutionPatterns: ['counting-knapsack'],
  },
  {
    number: 14,
    slug: 'minimum-obstacle-removals',
    title: ['网格最少移除障碍', 'Minimum Obstacle Removals in a Grid'],
    description: [
      '在 0/1 网格中从左上角四方向移动到右下角，进入值为 1 的格子时需要移除一个障碍。返回最少移除数量。起点和终点均为 0。',
      'Move in four directions from the top-left to bottom-right of a 0/1 grid. Entering a cell valued 1 removes one obstacle. Return the minimum removals; start and finish are 0.',
    ],
    difficulty: 'hard',
    topic: 'bfs',
    entryPoint: 'minimumObstacleRemovals',
    parameters: [parameter('grid', INTEGER_GRID, 'number[][]')],
    returns: INTEGER,
    typeScriptReturnType: 'number',
    tests: [
      {
        args: [
          [
            [0, 1, 1],
            [1, 1, 0],
            [1, 1, 0],
          ],
        ],
        expected: 2,
      },
      {
        args: [
          [
            [0, 1, 0],
            [0, 1, 0],
            [0, 0, 0],
          ],
        ],
        expected: 0,
      },
      { args: [[[0]]], expected: 0 },
      {
        args: [
          [
            [0, 1, 1, 1],
            [0, 1, 0, 1],
            [0, 0, 0, 1],
            [1, 1, 0, 0],
          ],
        ],
        expected: 0,
      },
    ],
    constraints: [
      ['1 <= rows, columns <= 300', '1 <= rows, columns <= 300'],
      [
        'grid 为矩形且只含 0 和 1，起点与终点为 0。',
        'grid is rectangular and binary; start and finish are 0.',
      ],
    ],
    hints: [
      [
        '把进入空格子的代价看作 0，进入障碍的代价看作 1。',
        'Treat entering an empty cell as cost 0 and an obstacle as cost 1.',
      ],
      [
        '边权只有 0 和 1，可以用双端队列维护最短距离。',
        'With only 0/1 edge costs, a deque can maintain shortest distances.',
      ],
      [
        '松弛邻居：代价 0 放队首，代价 1 放队尾，并只接受更小距离。',
        'Relax neighbors: push cost-0 moves to the front and cost-1 moves to the back, accepting only shorter distances.',
      ],
    ],
    reviewPoints: [
      [
        '普通 BFS 不能直接处理不同边权。',
        'Plain BFS does not directly handle unequal edge weights.',
      ],
      [
        '0-1 BFS 的每个节点可能在更短路径出现时更新。',
        'In 0-1 BFS, a node may update when a shorter path appears.',
      ],
    ],
    estimatedMinutes: 42,
    learningObjectives: [
      [
        '掌握边权为 0/1 时的最短路径算法。',
        'Master shortest paths with binary edge weights.',
      ],
    ],
    prerequisiteTopics: ['bfs'],
    solutionPatterns: ['zero-one-bfs'],
  },
  {
    number: 15,
    slug: 'largest-island-after-one-flip',
    title: ['翻转一次后的最大岛屿', 'Largest Island After One Flip'],
    description: [
      '在 0/1 方形网格中，四方向相邻的 1 构成岛屿。最多把一个 0 改为 1，返回可得到的最大岛屿面积。',
      'In a square 0/1 grid, orthogonally adjacent 1s form islands. Change at most one 0 to 1 and return the largest possible island area.',
    ],
    difficulty: 'hard',
    topic: 'dfs',
    entryPoint: 'largestIslandAfterOneFlip',
    parameters: [parameter('grid', INTEGER_GRID, 'number[][]')],
    returns: INTEGER,
    typeScriptReturnType: 'number',
    tests: [
      {
        args: [
          [
            [1, 0],
            [0, 1],
          ],
        ],
        expected: 3,
      },
      {
        args: [
          [
            [1, 1],
            [1, 0],
          ],
        ],
        expected: 4,
      },
      {
        args: [
          [
            [1, 1],
            [1, 1],
          ],
        ],
        expected: 4,
      },
      {
        args: [
          [
            [0, 0],
            [0, 0],
          ],
        ],
        expected: 1,
      },
    ],
    constraints: [
      [
        '1 <= grid.length == grid[i].length <= 500',
        '1 <= grid.length == grid[i].length <= 500',
      ],
      ['grid 只含 0 和 1。', 'grid contains only 0 and 1.'],
    ],
    hints: [
      [
        '若对每个 0 都重新遍历岛屿会重复大量工作。',
        'Re-traversing islands for every zero repeats substantial work.',
      ],
      [
        '先为每个现有岛屿标记唯一编号并记录面积。',
        'First label every existing island with a unique id and record its area.',
      ],
      [
        '枚举每个 0，去重其四个邻居的岛屿编号，答案为 1 加这些面积之和。',
        'For each zero, deduplicate adjacent island ids; its candidate is 1 plus their areas.',
      ],
    ],
    reviewPoints: [
      [
        '合并相邻岛屿时必须按编号去重。',
        'Adjacent islands must be deduplicated by id before merging.',
      ],
      [
        '全为 1 的网格答案是整个网格面积。',
        'For an all-one grid, the answer is the full area.',
      ],
    ],
    estimatedMinutes: 45,
    learningObjectives: [
      [
        '通过连通分量预处理消除重复遍历。',
        'Precompute connected components to eliminate repeated traversal.',
      ],
    ],
    prerequisiteTopics: ['dfs'],
    solutionPatterns: ['component-labeling'],
  },
];

export const p1LearningProblems: P1LearningProblem[] = seeds.map(buildProblem);
