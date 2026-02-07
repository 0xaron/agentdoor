/**
 * @agentgate/detect — Agent traffic detection and fingerprinting.
 *
 * Classifies HTTP requests as agent or human traffic using multiple signal
 * detectors: User-Agent analysis, header patterns, IP range checking,
 * behavioral patterns, and self-identification headers.
 *
 * Can be used standalone (detect-only mode) or as part of the full AgentGate
 * middleware stack.
 *
 * @example Express detect-only mode
 * ```ts
 * import express from "express";
 * import { detect } from "@agentgate/detect";
 *
 * const app = express();
 * app.use(detect({
 *   webhook: "https://hooks.yoursite.com/agent-traffic",
 * }));
 * ```
 *
 * @example Direct classification
 * ```ts
 * import { classifyRequest } from "@agentgate/detect";
 *
 * const result = classifyRequest({
 *   headers: { "user-agent": "python-requests/2.31.0" },
 *   userAgent: "python-requests/2.31.0",
 *   ip: "54.1.2.3",
 * });
 *
 * if (result.isAgent) {
 *   console.log(`Agent detected (${result.confidence}): ${result.framework}`);
 * }
 * ```
 */

// Signal detectors
export {
  analyzeUserAgent,
  analyzeHeaderPatterns,
  analyzeIpRange,
  analyzeBehavioralPatterns,
  analyzeSelfIdentification,
  analyzeAllSignals,
} from "./signals.js";

export type {
  SignalResult,
  DetectableRequest,
} from "./signals.js";

// Classification / fingerprinting
export {
  classifyRequest,
  createClassifier,
} from "./fingerprint.js";

export type {
  ClassificationResult,
  ClassifierConfig,
} from "./fingerprint.js";

// Middleware
export {
  detect,
  createDetector,
  detectMiddleware,
} from "./middleware.js";

export type {
  DetectMiddlewareConfig,
} from "./middleware.js";
