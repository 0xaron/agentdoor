/**
 * Dashboard API - Config Endpoint (Phase 3.4)
 *
 * GET /api/config
 * Returns the current AgentDoor configuration including scopes,
 * rate limits, and x402 settings.
 *
 * In production this would read from the actual AgentDoorConfig.
 * For now, returns a representative sample configuration.
 */

import { NextResponse } from "next/server";
import type { ApiResponse } from "@/lib/types";

/** Shape of the configuration data returned by this endpoint. */
interface AgentDoorConfigResponse {
  service: {
    name: string;
    description: string;
    version: string;
    mode: string;
  };
  scopes: Array<{
    id: string;
    description: string;
    price?: string;
    rateLimit?: string;
  }>;
  rateLimit: {
    default: { requests: number; window: string };
    registration: { requests: number; window: string };
  };
  x402: {
    enabled: boolean;
    network: string;
    currency: string;
    facilitator: string;
    paymentAddress: string;
  };
  auth: {
    methods: string[];
    signingAlgorithm: string;
    challengeExpirySeconds: number;
    jwtExpiresIn: string;
  };
  companion: {
    a2aAgentCard: boolean;
    mcpServer: boolean;
    oauthCompat: boolean;
  };
  storage: {
    driver: string;
  };
  reputation: {
    enabled: boolean;
    initialScore: number;
    flagThreshold: number;
    suspendThreshold: number;
  };
  spendingCaps: {
    enabled: boolean;
    warningThreshold: number;
    defaultCaps: Array<{
      amount: number;
      currency: string;
      period: string;
      type: string;
    }>;
  };
}

export async function GET() {
  try {
    const config: AgentDoorConfigResponse = {
      service: {
        name: "AgentDoor Service",
        description: "An AgentDoor-enabled API service",
        version: "1.0",
        mode: "live",
      },
      scopes: [
        { id: "data.read", description: "Read data", price: "$0.001/req", rateLimit: "5000/1h" },
        { id: "data.write", description: "Write data", price: "$0.005/req", rateLimit: "2000/1h" },
        { id: "analytics.read", description: "Read analytics", price: "$0.002/req", rateLimit: "1000/1h" },
        { id: "search.execute", description: "Execute search queries", price: "$0.01/req", rateLimit: "500/1h" },
        { id: "reports.write", description: "Generate and write reports", price: "$0.02/req", rateLimit: "200/1h" },
        { id: "webhooks.send", description: "Send webhooks", price: "$0.001/req", rateLimit: "1000/1h" },
        { id: "pricing.read", description: "Read pricing data", price: "$0.001/req", rateLimit: "2000/1h" },
        { id: "tickets.read", description: "Read support tickets", price: "$0.001/req", rateLimit: "2000/1h" },
        { id: "tickets.write", description: "Create/update support tickets", price: "$0.005/req", rateLimit: "500/1h" },
        { id: "trading.execute", description: "Execute trading operations", price: "$0.05/req", rateLimit: "100/1h" },
      ],
      rateLimit: {
        default: { requests: 1000, window: "1h" },
        registration: { requests: 10, window: "1h" },
      },
      x402: {
        enabled: true,
        network: "base",
        currency: "USDC",
        facilitator: "https://x402.org/facilitator",
        paymentAddress: "0x1234...abcd",
      },
      auth: {
        methods: ["ed25519-challenge", "x402-wallet", "jwt"],
        signingAlgorithm: "ed25519",
        challengeExpirySeconds: 300,
        jwtExpiresIn: "1h",
      },
      companion: {
        a2aAgentCard: true,
        mcpServer: false,
        oauthCompat: false,
      },
      storage: {
        driver: "memory",
      },
      reputation: {
        enabled: true,
        initialScore: 50,
        flagThreshold: 30,
        suspendThreshold: 10,
      },
      spendingCaps: {
        enabled: true,
        warningThreshold: 0.8,
        defaultCaps: [
          { amount: 10, currency: "USDC", period: "daily", type: "soft" },
          { amount: 100, currency: "USDC", period: "monthly", type: "hard" },
        ],
      },
    };

    return NextResponse.json({
      success: true,
      data: config,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse<AgentDoorConfigResponse>);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<never>,
      { status: 500 },
    );
  }
}
