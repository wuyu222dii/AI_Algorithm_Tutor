import {
  CoachLocale,
  Difficulty,
  LocalizedProblem,
  LocalizedText,
  Problem,
  ProblemTopic,
} from '../types';
import { extendedProblems } from './extended-problems';

const text = (zh: string, en: string): LocalizedText => ({ zh, en });
const localizedHints = (
  items: [LocalizedText, LocalizedText, LocalizedText]
): Record<CoachLocale, [string, string, string]> => ({
  zh: items.map((item) => item.zh) as [string, string, string],
  en: items.map((item) => item.en) as [string, string, string],
});

export const problems: Problem[] = [
  {
    id: 'ac-001',
    slug: 'first-unique-position',
    title: text('首个唯一元素的位置', 'First Unique Position'),
    description: text(
      '给定一个整数数组，返回第一个只出现一次的元素下标；若不存在则返回 -1。',
      'Given an integer array, return the index of the first value that occurs exactly once, or -1 if none exists.'
    ),
    difficulty: 'easy',
    topics: ['array-hash'],
    entryPoint: 'firstUniquePosition',
    templates: {
      javascript: `function firstUniquePosition(values) {
  // Return the index of the first value that appears once.
  
}`,
      python: `def first_unique_position(values):
    # Return the index of the first value that appears once.
    pass`,
    },
    tests: [
      { id: 'fu-1', args: [[4, 7, 4, 9, 7]], expected: 3, isSample: true },
      { id: 'fu-2', args: [[2, 2, 3, 5, 3]], expected: 3, isSample: true },
      { id: 'fu-3', args: [[8, 8]], expected: -1, isSample: false },
      { id: 'fu-4', args: [[6]], expected: 0, isSample: false },
    ],
    examples: [
      {
        id: 'fu-example',
        input: [4, 7, 4, 9, 7],
        expected: 3,
        explanation: text(
          '9 只出现一次，且下标最小。',
          '9 is the earliest value that occurs once.'
        ),
      },
    ],
    constraints: [
      text('1 <= values.length <= 100000', '1 <= values.length <= 100000'),
      text('元素为安全整数。', 'Every value is a safe integer.'),
    ],
    hints: localizedHints([
      text(
        '先想清楚需要为每个值保存什么信息。',
        'Decide what information must be stored for every value.'
      ),
      text(
        '第一次遍历统计频次，第二次按原顺序查找。',
        'Count frequencies first, then scan in original order.'
      ),
      text(
        'freq = 计数(values)；依次检查 i，若 freq[values[i]] == 1 则返回 i。',
        'freq = count(values); scan i and return i when freq[values[i]] == 1.'
      ),
    ]),
    reviewPoints: [
      text(
        '哈希表用空间换取常数时间查询。',
        'A hash map trades space for constant-time lookup.'
      ),
      text(
        '要找“第一个”时必须保留原始遍历顺序。',
        'Finding the first match requires preserving input order.'
      ),
    ],
    estimatedMinutes: 12,
  },
  {
    id: 'ac-002',
    slug: 'sorted-pair-target',
    title: text('有序数组目标配对', 'Target Pair in a Sorted Array'),
    description: text(
      '给定升序整数数组和目标值，判断是否存在两个不同位置的元素之和等于目标值。',
      'Given a sorted integer array and a target, determine whether two values at different positions sum to the target.'
    ),
    difficulty: 'easy',
    topics: ['two-pointers'],
    entryPoint: 'hasTargetPair',
    templates: {
      javascript: `function hasTargetPair(values, target) {
  // values is sorted in ascending order.
  
}`,
      python: `def has_target_pair(values, target):
    # values is sorted in ascending order.
    pass`,
    },
    tests: [
      {
        id: 'tp-1',
        args: [[1, 3, 4, 8, 11], 12],
        expected: true,
        isSample: true,
      },
      {
        id: 'tp-2',
        args: [[2, 5, 9, 14], 13],
        expected: false,
        isSample: true,
      },
      { id: 'tp-3', args: [[5, 5], 10], expected: true, isSample: false },
      { id: 'tp-4', args: [[], 0], expected: false, isSample: false },
    ],
    examples: [
      {
        id: 'tp-example',
        input: { values: [1, 3, 4, 8, 11], target: 12 },
        expected: true,
        explanation: text('1 + 11 = 12。', '1 + 11 = 12.'),
      },
    ],
    constraints: [
      text(
        '数组已按非递减顺序排列。',
        'The array is sorted in non-decreasing order.'
      ),
      text('0 <= values.length <= 100000', '0 <= values.length <= 100000'),
    ],
    hints: localizedHints([
      text(
        '利用“有序”这一条件缩小搜索范围。',
        'Use the sorted order to shrink the search space.'
      ),
      text(
        '从数组两端开始，根据当前和移动一个指针。',
        'Start at both ends and move one pointer based on the current sum.'
      ),
      text(
        'left < right 时：和小就 left++，和大就 right--，相等则返回 true。',
        'While left < right: move left for a small sum, right for a large sum, otherwise return true.'
      ),
    ]),
    reviewPoints: [
      text(
        '双指针把 O(n²) 枚举降为 O(n)。',
        'Two pointers reduce O(n²) enumeration to O(n).'
      ),
      text(
        '指针移动必须依赖单调性。',
        'Pointer movement must be justified by monotonicity.'
      ),
    ],
    estimatedMinutes: 12,
  },
  {
    id: 'ac-003',
    slug: 'maximum-bracket-depth',
    title: text('括号最大嵌套深度', 'Maximum Bracket Depth'),
    description: text(
      '字符串只包含括号与小写字母。若括号不合法返回 -1，否则返回三类括号的最大嵌套深度。',
      'The string contains brackets and lowercase letters. Return -1 for invalid brackets; otherwise return the maximum nesting depth across all bracket types.'
    ),
    difficulty: 'medium',
    topics: ['stack'],
    entryPoint: 'maximumBracketDepth',
    templates: {
      javascript: `function maximumBracketDepth(text) {
  // Bracket types: (), [], {}
  
}`,
      python: `def maximum_bracket_depth(text):
    # Bracket types: (), [], {}
    pass`,
    },
    tests: [
      { id: 'bd-1', args: ['a(b[c{d}])'], expected: 3, isSample: true },
      { id: 'bd-2', args: ['([)]'], expected: -1, isSample: true },
      { id: 'bd-3', args: ['plain'], expected: 0, isSample: false },
      { id: 'bd-4', args: ['{{[()]}}'], expected: 4, isSample: false },
    ],
    examples: [
      {
        id: 'bd-example',
        input: 'a(b[c{d}])',
        expected: 3,
        explanation: text(
          '最深位置依次位于 (、[、{ 内。',
          'The deepest point is inside (, then [, then {.'
        ),
      },
    ],
    constraints: [
      text('0 <= text.length <= 100000', '0 <= text.length <= 100000'),
      text('括号类型为 ()、[]、{}。', 'Bracket types are (), [], and {}.'),
    ],
    hints: localizedHints([
      text(
        '遇到右括号时，需要知道最近尚未匹配的左括号。',
        'A closing bracket must match the most recent unmatched opening bracket.'
      ),
      text(
        '用栈保存左括号，并在每次入栈后更新最大深度。',
        'Store opening brackets in a stack and update depth after every push.'
      ),
      text(
        '左括号入栈；右括号检查栈顶并弹出；不匹配或最终非空则返回 -1。',
        'Push openings; for a closing, verify and pop the top; return -1 on mismatch or a non-empty final stack.'
      ),
    ]),
    reviewPoints: [
      text(
        '栈适合处理最近未闭合的结构。',
        'A stack tracks the most recently opened structure.'
      ),
      text(
        '合法性检查包括过程与最终状态。',
        'Validation must check both intermediate and final states.'
      ),
    ],
    estimatedMinutes: 18,
  },
  {
    id: 'ac-004',
    slug: 'minimum-processing-rate',
    title: text('最小处理速率', 'Minimum Processing Rate'),
    description: text(
      '给定若干批任务量和总小时数。每小时只能处理一批，最多处理 rate 个单位；求按时完成的最小整数 rate。',
      'Given work batches and an hour limit, only one batch can be processed per hour at up to rate units. Find the minimum integer rate that finishes on time.'
    ),
    difficulty: 'medium',
    topics: ['binary-search'],
    entryPoint: 'minimumRate',
    templates: {
      javascript: `function minimumRate(batches, hours) {
  // Return the smallest feasible positive integer rate.
  
}`,
      python: `def minimum_rate(batches, hours):
    # Return the smallest feasible positive integer rate.
    pass`,
    },
    tests: [
      { id: 'mr-1', args: [[3, 6, 7, 11], 8], expected: 4, isSample: true },
      { id: 'mr-2', args: [[12, 4, 8], 3], expected: 12, isSample: true },
      { id: 'mr-3', args: [[1, 1, 1], 6], expected: 1, isSample: false },
      {
        id: 'mr-4',
        args: [[30, 11, 23, 4, 20], 6],
        expected: 23,
        isSample: false,
      },
    ],
    examples: [
      {
        id: 'mr-example',
        input: { batches: [3, 6, 7, 11], hours: 8 },
        expected: 4,
        explanation: text(
          '速率 4 需要 1+2+2+3=8 小时。',
          'Rate 4 needs 1+2+2+3=8 hours.'
        ),
      },
    ],
    constraints: [
      text('1 <= batches.length <= hours', '1 <= batches.length <= hours'),
      text(
        '任务量和 hours 均为正整数。',
        'Batch sizes and hours are positive integers.'
      ),
    ],
    hints: localizedHints([
      text(
        '答案越大，完成所需时间不会增加。',
        'As the candidate rate grows, required time never increases.'
      ),
      text(
        '在 [1, max(batches)] 上二分第一个可行值。',
        'Binary-search the first feasible value in [1, max(batches)].'
      ),
      text(
        'needed(rate)=sum(ceil(batch/rate))；可行则收缩右边界，否则提高左边界。',
        'needed(rate)=sum(ceil(batch/rate)); shrink right when feasible, otherwise raise left.'
      ),
    ]),
    reviewPoints: [
      text(
        '二分答案依赖可行性的单调变化。',
        'Binary-searching the answer requires monotonic feasibility.'
      ),
      text(
        '整数向上取整应避免浮点误差。',
        'Integer ceiling division avoids floating-point errors.'
      ),
    ],
    estimatedMinutes: 22,
  },
  {
    id: 'ac-005',
    slug: 'remove-linked-node-from-end',
    title: text('删除链表倒数节点', 'Remove a Linked Node from the End'),
    description: text(
      '数组按顺序表示单链表节点值。删除倒数第 n 个节点并返回剩余节点值；n 保证有效。',
      'An array lists the values of a singly linked list in order. Remove the nth node from the end and return the remaining values; n is valid.'
    ),
    difficulty: 'medium',
    topics: ['linked-list', 'two-pointers'],
    entryPoint: 'removeFromEnd',
    templates: {
      javascript: `function removeFromEnd(values, n) {
  // Treat values as the nodes of a singly linked list.
  
}`,
      python: `def remove_from_end(values, n):
    # Treat values as the nodes of a singly linked list.
    pass`,
    },
    tests: [
      {
        id: 'll-1',
        args: [[5, 8, 2, 9], 2],
        expected: [5, 8, 9],
        isSample: true,
      },
      { id: 'll-2', args: [[4], 1], expected: [], isSample: true },
      { id: 'll-3', args: [[1, 2], 2], expected: [2], isSample: false },
      {
        id: 'll-4',
        args: [[1, 2, 3, 4, 5], 1],
        expected: [1, 2, 3, 4],
        isSample: false,
      },
    ],
    examples: [
      {
        id: 'll-example',
        input: { values: [5, 8, 2, 9], n: 2 },
        expected: [5, 8, 9],
        explanation: text(
          '倒数第二个节点值为 2。',
          'The second node from the end has value 2.'
        ),
      },
    ],
    constraints: [
      text(
        '1 <= n <= values.length <= 100000',
        '1 <= n <= values.length <= 100000'
      ),
      text(
        '输入数组仅作为链表的可序列化表示。',
        'The input array is only a serializable representation of a linked list.'
      ),
    ],
    hints: localizedHints([
      text(
        '怎样让两个指针始终相隔 n 个节点？',
        'How can two pointers remain n nodes apart?'
      ),
      text(
        '先让快指针前进 n 步，再同步移动快慢指针。',
        'Advance a fast pointer n steps, then move fast and slow together.'
      ),
      text(
        '加入虚拟头；fast 先走 n 步，再一起走到 fast.next 为空，删除 slow.next。',
        'Use a dummy head; advance fast n steps, move both until fast.next is null, then remove slow.next.'
      ),
    ]),
    reviewPoints: [
      text(
        '固定间距双指针可在一次遍历中定位倒数节点。',
        'Fixed-gap pointers locate a node from the end in one pass.'
      ),
      text(
        '虚拟头节点统一处理删除头节点的边界。',
        'A dummy head unifies deletion at the head boundary.'
      ),
    ],
    estimatedMinutes: 20,
  },
  {
    id: 'ac-006',
    slug: 'minimum-energy-path',
    title: text('台阶最小能量', 'Minimum Stair Energy'),
    description: text(
      '从下标 0 出发，每次走 1 或 2 步，进入某级台阶需支付对应能量。返回到达最后一级的最小总能量。',
      'Start at index 0 and move one or two steps. Entering a stair costs its energy. Return the minimum total energy needed to reach the last stair.'
    ),
    difficulty: 'medium',
    topics: ['dynamic-programming'],
    entryPoint: 'minimumEnergy',
    templates: {
      javascript: `function minimumEnergy(costs) {
  // The cost at index 0 is paid at the start.
  
}`,
      python: `def minimum_energy(costs):
    # The cost at index 0 is paid at the start.
    pass`,
    },
    tests: [
      { id: 'dp-1', args: [[2, 5, 1, 3]], expected: 6, isSample: true },
      { id: 'dp-2', args: [[4]], expected: 4, isSample: true },
      { id: 'dp-3', args: [[1, 100, 1, 1, 1]], expected: 4, isSample: false },
      { id: 'dp-4', args: [[3, 2]], expected: 5, isSample: false },
    ],
    examples: [
      {
        id: 'dp-example',
        input: [2, 5, 1, 3],
        expected: 6,
        explanation: text(
          '路径 0 → 2 → 3，能量为 2+1+3。',
          'Path 0 → 2 → 3 costs 2+1+3.'
        ),
      },
    ],
    constraints: [
      text('1 <= costs.length <= 100000', '1 <= costs.length <= 100000'),
      text(
        '每项能量为非负整数。',
        'Every energy cost is a non-negative integer.'
      ),
    ],
    hints: localizedHints([
      text(
        '到达当前位置的最后一步只可能来自前一阶或前两阶。',
        'The last move into a stair comes from either one or two positions back.'
      ),
      text(
        '定义 dp[i] 为到达 i 并支付 costs[i] 后的最小能量。',
        'Let dp[i] be the minimum energy after reaching and paying for stair i.'
      ),
      text(
        'dp[0]=cost[0]；dp[1]=cost[0]+cost[1]；dp[i]=cost[i]+min(dp[i-1],dp[i-2])。',
        'dp[0]=cost[0]; dp[1]=cost[0]+cost[1]; dp[i]=cost[i]+min(dp[i-1],dp[i-2]).'
      ),
    ]),
    reviewPoints: [
      text(
        '状态定义必须包含已经支付当前成本这一语义。',
        'The state definition must say whether the current cost is already paid.'
      ),
      text(
        '只依赖前两个状态时可将空间压缩到 O(1)。',
        'Depending on two previous states allows O(1) space.'
      ),
    ],
    estimatedMinutes: 20,
  },
  {
    id: 'ac-007',
    slug: 'shortest-grid-exit',
    title: text('网格最短出口', 'Shortest Grid Exit'),
    description: text(
      '网格中 0 可通行、1 为障碍。从起点出发，返回到任一边界格的最少移动次数；起点本身若在边界则返回 0，无路返回 -1。',
      'In a grid, 0 is open and 1 is blocked. Return the fewest moves from the start to any boundary cell. Return 0 if the start is on the boundary and -1 if unreachable.'
    ),
    difficulty: 'medium',
    topics: ['bfs'],
    entryPoint: 'shortestExit',
    templates: {
      javascript: `function shortestExit(grid, start) {
  // start is [row, column].
  
}`,
      python: `def shortest_exit(grid, start):
    # start is [row, column].
    pass`,
    },
    tests: [
      {
        id: 'bfs-1',
        args: [
          [
            [1, 0, 1],
            [0, 0, 0],
            [1, 1, 1],
          ],
          [1, 1],
        ],
        expected: 1,
        isSample: true,
      },
      {
        id: 'bfs-2',
        args: [
          [
            [0, 0],
            [0, 0],
          ],
          [0, 1],
        ],
        expected: 0,
        isSample: true,
      },
      {
        id: 'bfs-3',
        args: [
          [
            [1, 1, 1],
            [1, 0, 1],
            [1, 1, 1],
          ],
          [1, 1],
        ],
        expected: -1,
        isSample: false,
      },
      { id: 'bfs-4', args: [[[0]], [0, 0]], expected: 0, isSample: false },
    ],
    examples: [
      {
        id: 'bfs-example',
        input: {
          grid: [
            [1, 0, 1],
            [0, 0, 0],
            [1, 1, 1],
          ],
          start: [1, 1],
        },
        expected: 1,
        explanation: text(
          '向左或向右一步即可到达边界。',
          'One move left or right reaches the boundary.'
        ),
      },
    ],
    constraints: [
      text(
        '网格为非空矩形，起点可通行。',
        'The grid is a non-empty rectangle and the start is open.'
      ),
      text(
        '只能上下左右移动。',
        'Movement is limited to four orthogonal directions.'
      ),
    ],
    hints: localizedHints([
      text(
        '无权图的最短步数应按距离逐层探索。',
        'Shortest paths in an unweighted graph should be explored level by level.'
      ),
      text(
        '使用队列做 BFS，节点入队时立即标记访问。',
        'Use a queue for BFS and mark nodes visited when enqueued.'
      ),
      text(
        '队列保存 (r,c,d)；弹出边界格即返回 d；扩展四邻域，队列耗尽返回 -1。',
        'Queue (r,c,d); return d when a boundary cell is dequeued; add unvisited neighbors and return -1 if exhausted.'
      ),
    ]),
    reviewPoints: [
      text(
        'BFS 第一次到达即得到无权图最短距离。',
        'The first BFS arrival gives the shortest unweighted distance.'
      ),
      text(
        '入队时标记可避免同一节点重复入队。',
        'Marking on enqueue prevents duplicate work.'
      ),
    ],
    estimatedMinutes: 25,
  },
  {
    id: 'ac-008',
    slug: 'dependency-cycle',
    title: text('依赖关系是否成环', 'Dependency Cycle Detection'),
    description: text(
      '有 n 个任务，边 [a,b] 表示 a 依赖 b。判断依赖图中是否存在环。',
      'There are n tasks; edge [a,b] means a depends on b. Determine whether the dependency graph contains a cycle.'
    ),
    difficulty: 'medium',
    topics: ['dfs'],
    entryPoint: 'hasDependencyCycle',
    templates: {
      javascript: `function hasDependencyCycle(n, dependencies) {
  // dependencies contains [task, prerequisite] pairs.
  
}`,
      python: `def has_dependency_cycle(n, dependencies):
    # dependencies contains [task, prerequisite] pairs.
    pass`,
    },
    tests: [
      {
        id: 'dfs-1',
        args: [
          3,
          [
            [1, 0],
            [2, 1],
          ],
        ],
        expected: false,
        isSample: true,
      },
      {
        id: 'dfs-2',
        args: [
          3,
          [
            [1, 0],
            [2, 1],
            [0, 2],
          ],
        ],
        expected: true,
        isSample: true,
      },
      { id: 'dfs-3', args: [1, []], expected: false, isSample: false },
      { id: 'dfs-4', args: [2, [[0, 0]]], expected: true, isSample: false },
    ],
    examples: [
      {
        id: 'dfs-example',
        input: {
          n: 3,
          dependencies: [
            [1, 0],
            [2, 1],
            [0, 2],
          ],
        },
        expected: true,
        explanation: text(
          '0 → 1 → 2 → 0 构成环。',
          '0 → 1 → 2 → 0 forms a cycle.'
        ),
      },
    ],
    constraints: [
      text('1 <= n <= 100000', '1 <= n <= 100000'),
      text('任务编号范围为 0 到 n-1。', 'Task ids range from 0 to n-1.'),
    ],
    hints: localizedHints([
      text(
        '需要区分“从未访问”和“当前搜索路径中”。',
        'Distinguish never visited nodes from nodes in the current search path.'
      ),
      text(
        'DFS 使用三色状态：未访问、访问中、已完成。',
        'Use three DFS colors: unvisited, visiting, and complete.'
      ),
      text(
        '进入节点标为 visiting；遇到 visiting 邻居说明有环；退出前标为 complete。',
        'Mark a node visiting on entry; a visiting neighbor means a cycle; mark complete on exit.'
      ),
    ]),
    reviewPoints: [
      text(
        '有向图成环判断依赖当前递归路径。',
        'Directed-cycle detection depends on the current recursion path.'
      ),
      text(
        '已完成节点无需重复搜索。',
        'Completed nodes do not need to be searched again.'
      ),
    ],
    estimatedMinutes: 25,
  },
  ...extendedProblems,
];

