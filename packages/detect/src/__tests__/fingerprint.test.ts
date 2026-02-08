import { describe, it, expect } from "vitest";
import { classifyRequest, createClassifier } from "../fingerprint.js";
import type { ClassificationResult, ClassifierConfig } from "../fingerprint.js";
import type { DetectableRequest } from "../signals.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(overrides: Partial<DetectableRequest> = {}): DetectableRequest {
  return {
    headers: {},
    ...overrides,
  };
}

/** Typical browser-like request with all expected headers. */
function browserRequest(): DetectableRequest {
  return req({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ip: "73.162.45.123", // consumer ISP IP
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      "accept-encoding": "gzip, deflate, br",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-dest": "document",
      "sec-ch-ua": '"Chromium";v="120", "Google Chrome";v="120"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      referer: "https://example.com/",
      cookie: "session=abc123; _ga=GA1.2.123",
      connection: "keep-alive",
      dnt: "1",
    },
  });
}

/** Typical agent-like request from python-requests on a cloud server. */
function agentRequest(): DetectableRequest {
  return req({
    userAgent: "python-requests/2.31.0",
    ip: "54.1.2.3", // AWS
    headers: {
      "user-agent": "python-requests/2.31.0",
      accept: "application/json",
      connection: "close",
    },
  });
}

/** Self-identified agent request. */
function selfIdentifiedAgentRequest(): DetectableRequest {
  return req({
    userAgent: "MyAgent/1.0",
    headers: {
      "user-agent": "MyAgent/1.0",
      "x-agent-framework": "LangChain",
    },
  });
}

// =========================================================================
// classifyRequest
// =========================================================================

