import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createCatalogWorkspace } from './pipeline';
import type { CatalogWorkspace } from './raw-types';

export async function readCatalogWorkspace(
  workspacePath: string
): Promise<CatalogWorkspace> {
  try {
    const parsed = JSON.parse(await readFile(workspacePath, 'utf8')) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      !Array.isArray((parsed as { candidates?: unknown }).candidates) ||
      !Array.isArray((parsed as { releases?: unknown }).releases) ||
      !Array.isArray((parsed as { audit?: unknown }).audit)
    ) {
      throw new Error('Unsupported or malformed catalog workspace.');
    }
    return parsed as CatalogWorkspace;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createCatalogWorkspace();
    }
    throw error;
  }
}

export async function writeCatalogWorkspace(
  workspacePath: string,
  workspace: CatalogWorkspace
): Promise<void> {
  const directory = path.dirname(workspacePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${workspacePath}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(workspace, null, 2)}\n`,
    'utf8'
  );
  await rename(temporaryPath, workspacePath);
}
