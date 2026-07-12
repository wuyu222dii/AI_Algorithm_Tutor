WITH catalog AS (
  SELECT value AS problem
  FROM jsonb_array_elements($catalog$
[
  {
    "id":"ac-001","slug":"first-unique-position","title":{"zh":"首个唯一元素的位置","en":"First Unique Position"},"description":{"zh":"给定一个整数数组，返回第一个只出现一次的元素下标；若不存在则返回 -1。","en":"Given an integer array, return the index of the first value that occurs exactly once, or -1 if none exists."},"difficulty":"easy","topics":["array-hash"],"entryPoint":"firstUniquePosition","templates":{"javascript":"function firstUniquePosition(values) {\n  // Return the index of the first value that appears once.\n  \n}","python":"def first_unique_position(values):\n    # Return the index of the first value that appears once.\n    pass"},"tests":[{"id":"fu-1","args":[[4,7,4,9,7]],"expected":3,"isSample":true},{"id":"fu-2","args":[[2,2,3,5,3]],"expected":3,"isSample":true},{"id":"fu-3","args":[[8,8]],"expected":-1,"isSample":false},{"id":"fu-4","args":[[6]],"expected":0,"isSample":false}],"examples":[{"id":"fu-example","input":[4,7,4,9,7],"expected":3,"explanation":{"zh":"9 只出现一次，且下标最小。","en":"9 is the earliest value that occurs once."}}],"constraints":[{"zh":"1 <= values.length <= 100000","en":"1 <= values.length <= 100000"},{"zh":"元素为安全整数。","en":"Every value is a safe integer."}],"hints":{"zh":["先想清楚需要为每个值保存什么信息。","第一次遍历统计频次，第二次按原顺序查找。","freq = 计数(values)；依次检查 i，若 freq[values[i]] == 1 则返回 i。"],"en":["Decide what information must be stored for every value.","Count frequencies first, then scan in original order.","freq = count(values); scan i and return i when freq[values[i]] == 1."]},"reviewPoints":[{"zh":"哈希表用空间换取常数时间查询。","en":"A hash map trades space for constant-time lookup."},{"zh":"要找“第一个”时必须保留原始遍历顺序。","en":"Finding the first match requires preserving input order."}],"estimatedMinutes":12
  },
  {
    "id":"ac-002","slug":"sorted-pair-target","title":{"zh":"有序数组目标配对","en":"Target Pair in a Sorted Array"},"description":{"zh":"给定升序整数数组和目标值，判断是否存在两个不同位置的元素之和等于目标值。","en":"Given a sorted integer array and a target, determine whether two values at different positions sum to the target."},"difficulty":"easy","topics":["two-pointers"],"entryPoint":"hasTargetPair","templates":{"javascript":"function hasTargetPair(values, target) {\n  // values is sorted in ascending order.\n  \n}","python":"def has_target_pair(values, target):\n    # values is sorted in ascending order.\n    pass"},"tests":[{"id":"tp-1","args":[[1,3,4,8,11],12],"expected":true,"isSample":true},{"id":"tp-2","args":[[2,5,9,14],13],"expected":false,"isSample":true},{"id":"tp-3","args":[[5,5],10],"expected":true,"isSample":false},{"id":"tp-4","args":[[],0],"expected":false,"isSample":false}],"examples":[{"id":"tp-example","input":{"values":[1,3,4,8,11],"target":12},"expected":true,"explanation":{"zh":"1 + 11 = 12。","en":"1 + 11 = 12."}}],"constraints":[{"zh":"数组已按非递减顺序排列。","en":"The array is sorted in non-decreasing order."},{"zh":"0 <= values.length <= 100000","en":"0 <= values.length <= 100000"}],"hints":{"zh":["利用“有序”这一条件缩小搜索范围。","从数组两端开始，根据当前和移动一个指针。","left < right 时：和小就 left++，和大就 right--，相等则返回 true。"],"en":["Use the sorted order to shrink the search space.","Start at both ends and move one pointer based on the current sum.","While left < right: move left for a small sum, right for a large sum, otherwise return true."]},"reviewPoints":[{"zh":"双指针把 O(n²) 枚举降为 O(n)。","en":"Two pointers reduce O(n²) enumeration to O(n)."},{"zh":"指针移动必须依赖单调性。","en":"Pointer movement must be justified by monotonicity."}],"estimatedMinutes":12
  },
  {
    "id":"ac-003","slug":"maximum-bracket-depth","title":{"zh":"括号最大嵌套深度","en":"Maximum Bracket Depth"},"description":{"zh":"字符串只包含括号与小写字母。若括号不合法返回 -1，否则返回三类括号的最大嵌套深度。","en":"The string contains brackets and lowercase letters. Return -1 for invalid brackets; otherwise return the maximum nesting depth across all bracket types."},"difficulty":"medium","topics":["stack"],"entryPoint":"maximumBracketDepth","templates":{"javascript":"function maximumBracketDepth(text) {\n  // Bracket types: (), [], {}\n  \n}","python":"def maximum_bracket_depth(text):\n    # Bracket types: (), [], {}\n    pass"},"tests":[{"id":"bd-1","args":["a(b[c{d}])"],"expected":3,"isSample":true},{"id":"bd-2","args":["([)]"],"expected":-1,"isSample":true},{"id":"bd-3","args":["plain"],"expected":0,"isSample":false},{"id":"bd-4","args":["{{[()]}}"],"expected":4,"isSample":false}],"examples":[{"id":"bd-example","input":"a(b[c{d}])","expected":3,"explanation":{"zh":"最深位置依次位于 (、[、{ 内。","en":"The deepest point is inside (, then [, then {."}}],"constraints":[{"zh":"0 <= text.length <= 100000","en":"0 <= text.length <= 100000"},{"zh":"括号类型为 ()、[]、{}。","en":"Bracket types are (), [], and {}."}],"hints":{"zh":["遇到右括号时，需要知道最近尚未匹配的左括号。","用栈保存左括号，并在每次入栈后更新最大深度。","左括号入栈；右括号检查栈顶并弹出；不匹配或最终非空则返回 -1。"],"en":["A closing bracket must match the most recent unmatched opening bracket.","Store opening brackets in a stack and update depth after every push.","Push openings; for a closing, verify and pop the top; return -1 on mismatch or a non-empty final stack."]},"reviewPoints":[{"zh":"栈适合处理最近未闭合的结构。","en":"A stack tracks the most recently opened structure."},{"zh":"合法性检查包括过程与最终状态。","en":"Validation must check both intermediate and final states."}],"estimatedMinutes":18
  },
  {
    "id":"ac-004","slug":"minimum-processing-rate","title":{"zh":"最小处理速率","en":"Minimum Processing Rate"},"description":{"zh":"给定若干批任务量和总小时数。每小时只能处理一批，最多处理 rate 个单位；求按时完成的最小整数 rate。","en":"Given work batches and an hour limit, only one batch can be processed per hour at up to rate units. Find the minimum integer rate that finishes on time."},"difficulty":"medium","topics":["binary-search"],"entryPoint":"minimumRate","templates":{"javascript":"function minimumRate(batches, hours) {\n  // Return the smallest feasible positive integer rate.\n  \n}","python":"def minimum_rate(batches, hours):\n    # Return the smallest feasible positive integer rate.\n    pass"},"tests":[{"id":"mr-1","args":[[3,6,7,11],8],"expected":4,"isSample":true},{"id":"mr-2","args":[[12,4,8],3],"expected":12,"isSample":true},{"id":"mr-3","args":[[1,1,1],6],"expected":1,"isSample":false},{"id":"mr-4","args":[[30,11,23,4,20],6],"expected":23,"isSample":false}],"examples":[{"id":"mr-example","input":{"batches":[3,6,7,11],"hours":8},"expected":4,"explanation":{"zh":"速率 4 需要 1+2+2+3=8 小时。","en":"Rate 4 needs 1+2+2+3=8 hours."}}],"constraints":[{"zh":"1 <= batches.length <= hours","en":"1 <= batches.length <= hours"},{"zh":"任务量和 hours 均为正整数。","en":"Batch sizes and hours are positive integers."}],"hints":{"zh":["答案越大，完成所需时间不会增加。","在 [1, max(batches)] 上二分第一个可行值。","needed(rate)=sum(ceil(batch/rate))；可行则收缩右边界，否则提高左边界。"],"en":["As the candidate rate grows, required time never increases.","Binary-search the first feasible value in [1, max(batches)].","needed(rate)=sum(ceil(batch/rate)); shrink right when feasible, otherwise raise left."]},"reviewPoints":[{"zh":"二分答案依赖可行性的单调变化。","en":"Binary-searching the answer requires monotonic feasibility."},{"zh":"整数向上取整应避免浮点误差。","en":"Integer ceiling division avoids floating-point errors."}],"estimatedMinutes":22
  },
  {
    "id":"ac-005","slug":"remove-linked-node-from-end","title":{"zh":"删除链表倒数节点","en":"Remove a Linked Node from the End"},"description":{"zh":"数组按顺序表示单链表节点值。删除倒数第 n 个节点并返回剩余节点值；n 保证有效。","en":"An array lists the values of a singly linked list in order. Remove the nth node from the end and return the remaining values; n is valid."},"difficulty":"medium","topics":["linked-list","two-pointers"],"entryPoint":"removeFromEnd","templates":{"javascript":"function removeFromEnd(values, n) {\n  // Treat values as the nodes of a singly linked list.\n  \n}","python":"def remove_from_end(values, n):\n    # Treat values as the nodes of a singly linked list.\n    pass"},"tests":[{"id":"ll-1","args":[[5,8,2,9],2],"expected":[5,8,9],"isSample":true},{"id":"ll-2","args":[[4],1],"expected":[],"isSample":true},{"id":"ll-3","args":[[1,2],2],"expected":[2],"isSample":false},{"id":"ll-4","args":[[1,2,3,4,5],1],"expected":[1,2,3,4],"isSample":false}],"examples":[{"id":"ll-example","input":{"values":[5,8,2,9],"n":2},"expected":[5,8,9],"explanation":{"zh":"倒数第二个节点值为 2。","en":"The second node from the end has value 2."}}],"constraints":[{"zh":"1 <= n <= values.length <= 100000","en":"1 <= n <= values.length <= 100000"},{"zh":"输入数组仅作为链表的可序列化表示。","en":"The input array is only a serializable representation of a linked list."}],"hints":{"zh":["怎样让两个指针始终相隔 n 个节点？","先让快指针前进 n 步，再同步移动快慢指针。","加入虚拟头；fast 先走 n 步，再一起走到 fast.next 为空，删除 slow.next。"],"en":["How can two pointers remain n nodes apart?","Advance a fast pointer n steps, then move fast and slow together.","Use a dummy head; advance fast n steps, move both until fast.next is null, then remove slow.next."]},"reviewPoints":[{"zh":"固定间距双指针可在一次遍历中定位倒数节点。","en":"Fixed-gap pointers locate a node from the end in one pass."},{"zh":"虚拟头节点统一处理删除头节点的边界。","en":"A dummy head unifies deletion at the head boundary."}],"estimatedMinutes":20
  },
  {
    "id":"ac-006","slug":"minimum-energy-path","title":{"zh":"台阶最小能量","en":"Minimum Stair Energy"},"description":{"zh":"从下标 0 出发，每次走 1 或 2 步，进入某级台阶需支付对应能量。返回到达最后一级的最小总能量。","en":"Start at index 0 and move one or two steps. Entering a stair costs its energy. Return the minimum total energy needed to reach the last stair."},"difficulty":"medium","topics":["dynamic-programming"],"entryPoint":"minimumEnergy","templates":{"javascript":"function minimumEnergy(costs) {\n  // The cost at index 0 is paid at the start.\n  \n}","python":"def minimum_energy(costs):\n    # The cost at index 0 is paid at the start.\n    pass"},"tests":[{"id":"dp-1","args":[[2,5,1,3]],"expected":6,"isSample":true},{"id":"dp-2","args":[[4]],"expected":4,"isSample":true},{"id":"dp-3","args":[[1,100,1,1,1]],"expected":4,"isSample":false},{"id":"dp-4","args":[[3,2]],"expected":5,"isSample":false}],"examples":[{"id":"dp-example","input":[2,5,1,3],"expected":6,"explanation":{"zh":"路径 0 → 2 → 3，能量为 2+1+3。","en":"Path 0 → 2 → 3 costs 2+1+3."}}],"constraints":[{"zh":"1 <= costs.length <= 100000","en":"1 <= costs.length <= 100000"},{"zh":"每项能量为非负整数。","en":"Every energy cost is a non-negative integer."}],"hints":{"zh":["到达当前位置的最后一步只可能来自前一阶或前两阶。","定义 dp[i] 为到达 i 并支付 costs[i] 后的最小能量。","dp[0]=cost[0]；dp[1]=cost[0]+cost[1]；dp[i]=cost[i]+min(dp[i-1],dp[i-2])。"],"en":["The last move into a stair comes from either one or two positions back.","Let dp[i] be the minimum energy after reaching and paying for stair i.","dp[0]=cost[0]; dp[1]=cost[0]+cost[1]; dp[i]=cost[i]+min(dp[i-1],dp[i-2])."]},"reviewPoints":[{"zh":"状态定义必须包含已经支付当前成本这一语义。","en":"The state definition must say whether the current cost is already paid."},{"zh":"只依赖前两个状态时可将空间压缩到 O(1)。","en":"Depending on two previous states allows O(1) space."}],"estimatedMinutes":20
  },
  {
    "id":"ac-007","slug":"shortest-grid-exit","title":{"zh":"网格最短出口","en":"Shortest Grid Exit"},"description":{"zh":"网格中 0 可通行、1 为障碍。从起点出发，返回到任一边界格的最少移动次数；起点本身若在边界则返回 0，无路返回 -1。","en":"In a grid, 0 is open and 1 is blocked. Return the fewest moves from the start to any boundary cell. Return 0 if the start is on the boundary and -1 if unreachable."},"difficulty":"medium","topics":["bfs"],"entryPoint":"shortestExit","templates":{"javascript":"function shortestExit(grid, start) {\n  // start is [row, column].\n  \n}","python":"def shortest_exit(grid, start):\n    # start is [row, column].\n    pass"},"tests":[{"id":"bfs-1","args":[[[1,0,1],[0,0,0],[1,1,1]],[1,1]],"expected":1,"isSample":true},{"id":"bfs-2","args":[[[0,0],[0,0]],[0,1]],"expected":0,"isSample":true},{"id":"bfs-3","args":[[[1,1,1],[1,0,1],[1,1,1]],[1,1]],"expected":-1,"isSample":false},{"id":"bfs-4","args":[[[0]],[0,0]],"expected":0,"isSample":false}],"examples":[{"id":"bfs-example","input":{"grid":[[1,0,1],[0,0,0],[1,1,1]],"start":[1,1]},"expected":1,"explanation":{"zh":"向左或向右一步即可到达边界。","en":"One move left or right reaches the boundary."}}],"constraints":[{"zh":"网格为非空矩形，起点可通行。","en":"The grid is a non-empty rectangle and the start is open."},{"zh":"只能上下左右移动。","en":"Movement is limited to four orthogonal directions."}],"hints":{"zh":["无权图的最短步数应按距离逐层探索。","使用队列做 BFS，节点入队时立即标记访问。","队列保存 (r,c,d)；弹出边界格即返回 d；扩展四邻域，队列耗尽返回 -1。"],"en":["Shortest paths in an unweighted graph should be explored level by level.","Use a queue for BFS and mark nodes visited when enqueued.","Queue (r,c,d); return d when a boundary cell is dequeued; add unvisited neighbors and return -1 if exhausted."]},"reviewPoints":[{"zh":"BFS 第一次到达即得到无权图最短距离。","en":"The first BFS arrival gives the shortest unweighted distance."},{"zh":"入队时标记可避免同一节点重复入队。","en":"Marking on enqueue prevents duplicate work."}],"estimatedMinutes":25
  },
  {
    "id":"ac-008","slug":"dependency-cycle","title":{"zh":"依赖关系是否成环","en":"Dependency Cycle Detection"},"description":{"zh":"有 n 个任务，边 [a,b] 表示 a 依赖 b。判断依赖图中是否存在环。","en":"There are n tasks; edge [a,b] means a depends on b. Determine whether the dependency graph contains a cycle."},"difficulty":"medium","topics":["dfs"],"entryPoint":"hasDependencyCycle","templates":{"javascript":"function hasDependencyCycle(n, dependencies) {\n  // dependencies contains [task, prerequisite] pairs.\n  \n}","python":"def has_dependency_cycle(n, dependencies):\n    # dependencies contains [task, prerequisite] pairs.\n    pass"},"tests":[{"id":"dfs-1","args":[3,[[1,0],[2,1]]],"expected":false,"isSample":true},{"id":"dfs-2","args":[3,[[1,0],[2,1],[0,2]]],"expected":true,"isSample":true},{"id":"dfs-3","args":[1,[]],"expected":false,"isSample":false},{"id":"dfs-4","args":[2,[[0,0]]],"expected":true,"isSample":false}],"examples":[{"id":"dfs-example","input":{"n":3,"dependencies":[[1,0],[2,1],[0,2]]},"expected":true,"explanation":{"zh":"0 → 1 → 2 → 0 构成环。","en":"0 → 1 → 2 → 0 forms a cycle."}}],"constraints":[{"zh":"1 <= n <= 100000","en":"1 <= n <= 100000"},{"zh":"任务编号范围为 0 到 n-1。","en":"Task ids range from 0 to n-1."}],"hints":{"zh":["需要区分“从未访问”和“当前搜索路径中”。","DFS 使用三色状态：未访问、访问中、已完成。","进入节点标为 visiting；遇到 visiting 邻居说明有环；退出前标为 complete。"],"en":["Distinguish never visited nodes from nodes in the current search path.","Use three DFS colors: unvisited, visiting, and complete.","Mark a node visiting on entry; a visiting neighbor means a cycle; mark complete on exit."]},"reviewPoints":[{"zh":"有向图成环判断依赖当前递归路径。","en":"Directed-cycle detection depends on the current recursion path."},{"zh":"已完成节点无需重复搜索。","en":"Completed nodes do not need to be searched again."}],"estimatedMinutes":25
  }
]$catalog$::jsonb)
),
upserted_problems AS (
  INSERT INTO "algocoach"."coach_problem" (
    "id", "slug", "owner_user_id", "source", "title", "description",
    "difficulty", "topics", "entry_point", "templates", "examples",
    "constraints", "hints", "review_points", "estimated_minutes",
    "status", "content_version", "updated_at"
  )
  SELECT
    problem->>'id',
    problem->>'slug',
    NULL,
    'curated',
    problem->'title',
    problem->'description',
    problem->>'difficulty',
    ARRAY(SELECT jsonb_array_elements_text(problem->'topics')),
    problem->>'entryPoint',
    problem->'templates',
    problem->'examples',
    problem->'constraints',
    problem->'hints',
    problem->'reviewPoints',
    (problem->>'estimatedMinutes')::smallint,
    'published',
    1,
    now()
  FROM catalog
  ON CONFLICT ("id") DO UPDATE SET
    "slug" = EXCLUDED."slug",
    "source" = EXCLUDED."source",
    "title" = EXCLUDED."title",
    "description" = EXCLUDED."description",
    "difficulty" = EXCLUDED."difficulty",
    "topics" = EXCLUDED."topics",
    "entry_point" = EXCLUDED."entry_point",
    "templates" = EXCLUDED."templates",
    "examples" = EXCLUDED."examples",
    "constraints" = EXCLUDED."constraints",
    "hints" = EXCLUDED."hints",
    "review_points" = EXCLUDED."review_points",
    "estimated_minutes" = EXCLUDED."estimated_minutes",
    "status" = EXCLUDED."status",
    "content_version" = EXCLUDED."content_version",
    "updated_at" = now()
  RETURNING "id"
),
catalog_tests AS (
  SELECT
    problem->>'id' AS problem_id,
    test_case,
    (ordinality - 1)::smallint AS ordinal
  FROM catalog
  CROSS JOIN LATERAL jsonb_array_elements(problem->'tests')
    WITH ORDINALITY AS test_rows(test_case, ordinality)
)
INSERT INTO "algocoach"."coach_test_case" (
  "id", "problem_id", "ordinal", "args", "expected", "is_sample",
  "label", "timeout_ms", "updated_at"
)
SELECT
  test_case->>'id',
  problem_id,
  ordinal,
  test_case->'args',
  test_case->'expected',
  COALESCE((test_case->>'isSample')::boolean, false),
  test_case->'label',
  3000,
  now()
FROM catalog_tests
CROSS JOIN (SELECT count(*) FROM upserted_problems) AS seeded
ON CONFLICT ("id") DO UPDATE SET
  "problem_id" = EXCLUDED."problem_id",
  "ordinal" = EXCLUDED."ordinal",
  "args" = EXCLUDED."args",
  "expected" = EXCLUDED."expected",
  "is_sample" = EXCLUDED."is_sample",
  "label" = EXCLUDED."label",
  "timeout_ms" = EXCLUDED."timeout_ms",
  "updated_at" = now();