export const PROBLEMS = problems;

export function getProblemBySlug(slug: string): Problem | undefined {
  return problems.find((problem) => problem.slug === slug);
}

export function getLocalizedProblem(
  problemOrSlug: Problem | string,
  locale: CoachLocale = 'zh'
): LocalizedProblem | undefined {
  const problem =
    typeof problemOrSlug === 'string'
      ? getProblemBySlug(problemOrSlug)
      : problemOrSlug;

  if (!problem) return undefined;

  return {
    ...problem,
    title: problem.title[locale],
    description: problem.description[locale],
    constraints: problem.constraints.map((item) => item[locale]),
    hints: problem.hints[locale],
    reviewPoints: problem.reviewPoints.map((item) => item[locale]),
  };
}

export interface ProblemFilters {
  difficulty?: Difficulty | 'all';
  topic?: ProblemTopic | 'all';
  status?: 'all' | 'completed' | 'attempted' | 'not-started';
  completedSlugs?: string[];
  attemptedSlugs?: string[];
}

export function filterProblems(filters: ProblemFilters = {}): Problem[] {
  const completed = new Set(filters.completedSlugs ?? []);
  const attempted = new Set(filters.attemptedSlugs ?? []);

  return problems.filter((problem) => {
    if (
      filters.difficulty &&
      filters.difficulty !== 'all' &&
      problem.difficulty !== filters.difficulty
    ) {
      return false;
    }
    if (
      filters.topic &&
      filters.topic !== 'all' &&
      !problem.topics.includes(filters.topic)
    ) {
      return false;
    }
    if (filters.status === 'completed' && !completed.has(problem.slug)) {
      return false;
    }
    if (
      filters.status === 'attempted' &&
      (!attempted.has(problem.slug) || completed.has(problem.slug))
    ) {
      return false;
    }
    if (
      filters.status === 'not-started' &&
      (attempted.has(problem.slug) || completed.has(problem.slug))
    ) {
      return false;
    }
    return true;
  });
}
