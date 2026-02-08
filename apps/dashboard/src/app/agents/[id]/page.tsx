/**
 * Agent Detail Page (Phase 3.3)
 *
 * Displays a single agent's details:
 * - ID, public key, scopes, status, reputation, created date, total requests
 *
 * Data is read directly from the AgentStore (server component).
 */

import { getStore, ensureSeeded } from "@/lib/store";
import { notFound } from "next/navigation";

// ---------------------------------------------------------------------------
// Styles (matching dashboard conventions)
// ---------------------------------------------------------------------------

const styles = {
  page: {
    maxWidth: 960,
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
    fontSize: "0.8125rem",
    color: "#9ca3af",
    fontFamily: "monospace",
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
  grid4: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 16,
    marginBottom: 20,
  } as const,
  badge: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 9999,
    fontSize: "0.75rem",
    fontWeight: 600,
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
  statValue: {
    fontSize: "1.5rem",
    fontWeight: 700,
    marginTop: 4,
  } as const,
  statLabel: {
    fontSize: "0.8125rem",
    color: "#6b7280",
    fontWeight: 500,
  } as const,
  barBg: {
    height: 10,
    borderRadius: 5,
    background: "#f3f4f6",
    overflow: "hidden" as const,
  } as const,
  scopeTag: {
    display: "inline-block",
    fontSize: "0.8125rem",
    background: "#f3f4f6",
    padding: "4px 10px",
    borderRadius: 6,
    fontFamily: "monospace",
    marginRight: 6,
    marginBottom: 6,
  } as const,
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
    case "banned":
      return { bg: "#fee2e2", text: "#991b1b" };
    default:
      return { bg: "#f3f4f6", text: "#374151" };
  }
}

function reputationColor(rep: number): string {
  if (rep >= 70) return "#22c55e";
  if (rep >= 40) return "#eab308";
  return "#ef4444";
}

function formatDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(String(d));
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await ensureSeeded();
  const store = getStore();
  const agent = await store.getAgent(id);

  if (!agent) {
    notFound();
  }

  const sc = statusColor(agent.status);
  const createdAt = agent.createdAt instanceof Date ? agent.createdAt : new Date(String(agent.createdAt));
  const lastAuthAt = agent.lastAuthAt instanceof Date ? agent.lastAuthAt : new Date(String(agent.lastAuthAt));

  return (
    <div style={styles.page}>
      {/* Back link */}
      <a href="/" style={styles.backLink}>
        &larr; Back to Dashboard
      </a>

      {/* Header */}
      <h1 style={styles.title}>{agent.metadata.name || agent.id}</h1>
      <div style={styles.subtitle}>{agent.id}</div>

      {/* Stat Cards */}
      <div style={styles.grid4}>
        <div style={styles.card}>
          <div style={styles.statLabel}>Status</div>
          <div style={{ marginTop: 8 }}>
            <span style={{ ...styles.badge, background: sc.bg, color: sc.text }}>
              {agent.status}
            </span>
          </div>
        </div>
        <div style={styles.card}>
          <div style={styles.statLabel}>Reputation</div>
          <div style={styles.statValue}>{agent.reputation}/100</div>
          <div style={{ ...styles.barBg, marginTop: 8 }}>
            <div
              style={{
                width: `${agent.reputation}%`,
                height: "100%",
                borderRadius: 5,
                background: reputationColor(agent.reputation),
              }}
            />
          </div>
        </div>
        <div style={styles.card}>
          <div style={styles.statLabel}>Total Requests</div>
          <div style={styles.statValue}>{formatNumber(agent.totalRequests)}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.statLabel}>Total Revenue (x402)</div>
          <div style={styles.statValue}>{formatCurrency(agent.totalX402Paid)}</div>
        </div>
      </div>

      {/* Agent Details */}
      <div style={styles.grid2}>
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Identity</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={styles.fieldLabel}>Agent ID</div>
              <div style={{ ...styles.fieldValue, fontFamily: "monospace" }}>{agent.id}</div>
            </div>
            <div>
              <div style={styles.fieldLabel}>Public Key</div>
              <div style={{ ...styles.fieldValue, fontFamily: "monospace", wordBreak: "break-all" }}>
                {agent.publicKey}
              </div>
            </div>
            {agent.x402Wallet && (
              <div>
                <div style={styles.fieldLabel}>x402 Wallet</div>
                <div style={{ ...styles.fieldValue, fontFamily: "monospace", wordBreak: "break-all" }}>
                  {agent.x402Wallet}
                </div>
              </div>
            )}
            <div>
              <div style={styles.fieldLabel}>Framework</div>
              <div style={styles.fieldValue}>
                {agent.metadata.framework || "Unknown"}{" "}
                {agent.metadata.version ? `v${agent.metadata.version}` : ""}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Timestamps</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={styles.fieldLabel}>Created At</div>
              <div style={styles.fieldValue}>{formatDate(createdAt)}</div>
            </div>
            <div>
              <div style={styles.fieldLabel}>Last Authenticated</div>
              <div style={styles.fieldValue}>{formatDate(lastAuthAt)}</div>
            </div>
            <div>
              <div style={styles.fieldLabel}>Rate Limit</div>
              <div style={styles.fieldValue}>
                <code
                  style={{
                    fontSize: "0.875rem",
                    background: "#f3f4f6",
                    padding: "4px 10px",
                    borderRadius: 6,
                  }}
                >
                  {agent.rateLimit.requests} requests / {agent.rateLimit.window}
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Scopes */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Granted Scopes</h2>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {agent.scopesGranted.length > 0 ? (
            agent.scopesGranted.map((scope) => (
              <span key={scope} style={styles.scopeTag}>
                {scope}
              </span>
            ))
          ) : (
            <span style={{ color: "#9ca3af", fontSize: "0.875rem" }}>
              No scopes granted
            </span>
          )}
        </div>
      </div>

      {/* Metadata */}
      {Object.keys(agent.metadata).length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Metadata</h2>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.875rem",
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    borderBottom: "2px solid #e5e7eb",
                    color: "#6b7280",
                    fontWeight: 600,
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Key
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    borderBottom: "2px solid #e5e7eb",
                    color: "#6b7280",
                    fontWeight: 600,
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(agent.metadata).map(([key, value]) => (
                <tr key={key}>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #f3f4f6",
                      fontFamily: "monospace",
                      fontWeight: 500,
                    }}
                  >
                    {key}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #f3f4f6",
                    }}
                  >
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
