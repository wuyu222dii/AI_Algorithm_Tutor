import { copyFile, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules', 'pyodide');
const destination = path.join(root, 'public', 'pyodide');
const assets = [
  'pyodide.mjs',
  'pyodide-lock.json',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
];

await mkdir(destination, { recursive: true });
await Promise.all(
  assets.map((asset) =>
    copyFile(path.join(source, asset), path.join(destination, asset))
  )
);

await mkdir(path.join(root, 'public', 'monaco'), { recursive: true });
await cp(
  path.join(root, 'node_modules', 'monaco-editor', 'min', 'vs'),
  path.join(root, 'public', 'monaco', 'vs'),
  { recursive: true, force: true }
);
