import type {
  Difficulty,
  JsonValue,
  LocalizedText,
  Problem,
  ProblemTopic,
} from '../types';

type Pair = [zh: string, en: string];
type Seed = {
  number: number;
  slug: string;
  title: Pair;
  description: Pair;
  difficulty: Difficulty;
  topics: ProblemTopic[];
  entryPoint: string;
  params: Pair;
  tests: Array<{ args: JsonValue[]; expected: JsonValue }>;
  constraints: Pair[];
  hints: [Pair, Pair, Pair];
  reviewPoints: [Pair, Pair];
  estimatedMinutes: number;
};

const text = ([zh, en]: Pair): LocalizedText => ({ zh, en });
const snake = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

function problem(seed: Seed): Problem {
  const id = `ac-${String(seed.number).padStart(3, '0')}`;
  const tests = seed.tests.map((test, index) => ({
    id: `${id}-test-${index + 1}`,
    ...test,
    isSample: index < 2,
  }));
  const firstTest = tests[0];
  return {
    id,
    slug: seed.slug,
    title: text(seed.title),
    description: text(seed.description),
    difficulty: seed.difficulty,
    topics: seed.topics,
    entryPoint: seed.entryPoint,
    templates: {
      javascript: `function ${seed.entryPoint}(${seed.params[1]}) {\n  // TODO: implement your solution.\n  \n}`,
      python: `def ${snake(seed.entryPoint)}(${seed.params[0]}):\n    # TODO: implement your solution.\n    pass`,
    },
    tests,
    examples: firstTest
      ? [
          {
            id: `${id}-example`,
            input:
              firstTest.args.length === 1 ? firstTest.args[0] : firstTest.args,
            expected: firstTest.expected,
          },
        ]
      : [],
    constraints: seed.constraints.map(text),
    hints: {
      zh: seed.hints.map((item) => item[0]) as [string, string, string],
      en: seed.hints.map((item) => item[1]) as [string, string, string],
    },
    reviewPoints: seed.reviewPoints.map(text),
    estimatedMinutes: seed.estimatedMinutes,
  };
}

