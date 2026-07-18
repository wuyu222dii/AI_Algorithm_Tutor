import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(root, process.env.NEXT_DIST_DIR ?? '.next');
const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * KIBIBYTE;
const ROUTE_JS_GZIP_LIMIT = 200 * KIBIBYTE;
const WORKER_ASSET_LIMIT = 6 * MEBIBYTE;
const coachLayoutModule = '[project]/src/app/[locale]/(coach)/layout';
const forbiddenRuntimeMarkers = [
  'node_modules/.pnpm/@monaco-editor+react',
  'node_modules/.pnpm/monaco-editor@',
  'node_modules/.pnpm/quickjs-emscripten@',
  'node_modules/.pnpm/pyodide@',
  'node_modules/.pnpm/typescript@',
];
const routes = [
  { segment: 'learn', component: 'learn-page.tsx' },
  { segment: 'problems', component: 'problems-page.tsx' },
  { segment: 'progress', component: 'progress-page.tsx' },
  { segment: 'review', component: 'review-page.tsx' },
];

function formatKib(bytes) {
  return `${(bytes / KIBIBYTE).toFixed(1)} KiB`;
}

function normalizeChunk(chunk) {
  const normalized = chunk.replace(/^\/_next\//, '').replace(/^\//, '');
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function chunkFiles(chunks = []) {
  return chunks
    .filter((chunk) => typeof chunk === 'string' && /\.(?:js|mjs)$/.test(chunk))
    .map(normalizeChunk);
}

async function loadRouteManifest(segment) {
  const manifestPath = path.join(
    distDir,
    'server/app/[locale]/(coach)',
    segment,
    'page_client-reference-manifest.js'
  );
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Missing production manifest for /${segment}. Run "pnpm build" before this check.`
    );
  }
  const source = await readFile(manifestPath, 'utf8');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(source, sandbox, { filename: manifestPath });
  const manifests = Object.values(sandbox.globalThis.__RSC_MANIFEST ?? {});
  if (manifests.length !== 1) {
    throw new Error(`Unexpected RSC manifest shape for /${segment}.`);
  }
  return { manifest: manifests[0], manifestPath, source };
}

function chunksForComponent(manifest, component) {
  const suffix = `/src/features/algorithm-coach/components/${component}`;
  const entry = Object.entries(manifest.clientModules ?? {}).find(
    ([key]) => key.endsWith(suffix) && !key.endsWith('<module evaluation>')
  );
  if (!entry) {
    throw new Error(
      `Client component ${component} is absent from the manifest.`
    );
  }
  return [...new Set(chunkFiles(entry[1].chunks))];
}

async function gzipSize(file) {
  return gzipSync(await readFile(file)).byteLength;
}

async function routeChecks(route) {
  const { manifest, manifestPath, source } = await loadRouteManifest(
    route.segment
  );
  const componentChunks = chunksForComponent(manifest, route.component);
  const layoutChunks = new Set(
    chunkFiles(manifest.entryJSFiles?.[coachLayoutModule])
  );
  const routeOwnedChunks = componentChunks.filter(
    (chunk) => !layoutChunks.has(chunk)
  );
  const routeOwnedGzip = (
    await Promise.all(
      routeOwnedChunks.map((chunk) =>
        gzipSize(path.join(distDir, normalizeChunk(chunk)))
      )
    )
  ).reduce((total, size) => total + size, 0);
  const rscManifestGzip = gzipSync(source).byteLength;

  if (routeOwnedGzip > ROUTE_JS_GZIP_LIMIT) {
    throw new Error(
      `/${route.segment} route-owned JS is ${formatKib(routeOwnedGzip)}; limit is ${formatKib(ROUTE_JS_GZIP_LIMIT)}.`
    );
  }
  for (const chunk of componentChunks) {
    const content = await readFile(path.join(distDir, chunk), 'utf8');
    const forbidden = forbiddenRuntimeMarkers.find((marker) =>
      content.includes(marker)
    );
    if (forbidden) {
      throw new Error(
        `/${route.segment} includes execution-only dependency ${forbidden} in ${chunk}.`
      );
    }
  }

  console.log(
    `/${route.segment}: route JS ${formatKib(routeOwnedGzip)} gzip, client-reference manifest ${formatKib(rscManifestGzip)} gzip (${path.relative(root, manifestPath)})`
  );
}

async function workerAssetCheck() {
  const staticDir = path.join(distDir, 'static');
  const chunkDir = path.join(staticDir, 'chunks');
  const mediaDir = path.join(staticDir, 'media');
  const workerFiles = [];

  if (existsSync(chunkDir)) {
    for (const name of await readdir(chunkDir)) {
      if (name.startsWith('turbopack-worker-') && name.endsWith('.js')) {
        workerFiles.push(path.join(chunkDir, name));
      }
    }
  }
  if (existsSync(mediaDir)) {
    for (const name of await readdir(mediaDir)) {
      if (
        name.startsWith('runner.worker.') ||
        name.startsWith('emscripten-module.') ||
        name.startsWith('index.')
      ) {
        workerFiles.push(path.join(mediaDir, name));
      }
    }
  }
  if (!workerFiles.length) {
    throw new Error(
      'No JavaScript/TypeScript runner Worker assets were found.'
    );
  }
  const total = (
    await Promise.all(workerFiles.map(async (file) => (await stat(file)).size))
  ).reduce((sum, size) => sum + size, 0);
  if (total > WORKER_ASSET_LIMIT) {
    throw new Error(
      `Runner Worker assets total ${(total / MEBIBYTE).toFixed(2)} MiB; limit is ${WORKER_ASSET_LIMIT / MEBIBYTE} MiB.`
    );
  }
  console.log(
    `Runner Worker assets: ${(total / MEBIBYTE).toFixed(2)} MiB / ${WORKER_ASSET_LIMIT / MEBIBYTE} MiB`
  );
}

try {
  for (const route of routes) await routeChecks(route);
  await workerAssetCheck();
} catch (error) {
  console.error(
    `[budget:coach] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}
