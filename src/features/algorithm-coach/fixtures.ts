import { getLocalizedProblem, getProblemBySlug } from './data/problems';
import { parseProblemDraft } from './parser';
import {
  CoachChatRequest,
  CoachLocale,
  CoachRequest,
  CodeRunResult,
  DiagnosisCategory,
  JsonValue,
  LearningArtifact,
  LocalizedProblem,
} from './types';

function artifactId(type: string): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  return `${type}_${suffix}`;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveProblem(request: CoachRequest): LocalizedProblem | undefined {
  const slug = request.problemSlug ?? request.problem?.slug;
  return slug ? getLocalizedProblem(slug, request.locale ?? 'zh') : undefined;
}

function baseArtifact(
  request: CoachRequest,
  title: string,
  summary: string
): LearningArtifact {
  return {
    id: artifactId(request.action),
    type: request.action,
    locale: request.locale ?? 'zh',
    problemSlug: request.problemSlug ?? request.problem?.slug,
    title,
    summary,
    details: [],
    evidence: [],
    createdAt: new Date().toISOString(),
  };
}

function firstFailedTest(result?: CodeRunResult) {
  return result?.testResults.find((test) => !test.passed);
}

function diagnoseCategory(result: CodeRunResult): DiagnosisCategory {
  if (result.status === 'syntax_error') return 'syntax';
  if (result.status === 'runtime_error') return 'runtime';
  if (result.status === 'timeout') return 'timeout';
  const failed = firstFailedTest(result);
  if (
    Array.isArray(failed?.actual) &&
    (failed.actual.length === 0 || failed.actual.length === 1)
  ) {
    return 'edge-case';
  }
  return result.status === 'failed' ? 'wrong-answer' : 'unknown';
}

function createDiagnosis(request: CoachRequest): LearningArtifact {
  const locale = request.locale ?? 'zh';
  const result = request.runResult;
  const failed = firstFailedTest(result);
  const category = result ? diagnoseCategory(result) : 'unknown';
  const titleMap: Record<DiagnosisCategory, [string, string]> = {
    syntax: ['语法错误定位', 'Syntax error located'],
    runtime: ['运行时错误定位', 'Runtime error located'],
    timeout: ['执行超时分析', 'Timeout analysis'],
    'wrong-answer': ['输出与预期不一致', 'Output differs from expected'],
    'edge-case': ['边界条件可能遗漏', 'A boundary case may be missing'],
    unknown: ['需要更多运行证据', 'More run evidence is needed'],
  };
  const [zhTitle, enTitle] = titleMap[category];
  const title = locale === 'zh' ? zhTitle : enTitle;
  const evidence: string[] = [];

  if (result?.error) evidence.push(result.error);
  if (failed?.error) evidence.push(failed.error);
  if (failed && !failed.error) {
    evidence.push(
      locale === 'zh'
        ? `测试 ${failed.testId}：期望 ${stringify(failed.expected)}，实际 ${stringify(failed.actual)}。`
        : `Test ${failed.testId}: expected ${stringify(failed.expected)}, received ${stringify(failed.actual)}.`
    );
  }

  const summary = result
    ? locale === 'zh'
      ? `本次运行通过 ${result.passedTests}/${result.totalTests} 个测试；诊断只依据上方真实运行结果。`
      : `This run passed ${result.passedTests}/${result.totalTests} tests; the diagnosis uses only the run evidence above.`
    : locale === 'zh'
      ? '尚无可验证的运行结果。'
      : 'No verifiable run result is available.';

  return {
    ...baseArtifact(request, title, summary),
    diagnosisCategory: category,
    evidence,
    details:
      category === 'timeout'
        ? [
            locale === 'zh'
              ? '检查循环退出条件，并确认每轮都在缩小问题规模。'
              : 'Check loop exits and verify each iteration reduces the problem size.',
          ]
        : category === 'syntax' || category === 'runtime'
          ? [
              locale === 'zh'
                ? '从错误信息指向的位置开始，先修复最早出现的错误再重新运行。'
                : 'Start at the reported location, fix the earliest error, then run again.',
            ]
          : [
              locale === 'zh'
                ? '用失败输入逐步跟踪关键变量，找到首次偏离预期的位置。'
                : 'Trace key variables on the failing input and find the first divergence.',
            ],
    nextAction:
      locale === 'zh'
        ? '先做一处最小修改，再重新运行同一测试。'
        : 'Make one minimal change, then rerun the same test.',
  };
}

