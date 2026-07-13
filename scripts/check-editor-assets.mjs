import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEBIBYTE = 1024 * 1024;
const budgets = [
  { label: 'Monaco', directory: 'public/monaco', maxBytes: 16 * MEBIBYTE },
  { label: 'Pyodide', directory: 'public/pyodide', maxBytes: 14 * MEBIBYTE },
];

async function directorySize(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? directorySize(target)
        : (await stat(target)).size;
    })
  );
  return sizes.reduce((total, size) => total + size, 0);
}

let failed = false;
for (const budget of budgets) {
  const bytes = await directorySize(path.join(root, budget.directory));
  const actual = (bytes / MEBIBYTE).toFixed(2);
  const limit = (budget.maxBytes / MEBIBYTE).toFixed(0);
  console.log(`${budget.label}: ${actual} MiB / ${limit} MiB`);
  if (bytes > budget.maxBytes) {
    failed = true;
    console.error(`${budget.label} exceeds its checked-in asset budget.`);
  }
}

if (failed) process.exit(1);