describe("classifyRequest", () => {
  // --- Basic classification -------------------------------------------------

  it("classifies agent-like request as isAgent: true", () => {
    const result = classifyRequest(agentRequest());
    expect(result.isAgent).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.framework).toBe("python-requests");
  });

  it("classifies browser-like request as isAgent: false", () => {
    const result = classifyRequest(browserRequest());
    expect(result.isAgent).toBe(false);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("classifies self-identified agent with confidence 1.0", () => {
    const result = classifyRequest(selfIdentifiedAgentRequest());
    expect(result.isAgent).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.framework).toBe("LangChain");
  });

  // --- Result structure -----------------------------------------------------

  it("returns all expected fields in classification result", () => {
    const result = classifyRequest(agentRequest());
    expect(result).toHaveProperty("isAgent");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("signals");
    expect(result).toHaveProperty("classifiedAt");
    expect(typeof result.isAgent).toBe("boolean");
    expect(typeof result.confidence).toBe("number");
    expect(Array.isArray(result.signals)).toBe(true);
    expect(typeof result.classifiedAt).toBe("string");
  });

  it("returns 5 signal results in the signals array", () => {
    const result = classifyRequest(agentRequest());
    expect(result.signals).toHaveLength(5);
  });

  it("returns a valid ISO 8601 timestamp in classifiedAt", () => {
    const result = classifyRequest(agentRequest());
    const parsed = new Date(result.classifiedAt);
    expect(parsed.getTime()).not.toBeNaN();
    // Should be very recent (within 5 seconds)
    expect(Date.now() - parsed.getTime()).toBeLessThan(5000);
  });

  // --- Confidence scoring ---------------------------------------------------

  it("browser request has very low confidence", () => {
    const result = classifyRequest(browserRequest());
    expect(result.confidence).toBeLessThan(0.15);
  });

  it("agent request from cloud IP has elevated confidence", () => {
    const result = classifyRequest(agentRequest());
    // python-requests (0.70 * 0.35) + missing headers (~1.0 * 0.20) +
    // AWS IP (0.4 * 0.10) + behavior (~0.33 * 0.15) + no self-id (0.0 * 0.20)
    expect(result.confidence).toBeGreaterThan(0.4);
  });

  // --- Framework detection --------------------------------------------------

  it("detects framework name for known agent UAs", () => {
    const result = classifyRequest(
      req({
        userAgent: "langchain/1.0",
        headers: { "user-agent": "langchain/1.0" },
      }),
    );
    expect(result.framework).toBe("LangChain");
  });

  it("does not report framework for browser UAs", () => {
    const result = classifyRequest(browserRequest());
    expect(result.framework).toBeUndefined();
  });

  it("reports framework from self-identification when present", () => {
    const result = classifyRequest(selfIdentifiedAgentRequest());
    expect(result.framework).toBe("LangChain");
  });

  it("reports agentId as framework for X-AgentGate-Agent-Id", () => {
    const result = classifyRequest(
      req({
        headers: {
          "x-agentgate-agent-id": "agent-123",
        },
      }),
    );
    expect(result.isAgent).toBe(true);
    expect(result.confidence).toBe(1.0);
    expect(result.framework).toBe("agent-123");
  });

  // --- Self-identification short-circuit ------------------------------------

  it("short-circuits to confidence 1.0 for self-id with confidence >= 1.0", () => {
    const result = classifyRequest(
      req({
        headers: {
          "x-agent-framework": "CustomAgent",
        },
      }),
    );
    expect(result.isAgent).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  it("does NOT short-circuit for X-Bot header (confidence 0.9, < 1.0)", () => {
    const result = classifyRequest(
      req({
        headers: {
          "x-bot": "true",
          // Add browser headers to drive other signals low
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
          "accept-language": "en-US",
          "accept-encoding": "gzip",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "sec-fetch-dest": "document",
          "sec-ch-ua": '"Chromium"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          cookie: "session=abc",
          referer: "https://example.com",
          dnt: "1",
        },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
        ip: "73.162.45.123",
      }),
    );
    // Should NOT be 1.0 since X-Bot has confidence 0.9 (no short-circuit)
    expect(result.confidence).toBeLessThan(1.0);
    // But the X-Bot signal should boost confidence
    expect(result.confidence).toBeGreaterThan(0);
  });

  // --- Custom threshold -----------------------------------------------------

  it("respects custom threshold for classification", () => {
    // Use a high threshold so a moderate-confidence request is classified as human
    const result = classifyRequest(agentRequest(), { threshold: 0.95 });
    // Agent request has high but not 0.95 confidence (unless self-identified)
    // python-requests won't hit 0.95 overall
    expect(result.confidence).toBeLessThan(0.95);
    expect(result.isAgent).toBe(false);
  });

  it("lower threshold classifies more requests as agents", () => {
    // Even a minimal agent signal should be classified as agent with low threshold
    const result = classifyRequest(
      req({
        userAgent: "axios/1.6.0",
        headers: { "user-agent": "axios/1.6.0" },
      }),
      { threshold: 0.1 },
    );
    expect(result.isAgent).toBe(true);
  });

  it("threshold of 0 classifies almost everything as agent", () => {
    // Even a browser request has some minimal behavior signals
    const result = classifyRequest(browserRequest(), { threshold: 0 });
    expect(result.isAgent).toBe(true);
  });

  it("threshold of 1.0 only classifies self-identified agents", () => {
    // Agent request without self-identification should not pass 1.0 threshold
    const agentResult = classifyRequest(agentRequest(), { threshold: 1.0 });
    expect(agentResult.isAgent).toBe(false);

    // Self-identified agent should still pass
    const selfIdResult = classifyRequest(selfIdentifiedAgentRequest(), {
      threshold: 1.0,
    });
    expect(selfIdResult.isAgent).toBe(true);
  });

  // --- Custom weights -------------------------------------------------------

  it("respects custom weights for signals", () => {
    // Give all weight to user-agent, zero everything else
    const config: ClassifierConfig = {
      weights: {
        "user-agent": 1.0,
        headers: 0,
        ip: 0,
        behavior: 0,
        "self-id": 0,
      },
    };

    const result = classifyRequest(
      req({
        userAgent: "python-requests/2.31.0",
        headers: { "user-agent": "python-requests/2.31.0" },
      }),
      config,
    );

    // With only user-agent weight, confidence should be close to 0.70
    // (python-requests confidence * 1.0 weight) / total weight = 0.70
    expect(result.confidence).toBeCloseTo(0.7, 1);
  });

  it("zero weight on user-agent reduces its impact", () => {
    const withUA = classifyRequest(
      req({
        userAgent: "python-requests/2.31.0",
        headers: { "user-agent": "python-requests/2.31.0" },
      }),
    );

    const withoutUA = classifyRequest(
      req({
        userAgent: "python-requests/2.31.0",
        headers: { "user-agent": "python-requests/2.31.0" },
      }),
      { weights: { "user-agent": 0 } },
    );

    expect(withUA.confidence).toBeGreaterThan(withoutUA.confidence);
  });

  it("heavily weighting ip increases cloud IP impact", () => {
    const normalResult = classifyRequest(
      req({
        userAgent: "Mozilla/5.0 Chrome/120",
        ip: "54.1.2.3",
        headers: {
          "user-agent": "Mozilla/5.0 Chrome/120",
          ...Object.fromEntries(
            [
              "accept-language",
              "accept-encoding",
              "sec-fetch-mode",
              "sec-fetch-site",
              "sec-fetch-dest",
              "sec-ch-ua",
              "sec-ch-ua-mobile",
              "sec-ch-ua-platform",
              "referer",
              "cookie",
            ].map((h) => [h, "value"]),
          ),
        },
      }),
    );

    const ipWeightedResult = classifyRequest(
      req({
        userAgent: "Mozilla/5.0 Chrome/120",
        ip: "54.1.2.3",
        headers: {
          "user-agent": "Mozilla/5.0 Chrome/120",
          ...Object.fromEntries(
            [
              "accept-language",
              "accept-encoding",
              "sec-fetch-mode",
              "sec-fetch-site",
              "sec-fetch-dest",
              "sec-ch-ua",
              "sec-ch-ua-mobile",
              "sec-ch-ua-platform",
              "referer",
              "cookie",
            ].map((h) => [h, "value"]),
          ),
        },
      }),
      { weights: { ip: 2.0 } },
    );

    expect(ipWeightedResult.confidence).toBeGreaterThan(normalResult.confidence);
  });

  // --- Edge cases -----------------------------------------------------------

  it("handles empty request gracefully", () => {
    const result = classifyRequest(req({}));
    expect(result).toHaveProperty("isAgent");
    expect(result).toHaveProperty("confidence");
    expect(result.signals).toHaveLength(5);
  });

  it("confidence never exceeds 1.0", () => {
    const result = classifyRequest(agentRequest());
    expect(result.confidence).toBeLessThanOrEqual(1.0);
  });

  it("confidence is never negative", () => {
    const result = classifyRequest(browserRequest());
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});

// =========================================================================
// createClassifier
// =========================================================================

describe("createClassifier", () => {
  it("returns a function", () => {
    const classify = createClassifier({});
    expect(typeof classify).toBe("function");
  });

  it("returned function classifies requests with pre-baked config", () => {
    const classify = createClassifier({ threshold: 0.3 });
    const result = classify(agentRequest());
    expect(result.isAgent).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it("respects pre-baked threshold", () => {
    const strictClassify = createClassifier({ threshold: 0.99 });
    const lenientClassify = createClassifier({ threshold: 0.1 });

    const agent = agentRequest();
    const strictResult = strictClassify(agent);
    const lenientResult = lenientClassify(agent);

    // Same confidence, different isAgent
    expect(strictResult.confidence).toBe(lenientResult.confidence);
    expect(strictResult.isAgent).toBe(false); // Too strict
    expect(lenientResult.isAgent).toBe(true); // Lenient enough
  });

  it("respects pre-baked weights", () => {
    const classify = createClassifier({
      weights: {
        "user-agent": 1.0,
        headers: 0,
        ip: 0,
        behavior: 0,
        "self-id": 0,
      },
    });

    const result = classify(
      req({
        userAgent: "python-requests/2.31.0",
        headers: { "user-agent": "python-requests/2.31.0" },
      }),
    );

    expect(result.confidence).toBeCloseTo(0.7, 1);
  });

  it("each call creates an independent classifier", () => {
    const classifyA = createClassifier({ threshold: 0.1 });
    const classifyB = createClassifier({ threshold: 0.99 });

    const agent = agentRequest();

    expect(classifyA(agent).isAgent).toBe(true);
    expect(classifyB(agent).isAgent).toBe(false);
  });

  it("returns proper ClassificationResult structure", () => {
    const classify = createClassifier({ threshold: 0.5 });
    const result = classify(browserRequest());

    expect(result).toHaveProperty("isAgent");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("signals");
    expect(result).toHaveProperty("classifiedAt");
    expect(result.signals).toHaveLength(5);
  });
});