function createHint(request: CoachRequest): LearningArtifact {
  const locale = request.locale ?? 'zh';
  const problem = resolveProblem(request);
  const level = request.hintLevel ?? 1;
  const generic = [
    locale === 'zh'
      ? '先明确输入、输出与必须保持的不变量。'
      : 'Clarify the input, output, and invariant you must preserve.',
    locale === 'zh'
      ? '把暴力过程拆成可复用的状态或单调步骤。'
      : 'Break the brute-force process into reusable state or monotonic steps.',
    locale === 'zh'
      ? '写出状态初始化、循环条件、状态更新和返回值四部分伪代码。'
      : 'Write pseudocode for initialization, loop condition, state update, and return value.',
  ] as const;
  const hint = problem?.hints[level - 1] ?? generic[level - 1];
  const title = locale === 'zh' ? `第 ${level} 级提示` : `Hint level ${level}`;
  const limitation = !problem
    ? locale === 'zh'
      ? '自定义题在离线模式下只能提供通用解题框架。'
      : 'Offline mode can only offer a general framework for custom problems.'
    : '';

  return {
    ...baseArtifact(request, title, hint),
    details: limitation ? [limitation] : [],
    evidence: [],
    hint: {
      level,
      principle: hint,
      direction: level >= 2 ? hint : undefined,
      pseudocode: level === 3 ? hint : undefined,
    },
    nextAction:
      locale === 'zh'
        ? '根据这一层提示补全一个关键步骤，再运行代码。'
        : 'Implement one key step from this hint, then run the code.',
  };
}

function createCounterexample(request: CoachRequest): LearningArtifact {
  const locale = request.locale ?? 'zh';
  const failed = firstFailedTest(request.runResult);
  const problemSlug = request.problemSlug ?? request.problem?.slug;
  const knownProblem = problemSlug ? getProblemBySlug(problemSlug) : undefined;
  const observedTest = failed
    ? knownProblem?.tests.find((test) => test.id === failed.testId)
    : undefined;
  const curated = knownProblem?.tests.find((test) => !test.isSample);
  const source = failed
    ? {
        args: observedTest?.args ?? ([] as JsonValue[]),
        expected: failed.expected,
        actual: failed.actual,
        id: failed.testId,
      }
    : curated
      ? { args: curated.args, expected: curated.expected, id: curated.id }
      : null;
  const explanation = source
    ? locale === 'zh'
      ? `请手动跟踪测试 ${source.id}，重点观察边界初始化和返回条件。`
      : `Trace test ${source.id}, focusing on boundary initialization and return conditions.`
    : locale === 'zh'
      ? '自定义题的离线模式不会编造输入；请先运行一个可验证测试。'
      : 'Offline mode will not invent custom inputs; run a verifiable test first.';

  return {
    ...baseArtifact(
      request,
      locale === 'zh' ? '反例检查' : 'Counterexample check',
      explanation
    ),
    details: [explanation],
    evidence: failed
      ? [
          locale === 'zh'
            ? `真实失败测试：${failed.testId}`
            : `Observed failing test: ${failed.testId}`,
        ]
      : [],
    counterexample: {
      input: source?.args ?? [],
      expected: source?.expected as JsonValue | undefined,
      actual: source?.actual as JsonValue | undefined,
      explanation,
    },
    nextAction:
      locale === 'zh'
        ? '在纸上逐步执行这个输入，再与代码中的变量变化对照。'
        : 'Execute this input by hand and compare each step with your variables.',
  };
}