const seeds: Seed[] = [
  {
    number: 9,
    slug: 'rotate-array-right',
    title: ['数组向右轮转', 'Rotate an Array Right'],
    description: [
      '将数组向右轮转 k 次并返回新数组；空数组保持为空。',
      'Return a new array rotated right by k positions; an empty array stays empty.',
    ],
    difficulty: 'easy',
    topics: ['array-hash'],
    entryPoint: 'rotateRight',
    params: ['values, k', 'values, k'],
    tests: [
      { args: [[1, 2, 3, 4, 5], 2], expected: [4, 5, 1, 2, 3] },
      { args: [[1, 2], 3], expected: [2, 1] },
      { args: [[], 4], expected: [] },
      { args: [[7], 0], expected: [7] },
    ],
    constraints: [
      ['0 <= values.length <= 100000', '0 <= values.length <= 100000'],
      ['k 为非负整数。', 'k is a non-negative integer.'],
    ],
    hints: [
      ['先把 k 缩小到数组长度范围内。', 'Reduce k to the array length first.'],
      ['轮转后的切分点位于 n-k。', 'The rotation split is at n-k.'],
      [
        '拼接末尾 k 项与前面的项。',
        'Concatenate the last k items with the prefix.',
      ],
    ],
    reviewPoints: [
      [
        '取模统一处理 k 大于数组长度。',
        'Modulo handles k larger than the array.',
      ],
      ['空数组必须避免对 0 取模。', 'Avoid modulo by zero for an empty array.'],
    ],
    estimatedMinutes: 12,
  },
  {
    number: 10,
    slug: 'most-frequent-value',
    title: ['出现次数最多的值', 'Most Frequent Value'],
    description: [
      '返回出现次数最多的整数；次数相同时返回较小值，空数组返回 null。',
      'Return the most frequent integer, breaking ties by the smaller value; return null for an empty array.',
    ],
    difficulty: 'easy',
    topics: ['array-hash'],
    entryPoint: 'mostFrequentValue',
    params: ['values', 'values'],
    tests: [
      { args: [[4, 1, 4, 2, 2, 4]], expected: 4 },
      { args: [[3, 2, 3, 2]], expected: 2 },
      { args: [[]], expected: null },
      { args: [[-1, -1, 0]], expected: -1 },
    ],
    constraints: [
      ['0 <= values.length <= 100000', '0 <= values.length <= 100000'],
      ['元素为安全整数。', 'Values are safe integers.'],
    ],
    hints: [
      ['先统计每个值的频次。', 'Count each value first.'],
      [
        '比较频次时同时处理较小值优先。',
        'Handle the smaller-value tie break while comparing.',
      ],
      [
        '遍历频次表并维护最佳值和最佳次数。',
        'Scan the frequency map while tracking the best value and count.',
      ],
    ],
    reviewPoints: [
      [
        '哈希表适合频次聚合。',
        'Hash maps are suited to frequency aggregation.',
      ],
      [
        '并列规则必须进入比较条件。',
        'Tie-breaking belongs in the comparison rule.',
      ],
    ],
    estimatedMinutes: 14,
  },
  {
    number: 11,
    slug: 'longest-unique-window',
    title: ['最长无重复窗口', 'Longest Unique Window'],
    description: [
      '返回字符串中不含重复字符的最长连续子串长度。',
      'Return the length of the longest contiguous substring without repeated characters.',
    ],
    difficulty: 'medium',
    topics: ['two-pointers', 'array-hash'],
    entryPoint: 'longestUniqueWindow',
    params: ['text', 'text'],
    tests: [
      { args: ['abcabcbb'], expected: 3 },
      { args: ['bbbbb'], expected: 1 },
      { args: [''], expected: 0 },
      { args: ['pwwkew'], expected: 3 },
    ],
    constraints: [['0 <= text.length <= 100000', '0 <= text.length <= 100000']],
    hints: [
      [
        '窗口中需要快速判断字符是否重复。',
        'The window needs fast duplicate detection.',
      ],
      [
        '右端扩展，重复时移动左端。',
        'Expand right and move left when a duplicate appears.',
      ],
      [
        '记录字符最近位置，left 跳到重复位置之后。',
        'Track last positions and jump left past a duplicate.',
      ],
    ],
    reviewPoints: [
      [
        '滑动窗口维护连续区间不变量。',
        'A sliding window maintains a contiguous-range invariant.',
      ],
      ['左指针只能向前。', 'The left pointer only moves forward.'],
    ],
    estimatedMinutes: 20,
  },
  {
    number: 12,
    slug: 'longest-balanced-binary-subarray',
    title: ['最长平衡二进制子数组', 'Longest Balanced Binary Subarray'],
    description: [
      '数组只含 0 和 1，返回 0 与 1 数量相同的最长连续子数组长度。',
      'For an array containing only 0 and 1, return the longest contiguous subarray with equal counts.',
    ],
    difficulty: 'medium',
    topics: ['array-hash'],
    entryPoint: 'longestBalancedSubarray',
    params: ['values', 'values'],
    tests: [
      { args: [[0, 1]], expected: 2 },
      { args: [[0, 1, 0]], expected: 2 },
      { args: [[]], expected: 0 },
      { args: [[0, 0, 1, 0, 1, 1]], expected: 6 },
    ],
    constraints: [
      ['0 <= values.length <= 100000', '0 <= values.length <= 100000'],
    ],
    hints: [
      [
        '把 0 看作 -1 后，问题有什么变化？',
        'What changes if 0 is treated as -1?',
      ],
      [
        '相同前缀和之间的区间和为 0。',
        'Equal prefix sums enclose a zero-sum range.',
      ],
      [
        '保存每个前缀和第一次出现的位置。',
        'Store the first index for every prefix sum.',
      ],
    ],
    reviewPoints: [
      [
        '前缀状态相同意味着中间变化抵消。',
        'Equal prefix states mean the middle changes cancel.',
      ],
      [
        '保留最早位置才能得到最长区间。',
        'Keep the earliest index for the longest range.',
      ],
    ],
    estimatedMinutes: 22,
  },
  {
    number: 13,
    slug: 'evaluate-postfix-expression',
    title: ['计算后缀表达式', 'Evaluate a Postfix Expression'],
    description: [
      '计算由整数和 +、-、*、/ 组成的合法后缀表达式，除法向 0 截断。',
      'Evaluate a valid postfix expression containing integers and +, -, *, /; division truncates toward zero.',
    ],
    difficulty: 'medium',
    topics: ['stack'],
    entryPoint: 'evaluatePostfix',
    params: ['tokens', 'tokens'],
    tests: [
      { args: [['2', '1', '+', '3', '*']], expected: 9 },
      { args: [['4', '13', '5', '/', '+']], expected: 6 },
      { args: [['5', '2', '-']], expected: 3 },
      { args: [['7']], expected: 7 },
    ],
    constraints: [
      [
        '表达式合法且结果为安全整数。',
        'The expression is valid and results are safe integers.',
      ],
    ],
    hints: [
      [
        '数字先保存，运算符消费最近两个值。',
        'Store numbers; an operator consumes the latest two values.',
      ],
      [
        '注意左右操作数的弹出顺序。',
        'Mind the pop order of left and right operands.',
      ],
      [
        '遇数字入栈；遇运算符弹出 right、left，计算后入栈。',
        'Push numbers; for an operator pop right then left, evaluate, and push.',
      ],
    ],
    reviewPoints: [
      [
        '栈自然表达后进先出的依赖。',
        'A stack models last-in-first-out dependencies.',
      ],
      [
        '非交换运算必须保持操作数顺序。',
        'Non-commutative operations require operand order.',
      ],
    ],
    estimatedMinutes: 20,
  },
  {
    number: 14,
    slug: 'next-warmer-distance',
    title: ['下一次更高温度', 'Distance to a Warmer Value'],
    description: [
      '对每个温度返回需要等待多少项才出现更高温度；不存在则为 0。',
      'For each temperature, return how many positions until a warmer value appears, or 0 if none does.',
    ],
    difficulty: 'medium',
    topics: ['stack'],
    entryPoint: 'nextWarmerDistance',
    params: ['temperatures', 'temperatures'],
    tests: [
      {
        args: [[73, 74, 75, 71, 69, 72, 76, 73]],
        expected: [1, 1, 4, 2, 1, 1, 0, 0],
      },
      { args: [[30, 40, 50, 60]], expected: [1, 1, 1, 0] },
      { args: [[60, 50]], expected: [0, 0] },
      { args: [[]], expected: [] },
    ],
    constraints: [
      [
        '0 <= temperatures.length <= 100000',
        '0 <= temperatures.length <= 100000',
      ],
    ],
    hints: [
      [
        '尚未找到答案的位置应如何保存？',
        'How should unresolved positions be stored?',
      ],
      [
        '维护温度单调不增的位置栈。',
        'Maintain a stack of positions with non-increasing temperatures.',
      ],
      [
        '当前值更大时持续弹栈并计算下标差。',
        'While the current value is warmer, pop and record the index difference.',
      ],
    ],
    reviewPoints: [
      [
        '单调栈一次解决多个待定位置。',
        'A monotonic stack resolves several pending positions at once.',
      ],
      ['存下标才能计算距离。', 'Store indices to compute distances.'],
    ],
    estimatedMinutes: 22,
  },
  {
    number: 15,
    slug: 'first-not-less-position',
    title: ['第一个不小于目标的位置', 'First Position Not Less Than Target'],
    description: [
      '在升序数组中返回第一个大于等于目标值的下标；不存在时返回数组长度。',
      'In a sorted array, return the first index whose value is at least the target, or the array length.',
    ],
    difficulty: 'easy',
    topics: ['binary-search'],
    entryPoint: 'firstNotLess',
    params: ['values, target', 'values, target'],
    tests: [
      { args: [[1, 3, 3, 7], 3], expected: 1 },
      { args: [[1, 3, 3, 7], 4], expected: 3 },
      { args: [[], 2], expected: 0 },
      { args: [[2, 4], 5], expected: 2 },
    ],
    constraints: [
      [
        '数组按非递减顺序排列。',
        'The array is sorted in non-decreasing order.',
      ],
    ],
    hints: [
      [
        '答案范围可以包含数组末尾之后。',
        'The answer range can include one past the last index.',
      ],
      [
        '使用左闭右开区间 [left, right)。',
        'Use a half-open interval [left, right).',
      ],
      [
        '中值满足条件就收缩 right，否则移动 left。',
        'Move right to a qualifying midpoint; otherwise move left.',
      ],
    ],
    reviewPoints: [
      [
        '二分边界模板应明确区间含义。',
        'A binary-search template needs explicit interval semantics.',
      ],
      [
        '最终 left 就是第一个可行位置。',
        'The final left is the first feasible position.',
      ],
    ],
    estimatedMinutes: 16,
  },
  {
    number: 16,
    slug: 'minimum-in-rotated-array',
    title: ['旋转数组最小值', 'Minimum in a Rotated Array'],
    description: [
      '升序且元素互异的数组经过旋转，返回其中的最小值。',
      'A sorted array of distinct values has been rotated; return its minimum value.',
    ],
    difficulty: 'medium',
    topics: ['binary-search'],
    entryPoint: 'rotatedMinimum',
    params: ['values', 'values'],
    tests: [
      { args: [[4, 5, 6, 1, 2, 3]], expected: 1 },
      { args: [[3, 1, 2]], expected: 1 },
      { args: [[1]], expected: 1 },
      { args: [[1, 2, 3]], expected: 1 },
    ],
    constraints: [
      [
        '1 <= values.length <= 100000，元素互异。',
        '1 <= values.length <= 100000 and values are distinct.',
      ],
    ],
    hints: [
      [
        '把中值与当前右端比较。',
        'Compare the midpoint with the current right endpoint.',
      ],
      [
        '中值较大说明最小值在右侧。',
        'A larger midpoint places the minimum to its right.',
      ],
      [
        '否则保留 mid 并收缩右端到 mid。',
        'Otherwise keep mid and shrink the right bound to it.',
      ],
    ],
    reviewPoints: [
      [
        '旋转点两侧仍保持单调。',
        'Both sides of the rotation point remain monotonic.',
      ],
      [
        '更新边界时不能丢掉可能的最小值。',
        'Boundary updates must retain a possible minimum.',
      ],
    ],
    estimatedMinutes: 20,
  },
  {
    number: 17,
    slug: 'merge-linked-values',
    title: ['合并两个有序链表序列', 'Merge Two Sorted Linked Sequences'],
    description: [
      '两个数组按链表节点顺序表示两个有序链表，返回合并后的节点值。',
      'Two arrays represent sorted linked-list node sequences; return the merged node values.',
    ],
    difficulty: 'easy',
    topics: ['linked-list', 'two-pointers'],
    entryPoint: 'mergeLinkedValues',
    params: ['first, second', 'first, second'],
    tests: [
      {
        args: [
          [1, 3, 5],
          [2, 4],
        ],
        expected: [1, 2, 3, 4, 5],
      },
      { args: [[], [1]], expected: [1] },
      { args: [[], []], expected: [] },
      {
        args: [
          [1, 2],
          [1, 3],
        ],
        expected: [1, 1, 2, 3],
      },
    ],
    constraints: [
      [
        '两个输入均按非递减顺序排列。',
        'Both inputs are sorted in non-decreasing order.',
      ],
    ],
    hints: [
      [
        '每次只需比较两个当前节点。',
        'Only the two current nodes need comparison.',
      ],
      [
        '较小节点进入结果并前移对应指针。',
        'Append the smaller node and advance its pointer.',
      ],
      [
        '任一链表耗尽后追加另一条的剩余部分。',
        'Append the remainder after either list is exhausted.',
      ],
    ],
    reviewPoints: [
      [
        '虚拟头节点可简化真实链表拼接。',
        'A dummy head simplifies real linked-list merging.',
      ],
      [
        '剩余尾部无需逐项比较。',
        'The remaining tail needs no more comparisons.',
      ],
    ],
    estimatedMinutes: 16,
  },
  {
    number: 18,
    slug: 'middle-linked-value',
    title: ['链表中间节点值', 'Middle Linked Value'],
    description: [
      '数组按链表顺序表示非空链表，返回中间节点值；偶数长度返回后一个中间节点。',
      'An array represents a non-empty linked list; return its middle value, choosing the later middle for even length.',
    ],
    difficulty: 'easy',
    topics: ['linked-list', 'two-pointers'],
    entryPoint: 'middleLinkedValue',
    params: ['values', 'values'],
    tests: [
      { args: [[1, 2, 3, 4]], expected: 3 },
      { args: [[1, 2, 3]], expected: 2 },
      { args: [[9]], expected: 9 },
      { args: [[5, 6]], expected: 6 },
    ],
    constraints: [
      ['1 <= values.length <= 100000', '1 <= values.length <= 100000'],
    ],
    hints: [
      [
        '一个指针每次走一步，另一个走两步。',
        'Move one pointer one step and another two steps.',
      ],
      [
        '快指针结束时慢指针位于中点。',
        'When the fast pointer ends, the slow pointer is at the middle.',
      ],
      [
        '偶数长度下该移动规则自然落在后一个中点。',
        'For even length this rule naturally lands on the later middle.',
      ],
    ],
    reviewPoints: [
      [
        '快慢指针可在未知长度链表上定位比例位置。',
        'Fast and slow pointers locate proportional positions without knowing length.',
      ],
      [
        '终止条件决定偶数长度的中点选择。',
        'The stopping condition determines the even-length middle.',
      ],
    ],
    estimatedMinutes: 14,
  },
  {
    number: 19,
    slug: 'climb-variable-steps',
    title: ['台阶走法数量', 'Count Staircase Routes'],
    description: [
      '每次走 1 或 2 级，返回到达第 n 级的走法数量；n=0 时为 1。',
      'Move one or two steps at a time and return the number of routes to step n; n=0 has one route.',
    ],
    difficulty: 'easy',
    topics: ['dynamic-programming'],
    entryPoint: 'countStairRoutes',
    params: ['n', 'n'],
    tests: [
      { args: [1], expected: 1 },
      { args: [2], expected: 2 },
      { args: [5], expected: 8 },
      { args: [0], expected: 1 },
    ],
    constraints: [['0 <= n <= 45', '0 <= n <= 45']],
    hints: [
      [
        '到达 n 的最后一步来自哪里？',
        'Where can the final move into n come from?',
      ],
      [
        '状态等于前一级与前两级走法之和。',
        'The state is the sum of the previous two route counts.',
      ],
      [
        '从 base(0)=1、base(1)=1 迭代。',
        'Iterate from base(0)=1 and base(1)=1.',
      ],
    ],
    reviewPoints: [
      [
        'DP 状态来自互斥的最后一步选择。',
        'DP states combine mutually exclusive final moves.',
      ],
      [
        '只依赖前两项时可压缩空间。',
        'Two previous states allow constant space.',
      ],
    ],
    estimatedMinutes: 14,
  },
  {
    number: 20,
    slug: 'maximum-non-adjacent-sum',
    title: ['不相邻元素最大和', 'Maximum Non-Adjacent Sum'],
    description: [
      '从非负整数数组中选择互不相邻的元素，返回可得到的最大和。',
      'Choose non-adjacent values from a non-negative integer array and return the maximum sum.',
    ],
    difficulty: 'medium',
    topics: ['dynamic-programming'],
    entryPoint: 'maximumNonAdjacentSum',
    params: ['values', 'values'],
    tests: [
      { args: [[2, 7, 9, 3, 1]], expected: 12 },
      { args: [[2, 1, 4, 9]], expected: 11 },
      { args: [[]], expected: 0 },
      { args: [[5]], expected: 5 },
    ],
    constraints: [
      ['0 <= values.length <= 100000', '0 <= values.length <= 100000'],
    ],
    hints: [
      [
        '当前位置只有选或不选两种决策。',
        'At each position either take it or skip it.',
      ],
      [
        '选当前值时只能接 i-2 的最佳结果。',
        'Taking the current value can only extend the best through i-2.',
      ],
      [
        'dp[i]=max(dp[i-1], dp[i-2]+values[i])。',
        'Use dp[i]=max(dp[i-1], dp[i-2]+values[i]).',
      ],
    ],
    reviewPoints: [
      [
        '相邻约束通过状态转移编码。',
        'The adjacency constraint is encoded in the transition.',
      ],
      [
        '滚动变量可代替整个数组。',
        'Rolling variables can replace the full table.',
      ],
    ],
    estimatedMinutes: 20,
  },
  {
    number: 21,
    slug: 'minimum-coin-count',
    title: ['凑齐金额的最少硬币', 'Minimum Coin Count'],
    description: [
      '给定可重复使用的正整数面额，返回凑齐 amount 的最少硬币数，不可达时返回 -1。',
      'Given reusable positive denominations, return the fewest coins for amount, or -1 if unreachable.',
    ],
    difficulty: 'medium',
    topics: ['dynamic-programming'],
    entryPoint: 'minimumCoinCount',
    params: ['coins, amount', 'coins, amount'],
    tests: [
      { args: [[1, 2, 5], 11], expected: 3 },
      { args: [[2], 3], expected: -1 },
      { args: [[], 0], expected: 0 },
      { args: [[2, 4], 8], expected: 2 },
    ],
    constraints: [
      [
        '0 <= amount <= 10000，面额为正整数。',
        '0 <= amount <= 10000 and denominations are positive integers.',
      ],
    ],
    hints: [
      [
        '定义每个中间金额的最优答案。',
        'Define the best answer for every intermediate amount.',
      ],
      [
        '从已知金额加一枚硬币转移。',
        'Transition by adding one coin to a known amount.',
      ],
      [
        'dp[0]=0，其余为不可达；枚举金额与面额更新最小值。',
        'Set dp[0]=0 and others unreachable; update each amount with every coin.',
      ],
    ],
    reviewPoints: [
      [
        '不可达状态需要安全哨兵值。',
        'Unreachable states need a safe sentinel.',
      ],
      [
        '面额可重复使用决定转移顺序。',
        'Reusable denominations determine the transition order.',
      ],
    ],
    estimatedMinutes: 24,
  },
  {
    number: 22,
    slug: 'count-grid-islands',
    title: ['网格岛屿数量', 'Count Grid Islands'],
    description: [
      '0/1 网格中，上下左右相邻的 1 属于同一岛屿，返回岛屿数量。',
      'In a 0/1 grid, orthogonally adjacent 1 cells form an island; return the island count.',
    ],
    difficulty: 'medium',
    topics: ['bfs', 'dfs'],
    entryPoint: 'countIslands',
    params: ['grid', 'grid'],
    tests: [
      {
        args: [
          [
            [1, 1, 0],
            [1, 0, 0],
            [0, 0, 1],
          ],
        ],
        expected: 2,
      },
      {
        args: [
          [
            [1, 0, 1],
            [0, 0, 0],
            [1, 0, 1],
          ],
        ],
        expected: 4,
      },
      { args: [[]], expected: 0 },
      { args: [[[1]]], expected: 1 },
    ],
    constraints: [['网格为空或为矩形。', 'The grid is empty or rectangular.']],
    hints: [
      [
        '每遇到一个未访问的 1，就发现了新岛屿。',
        'Every unvisited 1 starts a new island.',
      ],
      [
        '从该格遍历并标记整个连通区域。',
        'Traverse and mark the whole connected region.',
      ],
      [
        '扫描网格；对新陆地计数并用 BFS/DFS 扩展四邻域。',
        'Scan the grid; count new land and expand four neighbors with BFS/DFS.',
      ],
    ],
    reviewPoints: [
      [
        '连通分量计数由外层扫描触发。',
        'The outer scan starts each component count.',
      ],
      ['访问标记避免重复计数。', 'Visited marking prevents duplicate counts.'],
    ],
    estimatedMinutes: 22,
  },
  {
    number: 23,
    slug: 'nearest-zero-distance',
    title: ['到最近零的距离', 'Distance to the Nearest Zero'],
    description: [
      '0/1 矩形网格至少包含一个 0，返回每个格到最近 0 的上下左右距离。',
      'A rectangular 0/1 grid contains at least one 0; return each cell distance to its nearest 0.',
    ],
    difficulty: 'medium',
    topics: ['bfs'],
    entryPoint: 'nearestZeroDistance',
    params: ['grid', 'grid'],
    tests: [
      {
        args: [
          [
            [0, 0, 0],
            [0, 1, 0],
            [1, 1, 1],
          ],
        ],
        expected: [
          [0, 0, 0],
          [0, 1, 0],
          [1, 2, 1],
        ],
      },
      { args: [[[0]]], expected: [[0]] },
      { args: [[[1, 0]]], expected: [[1, 0]] },
      {
        args: [
          [
            [0, 1],
            [1, 1],
          ],
        ],
        expected: [
          [0, 1],
          [1, 2],
        ],
      },
    ],
    constraints: [
      [
        '网格非空且至少有一个 0。',
        'The grid is non-empty and contains at least one 0.',
      ],
    ],
    hints: [
      [
        '如果从每个 1 单独搜索会重复很多工作。',
        'Searching separately from every 1 repeats much work.',
      ],
      [
        '把所有 0 同时作为 BFS 起点。',
        'Use every 0 as a simultaneous BFS source.',
      ],
      [
        '零距离入队；首次访问邻格时距离加一。',
        'Enqueue zeros at distance zero; first visits get parent distance plus one.',
      ],
    ],
    reviewPoints: [
      [
        '多源 BFS 等价于加入一个虚拟共同起点。',
        'Multi-source BFS is equivalent to one virtual common source.',
      ],
      ['首次到达即为最短距离。', 'The first arrival is the shortest distance.'],
    ],
    estimatedMinutes: 25,
  },
  {
    number: 24,
    slug: 'undirected-component-count',
    title: ['无向图连通分量', 'Undirected Component Count'],
    description: [
      '给定 n 个节点和无向边，返回图中的连通分量数量。',
      'Given n nodes and undirected edges, return the number of connected components.',
    ],
    difficulty: 'medium',
    topics: ['dfs', 'bfs'],
    entryPoint: 'componentCount',
    params: ['n, edges', 'n, edges'],
    tests: [
      {
        args: [
          5,
          [
            [0, 1],
            [1, 2],
            [3, 4],
          ],
        ],
        expected: 2,
      },
      { args: [3, []], expected: 3 },
      { args: [1, []], expected: 1 },
      {
        args: [
          4,
          [
            [0, 1],
            [1, 2],
            [2, 3],
          ],
        ],
        expected: 1,
      },
    ],
    constraints: [['0 <= 节点编号 < n。', 'Node ids satisfy 0 <= id < n.']],
    hints: [
      [
        '每次从未访问节点开始会发现一个分量。',
        'Starting from each unvisited node discovers one component.',
      ],
      [
        '无向边要加入两个方向。',
        'Add each undirected edge in both directions.',
      ],
      [
        '构建邻接表，外层扫描并对未访问节点执行 BFS/DFS。',
        'Build adjacency lists, scan nodes, and BFS/DFS each unvisited one.',
      ],
    ],
    reviewPoints: [
      ['孤立节点也是一个分量。', 'An isolated node is also a component.'],
      [
        '遍历次数等于分量数。',
        'The number of traversal starts equals the component count.',
      ],
    ],
    estimatedMinutes: 20,
  },
  {
    number: 25,
    slug: 'directed-reachable-count',
    title: ['有向图可达节点数', 'Directed Reachable Node Count'],
    description: [
      '给定有向边和起点，返回从起点可到达的不同节点数量，包含起点。',
      'Given directed edges and a start node, return the number of distinct reachable nodes including the start.',
    ],
    difficulty: 'easy',
    topics: ['dfs', 'bfs'],
    entryPoint: 'reachableCount',
    params: ['n, edges, start', 'n, edges, start'],
    tests: [
      {
        args: [
          5,
          [
            [0, 1],
            [1, 2],
            [3, 4],
          ],
          0,
        ],
        expected: 3,
      },
      {
        args: [
          5,
          [
            [0, 1],
            [1, 2],
            [3, 4],
          ],
          3,
        ],
        expected: 2,
      },
      { args: [1, [], 0], expected: 1 },
      {
        args: [
          3,
          [
            [0, 1],
            [1, 2],
            [2, 0],
          ],
          1,
        ],
        expected: 3,
      },
    ],
    constraints: [
      [
        '起点与边端点均为有效节点。',
        'The start and all edge endpoints are valid nodes.',
      ],
    ],
    hints: [
      ['只沿边的给定方向扩展。', 'Follow edges only in their given direction.'],
      [
        '访问集合同时负责去重和防环。',
        'A visited set both deduplicates and prevents cycles.',
      ],
      [
        '从 start BFS/DFS，最终返回 visited 大小。',
        'BFS/DFS from start and return the visited-set size.',
      ],
    ],
    reviewPoints: [
      [
        '可达性与无向连通性不同。',
        'Directed reachability differs from undirected connectivity.',
      ],
      ['起点本身始终可达。', 'The start node is always reachable.'],
    ],
    estimatedMinutes: 18,
  },
  {
    number: 26,
    slug: 'course-order-possible',
    title: ['课程是否可全部完成', 'Can All Courses Be Completed'],
    description: [
      '边 [course, prerequisite] 表示先修关系，判断是否能完成全部 n 门课程。',
      'An edge [course, prerequisite] is a prerequisite relation; determine whether all n courses can be completed.',
    ],
    difficulty: 'medium',
    topics: ['dfs'],
    entryPoint: 'canFinishCourses',
    params: ['n, prerequisites', 'n, prerequisites'],
    tests: [
      { args: [2, [[1, 0]]], expected: true },
      {
        args: [
          2,
          [
            [1, 0],
            [0, 1],
          ],
        ],
        expected: false,
      },
      { args: [1, []], expected: true },
      { args: [1, [[0, 0]]], expected: false },
    ],
    constraints: [['0 <= 课程编号 < n。', 'Course ids satisfy 0 <= id < n.']],
    hints: [
      [
        '无法完成的根本原因是什么图结构？',
        'What graph structure makes completion impossible?',
      ],
      [
        '可以检测有向环，也可以逐步移除入度为 0 的节点。',
        'Detect a directed cycle or repeatedly remove indegree-zero nodes.',
      ],
      [
        '拓扑法：统计入度，队列处理零入度并减少后继入度。',
        'Topological method: queue zero-indegree nodes and reduce successors.',
      ],
    ],
    reviewPoints: [
      [
        'DAG 才存在完整拓扑顺序。',
        'Only a DAG has a complete topological order.',
      ],
      [
        '处理节点数不足 n 说明存在环。',
        'Processing fewer than n nodes reveals a cycle.',
      ],
    ],
    estimatedMinutes: 22,
  },
  {
    number: 27,
    slug: 'subarray-target-count',
    title: ['目标和子数组数量', 'Count Target-Sum Subarrays'],
    description: [
      '返回整数数组中元素和恰好等于 target 的连续子数组数量。',
      'Return the number of contiguous subarrays whose sum equals target.',
    ],
    difficulty: 'medium',
    topics: ['array-hash'],
    entryPoint: 'countTargetSubarrays',
    params: ['values, target', 'values, target'],
    tests: [
      { args: [[1, 1, 1], 2], expected: 2 },
      { args: [[1, 2, 3], 3], expected: 2 },
      { args: [[], 0], expected: 0 },
      { args: [[0, 0], 0], expected: 3 },
    ],
    constraints: [
      ['0 <= values.length <= 100000', '0 <= values.length <= 100000'],
    ],
    hints: [
      [
        '区间和可以由两个前缀和相减得到。',
        'A range sum is the difference of two prefix sums.',
      ],
      [
        '当前前缀为 sum 时，需要之前出现过 sum-target。',
        'At prefix sum, look for prior sum-target occurrences.',
      ],
      [
        '频次表初始包含前缀和 0 一次。',
        'Initialize the frequency map with prefix sum 0 once.',
      ],
    ],
    reviewPoints: [
      [
        '需要保存频次而非仅保存是否出现。',
        'Store frequencies, not just presence.',
      ],
      [
        '初始零前缀覆盖从下标 0 开始的区间。',
        'The initial zero prefix covers ranges starting at index 0.',
      ],
    ],
    estimatedMinutes: 22,
  },
  {
    number: 28,
    slug: 'three-value-target',
    title: ['三个数能否组成目标和', 'Three Values for a Target Sum'],
    description: [
      '判断数组中是否存在三个不同位置的元素之和等于 target。',
      'Determine whether values at three distinct positions sum to target.',
    ],
    difficulty: 'medium',
    topics: ['two-pointers'],
    entryPoint: 'hasThreeValueTarget',
    params: ['values, target', 'values, target'],
    tests: [
      { args: [[-1, 0, 1, 2, -1, -4], 0], expected: true },
      { args: [[1, 2, 4], 8], expected: false },
      { args: [[0, 0, 0], 0], expected: true },
      { args: [[], 0], expected: false },
    ],
    constraints: [['0 <= values.length <= 3000', '0 <= values.length <= 3000']],
    hints: [
      ['排序后先固定其中一个位置。', 'Sort first, then fix one position.'],
      [
        '剩余两个数可用左右指针寻找。',
        'Use left and right pointers for the remaining pair.',
      ],
      [
        '固定 i，在 i+1 与末尾间按当前和移动指针。',
        'Fix i and move pointers between i+1 and the end based on the sum.',
      ],
    ],
    reviewPoints: [
      [
        '排序把两数搜索转化为单调移动。',
        'Sorting turns pair search into monotonic movement.',
      ],
      [
        '不同位置通过指针边界保证。',
        'Pointer boundaries guarantee distinct positions.',
      ],
    ],
    estimatedMinutes: 22,
  },
  {
    number: 29,
    slug: 'maximum-water-container',
    title: ['最大盛水面积', 'Maximum Water Container'],
    description: [
      '每个非负整数表示竖线高度，选择两条线返回可围成的最大面积。',
      'Each non-negative integer is a vertical line height; choose two lines for the maximum contained area.',
    ],
    difficulty: 'medium',
    topics: ['two-pointers'],
    entryPoint: 'maximumContainerArea',
    params: ['heights', 'heights'],
    tests: [
      { args: [[1, 8, 6, 2, 5, 4, 8, 3, 7]], expected: 49 },
      { args: [[1, 1]], expected: 1 },
      { args: [[1]], expected: 0 },
      { args: [[4, 3, 2, 1, 4]], expected: 16 },
    ],
    constraints: [
      ['0 <= heights.length <= 100000', '0 <= heights.length <= 100000'],
    ],
    hints: [
      [
        '面积由宽度与较短边共同决定。',
        'Area is determined by width and the shorter line.',
      ],
      [
        '从两端开始，移动较短的一侧。',
        'Start at both ends and move the shorter side.',
      ],
      [
        '每步更新 min(height[left],height[right])*(right-left)。',
        'Update min(height[left],height[right])*(right-left) each step.',
      ],
    ],
    reviewPoints: [
      [
        '移动较长边无法改善当前高度瓶颈。',
        'Moving the taller side cannot improve the current height bottleneck.',
      ],
      [
        '双指针在 O(n) 内覆盖可能的改进。',
        'Two pointers cover possible improvements in O(n).',
      ],
    ],
    estimatedMinutes: 20,
  },
  {
    number: 30,
    slug: 'remove-adjacent-pairs',
    title: ['删除相邻重复字符', 'Remove Adjacent Duplicate Pairs'],
    description: [
      '反复删除字符串中相邻且相同的两个字符，返回最终字符串。',
      'Repeatedly remove adjacent equal character pairs and return the final string.',
    ],
    difficulty: 'easy',
    topics: ['stack'],
    entryPoint: 'removeAdjacentPairs',
    params: ['text', 'text'],
    tests: [
      { args: ['abbaca'], expected: 'ca' },
      { args: ['azxxzy'], expected: 'ay' },
      { args: [''], expected: '' },
      { args: ['aaaa'], expected: '' },
    ],
    constraints: [['0 <= text.length <= 100000', '0 <= text.length <= 100000']],
    hints: [
      [
        '删除后新相邻的字符也可能继续匹配。',
        'A deletion can create another adjacent match.',
      ],
      [
        '需要保留尚未被抵消的字符序列。',
        'Keep the sequence of characters not yet canceled.',
      ],
      [
        '栈顶等于当前字符就弹出，否则压入。',
        'Pop when the top equals the current character; otherwise push.',
      ],
    ],
    reviewPoints: [
      [
        '栈顶代表当前结果的末尾。',
        'The stack top is the end of the current result.',
      ],
      [
        '每个字符最多入栈和出栈一次。',
        'Each character is pushed and popped at most once.',
      ],
    ],
    estimatedMinutes: 14,
  },
];

export const extendedProblems = seeds.map(problem);
