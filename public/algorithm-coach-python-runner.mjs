import { loadPyodide } from '/pyodide/pyodide.mjs';

const PYTHON_HARNESS = String.raw`
import contextlib
import io
import json
import time

def _normalize(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return repr(value)

tests = json.loads(__tests_json)
namespace = {}
stdout = io.StringIO()
stderr = io.StringIO()
results = []
status = "passed"
top_error = None

try:
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        exec(__user_code, namespace)
    entry = namespace.get(__entry_point)
    if not callable(entry):
        raise RuntimeError(f"Expected function {__entry_point} was not defined.")

    for test in tests:
        started_at = time.perf_counter()
        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                actual = entry(*test["args"])
            passed = actual == test["expected"]
            results.append({
                "testId": test["id"],
                "passed": passed,
                "expected": test["expected"],
                "actual": _normalize(actual),
                "durationMs": round((time.perf_counter() - started_at) * 1000, 3),
            })
            if not passed and status == "passed":
                status = "failed"
        except Exception as exc:
            status = "runtime_error"
            results.append({
                "testId": test["id"],
                "passed": False,
                "expected": test["expected"],
                "error": f"{type(exc).__name__}: {exc}",
                "durationMs": round((time.perf_counter() - started_at) * 1000, 3),
            })
except SyntaxError as exc:
    status = "syntax_error"
    top_error = f"SyntaxError: {exc}"
except Exception as exc:
    status = "runtime_error"
    top_error = f"{type(exc).__name__}: {exc}"

console_lines = [
    line
    for line in (stdout.getvalue() + stderr.getvalue()).splitlines()
    if line
]
json.dumps({
    "status": status,
    "testResults": results,
    "console": console_lines,
    "error": top_error,
})
`;

function selectedTests(problem, scope) {
  return scope === 'all'
    ? problem.tests
    : problem.tests.filter((test) => test.isSample);
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function errorMessage(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

self.onmessage = async (event) => {
  try {
    const { problem, code, scope } = event.data;
    const tests = selectedTests(problem, scope);
    const pyodide = await loadPyodide({ indexURL: '/pyodide/' });
    self.postMessage({ type: 'ready' });
    const startedAt = performance.now();

    pyodide.globals.set('__user_code', code);
    pyodide.globals.set('__tests_json', JSON.stringify(tests));
    pyodide.globals.set('__entry_point', camelToSnake(problem.entryPoint));

    try {
      const rawResult = await pyodide.runPythonAsync(PYTHON_HARNESS);
      const result = JSON.parse(String(rawResult));
      self.postMessage({
        type: 'result',
        payload: {
          status: result.status,
          passedTests: result.testResults.filter((test) => test.passed).length,
          totalTests: tests.length,
          testResults: result.testResults,
          console: result.console,
          error: result.error || undefined,
          durationMs:
            Math.round((performance.now() - startedAt) * 100) / 100,
        },
      });
    } finally {
      pyodide.globals.delete('__user_code');
      pyodide.globals.delete('__tests_json');
      pyodide.globals.delete('__entry_point');
    }
  } catch (error) {
    self.postMessage({ type: 'fatal', error: errorMessage(error) });
  }
};