function createReviewCard(request: CoachRequest): LearningArtifact {
  const locale = request.locale ?? 'zh';
  const problem = resolveProblem(request);
  const title =
    problem?.title ??
    request.problem?.title ??
    (locale === 'zh' ? '自定义题' : 'Custom problem');
  const points = problem?.reviewPoints ?? [
    locale === 'zh'
      ? '记录本题的状态定义、边界条件和复杂度。'
      : 'Record the state definition, boundaries, and complexity.',
  ];
  const back = points.join(locale === 'zh' ? '；' : '; ');

  return {
    ...baseArtifact(
      request,
      locale === 'zh' ? '复习卡片' : 'Review card',
      locale === 'zh'
        ? `围绕“${title}”整理的复习要点。`
        : `Review notes for “${title}”.`
    ),
    details: points,
    evidence: request.runResult
      ? [
          locale === 'zh'
            ? `最近运行：${request.runResult.passedTests}/${request.runResult.totalTests} 通过。`
            : `Latest run: ${request.runResult.passedTests}/${request.runResult.totalTests} passed.`,
        ]
      : [],
    reviewCard: {
      front:
        locale === 'zh'
          ? `${title} 的核心思路和易错点是什么？`
          : `What are the core idea and common pitfall for ${title}?`,
      back,
      tags: problem?.topics ?? [],
    },
    nextAction:
      locale === 'zh'
        ? '明天不看答案复述一次，并重做一个边界测试。'
        : 'Recall it tomorrow without notes and redo one boundary test.',
  };
}

export function createDemoArtifact(request: CoachRequest): LearningArtifact {
  const locale = request.locale ?? 'zh';
  if (request.action === 'parse') {
    const draft = parseProblemDraft(request.statement ?? '', locale);
    return {
      ...baseArtifact(
        request,
        locale === 'zh' ? '题面解析草稿' : 'Parsed problem draft',
        locale === 'zh'
          ? '已提取基础结构，需由你确认签名、约束与测试。'
          : 'The basic structure is extracted; verify the signature, constraints, and tests.'
      ),
      details: draft.warnings,
      evidence: [],
      draft,
      nextAction:
        locale === 'zh'
          ? '确认草稿后，至少添加一个样例测试。'
          : 'Confirm the draft and add at least one sample test.',
    };
  }
  if (request.action === 'diagnose') return createDiagnosis(request);
  if (request.action === 'hint') return createHint(request);
  if (request.action === 'counterexample') return createCounterexample(request);
  return createReviewCard(request);
}

export function createDemoChatResponse(request: CoachChatRequest): string {
  const locale: CoachLocale = request.locale ?? 'zh';
  const problemSlug = request.problemSlug ?? request.problem?.slug;
  const problem = problemSlug
    ? getLocalizedProblem(problemSlug, locale)
    : undefined;
  const lastMessage = request.messages.at(-1)?.content.toLowerCase() ?? '';
  const failed = firstFailedTest(request.runResult);

  if (failed) {
    return locale === 'zh'
      ? `先聚焦真实失败测试 ${failed.testId}：期望 ${stringify(failed.expected)}，实际 ${stringify(failed.actual)}。请告诉我这组输入执行到哪个变量时第一次偏离预期，我会继续追问，不直接给出完整答案。`
      : `Focus on observed failing test ${failed.testId}: expected ${stringify(failed.expected)}, received ${stringify(failed.actual)}. Tell me which variable first diverges while tracing it, and I will guide you without giving the full solution.`;
  }
  if (/复杂度|complexity|big.?o/.test(lastMessage)) {
    return locale === 'zh'
      ? '先分别数清楚输入被遍历了几次，以及额外数据结构最多保存多少项。把你的时间、空间复杂度判断发给我，我来帮你校验。'
      : 'Count how many times the input is traversed and how many items the extra data structure can hold. Share your time and space estimates and I will check them.';
  }
  if (problem) {
    return locale === 'zh'
      ? `我们先不写完整答案。针对“${problem.title}”，请用一句话说明：当前状态需要保存什么，以及每一步如何让问题规模变小？`
      : `Let us avoid the full answer. For “${problem.title}”, explain in one sentence what state you need and how each step makes the remaining problem smaller.`;
  }
  return locale === 'zh'
    ? '离线模式可以帮你澄清思路，但不会假装理解未验证的自定义测试。请补充函数签名和一组输入、期望输出。'
    : 'Offline mode can clarify your reasoning but will not pretend to know unverified custom tests. Add the function signature and one input with its expected output.';
}
