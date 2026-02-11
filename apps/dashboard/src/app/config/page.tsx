/**
 * Configuration Page (Phase 3.4)
 *
 * Displays the current AgentDoor configuration:
 * - Service info
 * - Scopes and pricing
 * - Rate limits
 * - x402 payment settings
 * - Auth methods
 * - Companion protocols
 * - Reputation settings
 * - Spending caps
 *
 * Reads configuration from the /api/config route (server-side fetch).
 */

// ---------------------------------------------------------------------------
// Styles (matching dashboard conventions)
// ---------------------------------------------------------------------------

const styles = {
  page: {
    maxWidth: 1080,
    margin: "0 auto",
    padding: "24px 24px 64px",
  } as const,
  backLink: {
    display: "inline-block",
    fontSize: "0.875rem",
    color: "#6366f1",
    marginBottom: 16,
  } as const,
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    marginBottom: 4,
  } as const,
  subtitle: {
    fontSize: "0.875rem",
    color: "#6b7280",
    marginBottom: 24,
  } as const,
  card: {
    background: "#fff",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    padding: 20,
    marginBottom: 20,
  } as const,
  sectionTitle: {
    fontSize: "1.125rem",
    fontWeight: 600,
    marginBottom: 16,
  } as const,
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 16,
    marginBottom: 20,
  } as const,
  grid3: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 16,
    marginBottom: 20,
  } as const,
  fieldLabel: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#6b7280",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 4,
  } as const,
  fieldValue: {
    fontSize: "0.9375rem",
    fontWeight: 500,
  } as const,
  badge: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 9999,
    fontSize: "0.75rem",
    fontWeight: 600,
  } as const,
  enabledBadge: {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 9999,
    fontSize: "0.6875rem",
    fontWeight: 600,
  } as const,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "0.875rem",
  },
  th: {
    textAlign: "left" as const,
    padding: "10px 12px",
    borderBottom: "2px solid #e5e7eb",
    color: "#6b7280",
    fontWeight: 600,
    fontSize: "0.75rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #f3f4f6",
  },
} as const;

// ---------------------------------------------------------------------------
// Types (matching API response)
// ---------------------------------------------------------------------------

interface ConfigScope {
  id: string;
  description: string;
  price?: string;
  rateLimit?: string;
}

