// Copies the backend's built API payloads into public/api/ so the frontend can be
// deployed to a static host (Netlify, GitHub Pages, S3) with no server.
//
// This is sound because every FastAPI route is a pure passthrough of one JSON file
// (`return _load("districts.json")`). The files ARE the API contract, so serving
// them directly is equivalent to running the backend — for reads, which is all the
// dashboard does.
//
// Run:  npm run export:api      (and it runs automatically as part of `npm run build:static`)
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../backend/data/processed/api');
const OUT = resolve(here, '../public/api');

if (!existsSync(SRC)) {
  console.error(`\n[export:api] Backend payloads not found at:\n  ${SRC}\n`);
  console.error('Build them first:\n  cd backend && python -m pipeline.run\n');
  process.exit(1);
}

const files = (await readdir(SRC)).filter((f) => f.endsWith('.json'));
if (!files.length) {
  console.error(`[export:api] No .json payloads in ${SRC}. Run: python -m pipeline.run`);
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let bytes = 0;
for (const f of files) {
  await cp(join(SRC, f), join(OUT, f));
  bytes += (await stat(join(SRC, f))).size;
}

console.log(`[export:api] ${files.length} payloads -> public/api/ (${(bytes / 1024).toFixed(0)} KB)`);
