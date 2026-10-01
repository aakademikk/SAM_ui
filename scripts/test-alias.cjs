'use strict';

/**
 * SAM — `@/` alias resolver for the compiled test graph.
 *
 * `tsconfig.test.json` emits `src/**\/*.test.ts` (and whatever it imports) to
 * `.test-build/` as plain CommonJS. `tsc` never rewrites import specifiers,
 * so an `import ... from '@/lib/x'` in the source becomes a literal
 * `require("@/lib/x")` in the emitted JS — a request Node cannot resolve on
 * its own, because `@/` is a TypeScript path mapping (tsconfig.json ->
 * compilerOptions.paths), not something Node's module resolution knows about.
 *
 * `node --require ./scripts/test-alias.cjs` loads this before `--test` runs,
 * so every `.test-build/**\/*.test.js` file (and everything it pulls in) goes
 * through the hook below. This intentionally mirrors only the one mapping
 * the project's tsconfig declares (`@/*` -> `./src/*`, emitted to
 * `.test-build/*`) rather than pulling in a bundler.
 */

const Module = require('module');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const testBuildDir = path.join(repoRoot, '.test-build');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilenameWithAlias(request, parent, isMain, options) {
  if (request === '@/' || request.startsWith('@/')) {
    const mapped = path.join(testBuildDir, request.slice(2));
    return originalResolveFilename.call(this, mapped, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