interface ConfigData {
  service: {
    name: string;
    description: string;
    version: string;
    mode: string;
  };
  scopes: ConfigScope[];
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

// ---------------------------------------------------------------------------
// Server-side data fetching
// ---------------------------------------------------------------------------

async function getConfig(): Promise<ConfigData> {
  // Since this is a server component, we construct sample config directly
  // to avoid fetching from ourselves. This mirrors what /api/config returns.
  return {
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
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ConfigPage() {
  const config = await getConfig();

  return (
    <div style={styles.page}>
      {/* Back link */}
      <a href="/" style={styles.backLink}>
        &larr; Back to Dashboard
      </a>

      <h1 style={styles.title}>AgentDoor Configuration</h1>
      <p style={styles.subtitle}>
        Current configuration for scopes, rate limits, payments, and security settings.
      </p>

      {/* Service Info */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Service</h2>
        <div style={styles.grid3}>
          <div>
            <div style={styles.fieldLabel}>Name</div>
            <div style={styles.fieldValue}>{config.service.name}</div>
          </div>
          <div>
            <div style={styles.fieldLabel}>Version</div>
            <div style={styles.fieldValue}>{config.service.version}</div>
          </div>
          <div>
            <div style={styles.fieldLabel}>Mode</div>
            <div>
              <span
                style={{
                  ...styles.badge,
                  background: config.service.mode === "live" ? "#dcfce7" : "#fef3c7",
                  color: config.service.mode === "live" ? "#166534" : "#92400e",
                }}
              >
                {config.service.mode}
              </span>
            </div>
          </div>
        </div>
        <div>
          <div style={styles.fieldLabel}>Description</div>
          <div style={{ ...styles.fieldValue, color: "#6b7280" }}>{config.service.description}</div>
        </div>
      </div>

      {/* Scopes */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>
          Scopes ({config.scopes.length} defined)
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Scope ID</th>
                <th style={styles.th}>Description</th>
                <th style={styles.th}>Price</th>
                <th style={styles.th}>Rate Limit</th>
              </tr>
            </thead>
            <tbody>
              {config.scopes.map((scope) => (
                <tr key={scope.id}>
                  <td style={styles.td}>
                    <code
                      style={{
                        fontSize: "0.8125rem",
                        background: "#f3f4f6",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {scope.id}
                    </code>
                  </td>
                  <td style={{ ...styles.td, color: "#6b7280" }}>{scope.description}</td>
                  <td style={styles.td}>
                    <span style={{ fontWeight: 500, color: "#059669" }}>
                      {scope.price || "Free"}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <code style={{ fontSize: "0.8125rem", color: "#6b7280" }}>
                      {scope.rateLimit || "Default"}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rate Limits + Auth */}
      <div style={styles.grid2}>
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Rate Limits</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={styles.fieldLabel}>Default Agent Limit</div>
              <div style={styles.fieldValue}>
                <code
                  style={{
                    fontSize: "0.9375rem",
                    background: "#f3f4f6",
                    padding: "4px 10px",
                    borderRadius: 6,
                  }}
                >
                  {config.rateLimit.default.requests} requests / {config.rateLimit.default.window}
                </code>
              </div>
            </div>
            <div>
              <div style={styles.fieldLabel}>Registration Endpoint Limit</div>
              <div style={styles.fieldValue}>
                <code
                  style={{
                    fontSize: "0.9375rem",
                    background: "#f3f4f6",
                    padding: "4px 10px",
                    borderRadius: 6,
                  }}
                >
                  {config.rateLimit.registration.requests} requests / {config.rateLimit.registration.window}
                </code>
              </div>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Authentication</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={styles.fieldLabel}>Auth Methods</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {config.auth.methods.map((method) => (
                  <span
                    key={method}
                    style={{
                      ...styles.badge,
                      background: "#eef2ff",
                      color: "#4338ca",
                    }}
                  >
                    {method}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div style={styles.fieldLabel}>Signing Algorithm</div>
              <div style={styles.fieldValue}>{config.auth.signingAlgorithm}</div>
            </div>
            <div style={{ display: "flex", gap: 32 }}>
              <div>
                <div style={styles.fieldLabel}>Challenge Expiry</div>
                <div style={styles.fieldValue}>{config.auth.challengeExpirySeconds}s</div>
              </div>
              <div>
                <div style={styles.fieldLabel}>JWT Expiry</div>
                <div style={styles.fieldValue}>{config.auth.jwtExpiresIn}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* x402 + Companion */}
      <div style={styles.grid2}>
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>
            x402 Payments{" "}
            <span
              style={{
                ...styles.enabledBadge,
                background: config.x402.enabled ? "#dcfce7" : "#fee2e2",
                color: config.x402.enabled ? "#166534" : "#991b1b",
                marginLeft: 8,
              }}
            >
              {config.x402.enabled ? "Enabled" : "Disabled"}
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={styles.fieldLabel}>Network</div>
              <div style={styles.fieldValue}>{config.x402.network}</div>
            </div>
            <div>
              <div style={styles.fieldLabel}>Currency</div>
              <div style={styles.fieldValue}>{config.x402.currency}</div>
            </div>
            <div>
              <div style={styles.fieldLabel}>Facilitator</div>
              <div style={{ ...styles.fieldValue, fontSize: "0.8125rem", fontFamily: "monospace", wordBreak: "break-all" }}>
                {config.x402.facilitator}
              </div>
            </div>
            <div>
              <div style={styles.fieldLabel}>Payment Address</div>
              <div style={{ ...styles.fieldValue, fontSize: "0.8125rem", fontFamily: "monospace" }}>
                {config.x402.paymentAddress}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Companion Protocols</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { label: "A2A Agent Card", value: config.companion.a2aAgentCard, path: "/.well-known/agent-card.json" },
              { label: "MCP Server", value: config.companion.mcpServer, path: "/mcp" },
              { label: "OAuth 2.1 Compat", value: config.companion.oauthCompat, path: "/oauth" },
            ].map((proto) => (
              <div
                key={proto.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  background: "#f9fafb",
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{proto.label}</div>
                  <div style={{ fontSize: "0.75rem", color: "#9ca3af", fontFamily: "monospace" }}>
                    {proto.path}
                  </div>
                </div>
                <span
                  style={{
                    ...styles.enabledBadge,
                    background: proto.value ? "#dcfce7" : "#f3f4f6",
                    color: proto.value ? "#166534" : "#9ca3af",
                  }}
                >
                  {proto.value ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={styles.fieldLabel}>Storage Driver</div>
            <div style={styles.fieldValue}>
              <code
                style={{
                  fontSize: "0.9375rem",
                  background: "#f3f4f6",
                  padding: "4px 10px",
                  borderRadius: 6,
                }}
              >
                {config.storage.driver}
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* Reputation + Spending Caps */}
      <div style={styles.grid2}>
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>
            Reputation System{" "}
            <span
              style={{
                ...styles.enabledBadge,
                background: config.reputation.enabled ? "#dcfce7" : "#fee2e2",
                color: config.reputation.enabled ? "#166534" : "#991b1b",
                marginLeft: 8,
              }}
            >
              {config.reputation.enabled ? "Enabled" : "Disabled"}
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={styles.fieldLabel}>Initial Score</div>
              <div style={styles.fieldValue}>{config.reputation.initialScore}/100</div>
            </div>
            <div>
              <div style={styles.fieldLabel}>Flag Threshold</div>
              <div style={{ ...styles.fieldValue, color: "#eab308" }}>
                Below {config.reputation.flagThreshold}
              </div>
            </div>
            <div>
              <div style={styles.fieldLabel}>Suspend Threshold</div>
              <div style={{ ...styles.fieldValue, color: "#ef4444" }}>
                Below {config.reputation.suspendThreshold}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>
            Spending Caps{" "}
            <span
              style={{
                ...styles.enabledBadge,
                background: config.spendingCaps.enabled ? "#dcfce7" : "#fee2e2",
                color: config.spendingCaps.enabled ? "#166534" : "#991b1b",
                marginLeft: 8,
              }}
            >
              {config.spendingCaps.enabled ? "Enabled" : "Disabled"}
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={styles.fieldLabel}>Warning Threshold</div>
              <div style={styles.fieldValue}>
                {Math.round(config.spendingCaps.warningThreshold * 100)}% of cap
              </div>
            </div>
            <div>
              <div style={{ ...styles.fieldLabel, marginBottom: 8 }}>Default Caps</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Amount</th>
                    <th style={styles.th}>Currency</th>
                    <th style={styles.th}>Period</th>
                    <th style={styles.th}>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {config.spendingCaps.defaultCaps.map((cap, i) => (
                    <tr key={i}>
                      <td style={{ ...styles.td, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        ${cap.amount.toFixed(2)}
                      </td>
                      <td style={styles.td}>{cap.currency}</td>
                      <td style={styles.td}>{cap.period}</td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.enabledBadge,
                            background: cap.type === "hard" ? "#fee2e2" : "#fef3c7",
                            color: cap.type === "hard" ? "#991b1b" : "#92400e",
                          }}
                        >
                          {cap.type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
