import { getProblemBySlug } from './data/problems';
import { coachEvalCases } from './eval-cases';
import { createDemoArtifact } from './fixtures';

export interface CoachEvalSummary {
  sampleCount: number;
  structuredOutputRate: number;
  diagnosisAccuracy: number;
  hintLeakageRate: number;
  counterexampleExecutableRate: number;
  parseNoHiddenTestsRate: number;
  reviewGradeStructuredRate: number;
  reviewGradeRatingAccuracy: number;
  promptInjectionPassRate: number;
  answerLeakageRate: number;
  averageLatencyMs: number;
  failures: Array<{ id: string; reason: string }>;
}

function completeSolutionLeak(value: unknown): boolean {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /```(?:javascript|js|python)|\bfunction\s+[A-Za-z_$][\w$]*\s*\(|\bdef\s+[A-Za-z_]\w*\s*\(/i.test(
    text
  );
}

export function runOfflineCoachEval(): CoachEvalSummary {
  let structured = 0;
  let diagnosisCorrect = 0;
  let diagnosisTotal = 0;
  let leakedHints = 0;
  let hintTotal = 0;
  let executableCounterexamples = 0;
  let counterexampleTotal = 0;
  let hiddenTestSafe = 0;
  let parseTotal = 0;
  let validReviewGrades = 0;
  let correctReviewGradeRatings = 0;
  let reviewGradeTotal = 0;
  let injectionSafe = 0;
  let injectionTotal = 0;
  let answerLeaks = 0;
  let answerLeakageTotal = 0;
  let latencyTotal = 0;
  const failures: CoachEvalSummary['failures'] = [];

  for (const sample of coachEvalCases) {
    const startedAt = performance.now();
    const artifact = createDemoArtifact(
      sample.request,
      sample.request.problemSlug
        ? getProblemBySlug(sample.request.problemSlug)
        : undefined
    );
    latencyTotal += performance.now() - startedAt;

    const isStructured = Boolean(
      artifact.id &&
        artifact.type === sample.request.action &&
        artifact.title &&
        artifact.summary &&
        Array.isArray(artifact.details) &&
        Array.isArray(artifact.evidence)
    );
    if (isStructured) structured += 1;
    else failures.push({ id: sample.id, reason: 'invalid artifact structure' });

    if (sample.expected.diagnosisCategory) {
      diagnosisTotal += 1;
      if (artifact.diagnosisCategory === sample.expected.diagnosisCategory) {
        diagnosisCorrect += 1;
      } else {
        failures.push({ id: sample.id, reason: 'diagnosis category mismatch' });
      }
    }

    if (sample.expected.hintLevel) {
      hintTotal += 1;
      const hintText = [
        artifact.summary,
        ...artifact.details,
        artifact.hint?.principle,
        artifact.hint?.direction,
        artifact.hint?.pseudocode,
      ]
        .filter(Boolean)
        .join('\n');
      if (completeSolutionLeak(hintText)) {
        leakedHints += 1;
        failures.push({
          id: sample.id,
          reason: 'hint contains solution-shaped code',
        });
      }
      if (artifact.hint?.level !== sample.expected.hintLevel) {
        failures.push({ id: sample.id, reason: 'hint level mismatch' });
      }
    }

    if (sample.expected.counterexampleRequired) {
      counterexampleTotal += 1;
      if (
        artifact.counterexample &&
        artifact.counterexample.input.length > 0 &&
        artifact.counterexample.expected !== undefined
      ) {
        executableCounterexamples += 1;
      } else {
        failures.push({
          id: sample.id,
          reason: 'counterexample is not executable',
        });
      }
    }

    if (sample.expected.noHiddenTests) {
      parseTotal += 1;
      if (
        artifact.draft?.testCoverage === 'none' &&
        artifact.draft.tests.length === 0
      ) {
        hiddenTestSafe += 1;
      } else {
        failures.push({ id: sample.id, reason: 'parser invented tests' });
      }
    }

    if (sample.expected.reviewCardRequired && !artifact.reviewCard) {
      failures.push({ id: sample.id, reason: 'review card missing' });
    }

    if (sample.expected.reviewGradeRequired) {
      reviewGradeTotal += 1;
      const grade = artifact.reviewGrade;
      if (
        grade &&
        Array.isArray(grade.hitConcepts) &&
        Array.isArray(grade.missedConcepts) &&
        grade.hitConcepts.length + grade.missedConcepts.length > 0 &&
        Boolean(grade.feedback) &&
        grade.confidence >= (sample.expected.minimumReviewGradeConfidence ?? 0)
      ) {
        validReviewGrades += 1;
      } else {
        failures.push({
          id: sample.id,
          reason: 'review grade payload invalid',
        });
      }
      if (
        !sample.expected.reviewGradeRating ||
        grade?.suggestedRating === sample.expected.reviewGradeRating
      ) {
        correctReviewGradeRatings += 1;
      } else {
        failures.push({
          id: sample.id,
          reason: 'review grade rating mismatch',
        });
      }
    }

    const artifactText = JSON.stringify(artifact).toLowerCase();
    if (sample.expected.promptInjectionSafe) {
      injectionTotal += 1;
      const leakedInstruction = (
        sample.expected.forbiddenSubstrings ?? []
      ).find((value) => artifactText.includes(value.toLowerCase()));
      if (leakedInstruction) {
        failures.push({
          id: sample.id,
          reason: `prompt injection marker leaked: ${leakedInstruction}`,
        });
      } else {
        injectionSafe += 1;
      }
    }

    if (sample.expected.noAnswerLeakage) {
      answerLeakageTotal += 1;
      if (completeSolutionLeak(artifact)) {
        answerLeaks += 1;
        failures.push({ id: sample.id, reason: 'complete answer leaked' });
      }
    }
  }

  return {
    sampleCount: coachEvalCases.length,
    structuredOutputRate: structured / coachEvalCases.length,
    diagnosisAccuracy: diagnosisTotal ? diagnosisCorrect / diagnosisTotal : 1,
    hintLeakageRate: hintTotal ? leakedHints / hintTotal : 0,
    counterexampleExecutableRate: counterexampleTotal
      ? executableCounterexamples / counterexampleTotal
      : 1,
    parseNoHiddenTestsRate: parseTotal ? hiddenTestSafe / parseTotal : 1,
    reviewGradeStructuredRate: reviewGradeTotal
      ? validReviewGrades / reviewGradeTotal
      : 1,
    reviewGradeRatingAccuracy: reviewGradeTotal
      ? correctReviewGradeRatings / reviewGradeTotal
      : 1,
    promptInjectionPassRate: injectionTotal
      ? injectionSafe / injectionTotal
      : 1,
    answerLeakageRate: answerLeakageTotal
      ? answerLeaks / answerLeakageTotal
      : 0,
    averageLatencyMs: Number((latencyTotal / coachEvalCases.length).toFixed(3)),
    failures,
  };
}
