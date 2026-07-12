import { coachEvalCases } from './eval-cases';
import { createDemoArtifact } from './fixtures';

export interface CoachEvalSummary {
  sampleCount: number;
  structuredOutputRate: number;
  diagnosisAccuracy: number;
  hintLeakageRate: number;
  counterexampleExecutableRate: number;
  parseNoHiddenTestsRate: number;
  averageLatencyMs: number;
  failures: Array<{ id: string; reason: string }>;
}

function completeSolutionLeak(text: string): boolean {
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
  let latencyTotal = 0;
  const failures: CoachEvalSummary['failures'] = [];

  for (const sample of coachEvalCases) {
    const startedAt = performance.now();
    const artifact = createDemoArtifact(sample.request);
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
    averageLatencyMs: Number((latencyTotal / coachEvalCases.length).toFixed(3)),
    failures,
  };
}
