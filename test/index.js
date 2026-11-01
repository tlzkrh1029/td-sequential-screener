// Makes `node --test test/` (the npm test script) work on Node 22+, which runs a directory argument as one module:
// Node resolves the directory to this file. Node 20 searches the directory instead and runs every file here, and
// plain `node --test` finds the *.test.mjs files itself; in those cases this file runs directly and loads nothing,
// so no test runs twice.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) !== here) {
  for (const f of readdirSync(path.dirname(here)).filter((name) => name.endsWith('.test.mjs')).sort()) await import(`./${f}`);
}
