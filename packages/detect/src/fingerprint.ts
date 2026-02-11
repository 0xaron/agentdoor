/**
 * Request classification: combines individual signal scores into an overall
 * agent-vs-human classification with a unified confidence score.
 */

import type { SignalResult, DetectableRequest } from "./signals.js";
import { analyzeAllSignals } from "./signals.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Classification result for a single request.
 */
export interface ClassificationResult {
  /** Whether the request is classified as coming from an agent. */
  isAgent: boolean;

  /**
   * Overall confidence that the request is from an agent (0.0 – 1.0).
   * Based on a weighted combination of individual signal scores.
   */
  confidence: number;

  /** Detected framework name, if identified. */
  framework?: string;

  /** All individual signal results that contributed to the classification. */
  signals: SignalResult[];

  /** ISO 8601 timestamp of when the classification was performed. */
  classifiedAt: string;
}

/**
 * Configuration for the classifier.
 */
export interface ClassifierConfig {
  /**
   * Confidence threshold above which a request is classified as an agent.
   * Defaults to 0.5.
   */
  threshold?: number;

  /**
   * Weight multipliers for each signal category. Higher weights make that
   * signal contribute more to the overall score.
   * Keys are signal name prefixes (e.g. "user-agent", "headers", "ip",
   * "behavior", "self-id").
   */
  weights?: Partial<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Default weights
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS: Record<string, number> = {
  "user-agent": 0.35,
  "headers": 0.20,
  "ip": 0.10,
  "behavior": 0.15,
  "self-id": 0.20,
};

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a request as agent or human by running all signal detectors and
 * combining their scores with configurable weights.
 *
 * @param request - Normalized request object.
 * @param config  - Optional classifier configuration.
 * @returns Classification result with overall confidence and per-signal details.
 *
 * @example
 * ```ts
 * import { classifyRequest } from "@agentdoor/detect";
 *
 * const result = classifyRequest({
 *   headers: { "user-agent": "python-requests/2.31.0" },
 *   userAgent: "python-requests/2.31.0",
 *   ip: "54.1.2.3",
 * });
 *
 * console.log(result.isAgent);     // true
 * console.log(result.confidence);  // 0.72
 * console.log(result.framework);   // "python-requests"
 * ```
 */
export function classifyRequest(
  request: DetectableRequest,
  config?: ClassifierConfig,
): ClassificationResult {
  const threshold = config?.threshold ?? 0.5;
  const weights = { ...DEFAULT_WEIGHTS, ...config?.weights };

  const signals = analyzeAllSignals(request);

  // Any definitive self-identification (confidence 1.0) short-circuits.
  const definitive = signals.find(
    (s) => s.signal.startsWith("self-id") && s.confidence >= 1.0,
  );
  if (definitive) {
    return {
      isAgent: true,
      confidence: 1.0,
      framework: definitive.data?.framework ?? definitive.data?.agentId,
      signals,
      classifiedAt: new Date().toISOString(),
    };
  }

  // Weighted combination of signal scores.
  let weightedSum = 0;
  let totalWeight = 0;
  let detectedFramework: string | undefined;

  for (const signal of signals) {
    // Determine the weight category from the signal name prefix.
    const category = signal.signal.split(":")[0];
    const weight = weights[category] ?? 0.1;

    weightedSum += signal.confidence * weight;
    totalWeight += weight;

    // Capture the framework name from the highest-confidence framework signal.
    if (signal.data?.framework && signal.confidence > 0.5) {
      detectedFramework = signal.data.framework;
    }
  }

  const confidence = totalWeight > 0
    ? parseFloat((weightedSum / totalWeight).toFixed(4))
    : 0;

  return {
    isAgent: confidence >= threshold,
    confidence,
    framework: detectedFramework,
    signals,
    classifiedAt: new Date().toISOString(),
  };
}

/**
 * Create a classifier with pre-baked configuration. Useful for creating a
 * reusable classifier instance with custom weights/threshold.
 *
 * @example
 * ```ts
 * const classify = createClassifier({ threshold: 0.6 });
 * const result = classify(request);
 * ```
 */
export function createClassifier(
  config: ClassifierConfig,
): (request: DetectableRequest) => ClassificationResult {
  return (request) => classifyRequest(request, config);
}
