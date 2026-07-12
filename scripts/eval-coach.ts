import { runOfflineCoachEval } from '../src/features/algorithm-coach/eval';

const summary = runOfflineCoachEval();

console.log(JSON.stringify(summary, null, 2));

const passed =
  summary.sampleCount === 20 &&
  summary.structuredOutputRate === 1 &&
  summary.diagnosisAccuracy === 1 &&
  summary.hintLeakageRate === 0 &&
  summary.counterexampleExecutableRate === 1 &&
  summary.parseNoHiddenTestsRate === 1;

if (!passed) process.exitCode = 1;
