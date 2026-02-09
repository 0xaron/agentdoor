/**
 * Vitest setup file — polyfills globalThis.crypto for Node 18.
 *
 * Node 18 does not expose the Web Crypto API on the global scope by default
 * (it requires the --experimental-global-webcrypto flag). Node 19+ includes
 * it globally. This setup file bridges the gap so tests run identically on
 * both Node 18 and Node 22.
 */
import { webcrypto } from "node:crypto";

if (typeof globalThis.crypto === "undefined") {
  // @ts-expect-error -- webcrypto is compatible but the types diverge slightly
  globalThis.crypto = webcrypto;
}
