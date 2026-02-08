import {
  overviewStats,
  agents,
  trafficData,
  revenueData,
  frameworkBreakdown,
  scopeUsage,
  rateLimitEvents,
} from "@/lib/mock-data";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    maxWidth: 1280,
    margin: "0 auto",
    padding: "24px 24px 64px",
  } as const,
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 32,
  } as const,
  title: {
    fontSize: "1.75rem",
    fontWeight: 700,
  } as const,
  subtitle: {
    fontSize: "0.875rem",
    color: "#6b7280",
    marginTop: 4,
  } as const,
  badge: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 9999,
    fontSize: "0.75rem",
    fontWeight: 600,
  } as const,
  sectionTitle: {
    fontSize: "1.125rem",
    fontWeight: 600,
    marginBottom: 16,
  } as const,
  grid4: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 16,
    marginBottom: 32,
  } as const,
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 16,
    marginBottom: 32,
  } as const,
  card: {
    background: "#fff",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    padding: 20,
  } as const,
  statValue: {
    fontSize: "1.75rem",
    fontWeight: 700,
    marginTop: 4,
  } as const,
  statLabel: {
    fontSize: "0.8125rem",
    color: "#6b7280",
    fontWeight: 500,
  } as const,
  statDelta: {
    fontSize: "0.75rem",
    marginTop: 4,
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
    padding: "12px",
    borderBottom: "1px solid #f3f4f6",
  },
  barContainer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as const,
  barBg: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    background: "#f3f4f6",
    overflow: "hidden" as const,
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case "active":
      return { bg: "#dcfce7", text: "#166534" };
    case "suspended":
      return { bg: "#fee2e2", text: "#991b1b" };
    case "rate_limited":
      return { bg: "#fef3c7", text: "#92400e" };
    default:
      return { bg: "#f3f4f6", text: "#374151" };
  }
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  delta,
  deltaUp,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaUp?: boolean;
}) {
  return (
    <div style={styles.card}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
      {delta && (
        <div
          style={{
            ...styles.statDelta,
            color: deltaUp ? "#16a34a" : "#dc2626",
          }}
        >
          {deltaUp ? "\u2191" : "\u2193"} {delta}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stacked Bar Chart (agent vs human traffic, or x402 vs subscription revenue)
// ---------------------------------------------------------------------------

function StackedBarChart({
  data,
}: {
  data: { label: string; a: number; b: number }[];
}) {
  const maxVal = Math.max(...data.map((d) => d.a + d.b));

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 140 }}>
      {data.map((d) => {
        const total = d.a + d.b;
        const heightPct = Math.max((total / maxVal) * 100, 4);
        const aPct = (d.a / total) * 100;
        return (
          <div
            key={d.label}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 48,
                borderRadius: "4px 4px 0 0",
                height: `${heightPct}%`,
                minHeight: 4,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "#93c5fd",
                  flex: `0 0 ${100 - aPct}%`,
                }}
              />
              <div style={{ background: "#6366f1", flex: `0 0 ${aPct}%` }} />
            </div>
            <span style={{ fontSize: "0.625rem", color: "#9ca3af" }}>
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const sortedAgents = [...agents].sort(
    (a, b) => b.totalRequests - a.totalRequests,
  );

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>AgentGate Dashboard</h1>
          <p style={styles.subtitle}>
            Agent registrations, usage analytics, and revenue tracking
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            style={{
              ...styles.badge,
              background: "#dcfce7",
              color: "#166534",
            }}
          >
            Live
          </span>
          <span style={{ fontSize: "0.8125rem", color: "#6b7280" }}>
            v1.0.0
          </span>
        </div>
      </header>

      {/* Overview Stats */}
      <div style={styles.grid4}>
        <StatCard
          label="Total Agents"
          value={overviewStats.totalAgents.toString()}
          delta="+34 this week"
          deltaUp
        />
        <StatCard
          label="Active Agents"
          value={overviewStats.activeAgents.toString()}
          delta="76.5% of total"
          deltaUp
        />
        <StatCard
          label="Total Requests"
          value={formatNumber(overviewStats.totalRequests)}
          delta={`${formatNumber(overviewStats.requestsToday)} today`}
          deltaUp
        />
        <StatCard
          label="Total Revenue (x402)"
          value={formatCurrency(overviewStats.totalRevenue)}
          delta={`${formatCurrency(overviewStats.revenueThisMonth)} this month`}
          deltaUp
        />
      </div>

      {/* Traffic + Revenue Charts */}
      <div style={styles.grid2}>
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Traffic (Last 7 Days)</h2>
          <div
            style={{
              display: "flex",
              gap: 16,
              marginBottom: 12,
              fontSize: "0.75rem",
            }}
          >
            <span>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "#6366f1",
                  marginRight: 4,
                }}
              />
              Agents
            </span>
            <span>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "#93c5fd",
                  marginRight: 4,
                }}
              />
              Humans
            </span>
          </div>
          <StackedBarChart
            data={trafficData.map((d) => ({
              label: d.label,
              a: d.agents,
              b: d.humans,
            }))}
          />
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "#eef2ff",
              borderRadius: 8,
              fontSize: "0.8125rem",
              color: "#4338ca",
            }}
          >
            {overviewStats.agentTrafficPercent}% of traffic is from agents
            &mdash; {overviewStats.unregisteredAgentPercent}% unregistered
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Revenue (Last 6 Months)</h2>
          <div
            style={{
              display: "flex",
              gap: 16,
              marginBottom: 12,
              fontSize: "0.75rem",
            }}
          >
            <span>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "#10b981",
                  marginRight: 4,
                }}
              />
              x402 Revenue
            </span>
            <span>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: "#a7f3d0",
                  marginRight: 4,
                }}
              />
              Subscriptions
            </span>
          </div>
          <StackedBarChart
            data={revenueData.map((d) => ({
              label: d.label,
              a: d.x402,
              b: d.subscriptions,
            }))}
          />
          <div
            style={{
              marginTop: 12,
              fontSize: "0.8125rem",
              color: "#6b7280",
            }}
          >
            Total: {formatCurrency(revenueData.reduce((s, d) => s + d.x402 + d.subscriptions, 0))}
            {" "}&mdash;{" "}
            x402: {formatCurrency(revenueData.reduce((s, d) => s + d.x402, 0))}
          </div>
        </div>
      </div>

      {/* Framework Breakdown + Scope Usage */}
      <div style={styles.grid2}>
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Agent Framework Breakdown</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {frameworkBreakdown.map((fw) => (
              <div key={fw.name}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.8125rem",
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{fw.name}</span>
                  <span style={{ color: "#6b7280" }}>
                    {fw.count} agents ({fw.percentage}%)
                  </span>
                </div>
                <div style={styles.barBg}>
                  <div
                    style={{
                      width: `${fw.percentage}%`,
                      height: "100%",
                      background: "#6366f1",
                      borderRadius: 4,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Scope Usage</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Scope</th>
                <th style={styles.th}>Description</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Requests</th>
              </tr>
            </thead>
            <tbody>
              {scopeUsage.map((s) => (
                <tr key={s.id}>
                  <td style={styles.td}>
                    <code
                      style={{
                        fontSize: "0.8125rem",
                        background: "#f3f4f6",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {s.id}
                    </code>
                  </td>
                  <td style={{ ...styles.td, color: "#6b7280" }}>
                    {s.description}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatNumber(s.requestCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent Management Table */}
      <div style={{ ...styles.card, marginBottom: 32 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2 style={styles.sectionTitle}>Registered Agents</h2>
          <span style={{ fontSize: "0.8125rem", color: "#6b7280" }}>
            {agents.length} agents
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Agent</th>
                <th style={styles.th}>Framework</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Reputation</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Requests</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Revenue</th>
                <th style={styles.th}>Rate Limit</th>
                <th style={styles.th}>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {sortedAgents.map((agent) => {
                const sc = statusColor(agent.status);
                return (
                  <tr key={agent.id}>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>
                        {agent.name}
                      </div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#9ca3af",
                          fontFamily: "monospace",
                        }}
                      >
                        {agent.id}
                      </div>
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontSize: "0.8125rem" }}>
                        {agent.framework}{" "}
                        <span style={{ color: "#9ca3af" }}>
                          v{agent.version}
                        </span>
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.badge,
                          background: sc.bg,
                          color: sc.text,
                        }}
                      >
                        {agent.status}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.barContainer}>
                        <span
                          style={{
                            fontSize: "0.8125rem",
                            fontWeight: 600,
                            width: 28,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {agent.reputation}
                        </span>
                        <div style={{ ...styles.barBg, width: 60 }}>
                          <div
                            style={{
                              width: `${agent.reputation}%`,
                              height: "100%",
                              borderRadius: 4,
                              background:
                                agent.reputation >= 70
                                  ? "#22c55e"
                                  : agent.reputation >= 40
                                    ? "#eab308"
                                    : "#ef4444",
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td
                      style={{
                        ...styles.td,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatNumber(agent.totalRequests)}
                    </td>
                    <td
                      style={{
                        ...styles.td,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatCurrency(agent.totalX402Paid)}
                    </td>
                    <td style={styles.td}>
                      <code
                        style={{
                          fontSize: "0.75rem",
                          background: "#f3f4f6",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {agent.rateLimit.requests}/{agent.rateLimit.window}
                      </code>
                    </td>
                    <td
                      style={{
                        ...styles.td,
                        fontSize: "0.8125rem",
                        color: "#6b7280",
                      }}
                    >
                      {relativeTime(agent.lastAuthAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rate Limit Events + Reputation Distribution */}
      <div style={styles.grid2}>
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Recent Rate Limit Events</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Agent</th>
                <th style={styles.th}>Limit Hit</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Attempted</th>
                <th style={styles.th}>When</th>
              </tr>
            </thead>
            <tbody>
              {rateLimitEvents.map((evt, i) => (
                <tr key={i}>
                  <td style={styles.td}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 500 }}>
                      {evt.agentName}
                    </div>
                    <div
                      style={{
                        fontSize: "0.6875rem",
                        color: "#9ca3af",
                        fontFamily: "monospace",
                      }}
                    >
                      {evt.agentId}
                    </div>
                  </td>
                  <td style={styles.td}>
                    <code
                      style={{
                        fontSize: "0.75rem",
                        background: "#fef3c7",
                        padding: "2px 6px",
                        borderRadius: 4,
                        color: "#92400e",
                      }}
                    >
                      {evt.limitHit}
                    </code>
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatNumber(evt.requestsAttempted)}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      fontSize: "0.8125rem",
                      color: "#6b7280",
                    }}
                  >
                    {relativeTime(evt.timestamp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Reputation Distribution</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { range: "90-100 (Excellent)", count: 3, color: "#22c55e" },
              { range: "70-89 (Good)", count: 3, color: "#84cc16" },
              { range: "40-69 (Fair)", count: 1, color: "#eab308" },
              { range: "0-39 (Poor)", count: 1, color: "#ef4444" },
            ].map((tier) => (
              <div key={tier.range}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.8125rem",
                    marginBottom: 4,
                  }}
                >
                  <span>{tier.range}</span>
                  <span style={{ color: "#6b7280" }}>{tier.count} agents</span>
                </div>
                <div style={styles.barBg}>
                  <div
                    style={{
                      width: `${(tier.count / agents.length) * 100}%`,
                      height: "100%",
                      background: tier.color,
                      borderRadius: 4,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 16,
              padding: "8px 12px",
              background: "#f0fdf4",
              borderRadius: 8,
              fontSize: "0.8125rem",
              color: "#166534",
            }}
          >
            Average reputation: {overviewStats.avgReputation}/100
          </div>
        </div>
      </div>
    </div>
  );
}
