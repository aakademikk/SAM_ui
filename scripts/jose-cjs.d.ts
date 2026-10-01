/**
 * Test-build only (tsconfig.test.json maps "jose" here).
 *
 * The test graph compiles to CommonJS, and jose is ESM-only, so tsc refuses a
 * plain `import { SignJWT } from 'jose'` in a CJS file (TS1479) even though
 * this Node (22.12+, unflagged require(esm)) loads it fine at runtime. Review
 * finding 2's route test needs the real session signing chain
 * (`auth/session.ts`), so this re-declares the two values that file uses,
 * typed from jose's own .d.ts. The app's build and `npm run typecheck` never
 * see this file — tsconfig.json has no such mapping.
 */
import type * as Jose from '../node_modules/jose/dist/types/index.js';

export declare const SignJWT: typeof Jose.SignJWT;
export type SignJWT = Jose.SignJWT;
export declare const jwtVerify: typeof Jose.jwtVerify;
