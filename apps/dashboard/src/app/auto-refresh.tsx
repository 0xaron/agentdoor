"use client";

import { useEffect, useState, useCallback } from "react";

/** Default refresh interval in milliseconds (30 seconds). */
const DEFAULT_INTERVAL_MS = 30_000;

interface AutoRefreshProps {
  /** Polling interval in milliseconds. Defaults to 30000 (30s). */
  intervalMs?: number;
  children: React.ReactNode;
}

interface StatsData {
  totalAgents: number;
  activeAgents: number;
  suspendedAgents: number;
  totalRequests: number;
  requestsToday: number;
  totalRevenue: number;
  revenueThisMonth: number;
  agentTrafficPercent: number;
  averageReputation: number;
}

/**
 * Client component that provides auto-refresh functionality for dashboard data.
 * Polls the /api/stats endpoint on a configurable interval and displays
 * a status indicator showing when the last data fetch occurred.
 */
export function AutoRefreshProvider({
  intervalMs = DEFAULT_INTERVAL_MS,
  children,
}: AutoRefreshProps) {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Fetch multiple sections in parallel to warm the cache
      await Promise.all([
        fetch("/api/stats"),
        fetch("/api/stats?section=traffic"),
        fetch("/api/stats?section=registrations"),
        fetch("/api/agents?limit=20"),
      ]);
      setLastUpdated(new Date());
    } catch {
      // Silently ignore fetch errors — data will be stale but page stays functional
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(refresh, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, intervalMs, refresh]);

  return (
    <div>
      <AutoRefreshIndicator
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
        enabled={enabled}
        intervalMs={intervalMs}
        onToggle={() => setEnabled((prev) => !prev)}
        onRefreshNow={refresh}
      />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Stats Card — fetches and displays live overview stats
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A self-refreshing stats overview that polls /api/stats.
 * Shows live data once available, falling back to server-rendered initial values.
 */
export function LiveStatsCards({
  initialStats,
  intervalMs = DEFAULT_INTERVAL_MS,
}: {
  initialStats: {
    totalAgents: number;
    activeAgents: number;
    totalRequests: number;
    totalRevenue: number;
    avgReputation: number;
  };
  intervalMs?: number;
}) {
  const [stats, setStats] = useState(initialStats);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const res = await fetch("/api/stats");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.success) return;

        const d = json.data as StatsData;
        setStats({
          totalAgents: d.totalAgents,
          activeAgents: d.activeAgents,
          totalRequests: d.totalRequests,
          totalRevenue: d.totalRevenue,
          avgReputation: d.averageReputation,
        });
        setIsLive(true);
      } catch {
        // Ignore — keep showing previous data
      }
    }

    // Initial fetch
    fetchStats();

    // Periodic refresh
    const timer = setInterval(fetchStats, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  const cardStyle = {
    background: "#fff",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    padding: 20,
  } as const;

  const labelStyle = {
    fontSize: "0.8125rem",
    color: "#6b7280",
    fontWeight: 500,
  } as const;

  const valueStyle = {
    fontSize: "1.75rem",
    fontWeight: 700,
    marginTop: 4,
  } as const;

  const deltaStyle = {
    fontSize: "0.75rem",
    marginTop: 4,
    color: "#16a34a",
  } as const;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16,
        marginBottom: 32,
      }}
    >
      <div style={cardStyle}>
        <div style={labelStyle}>Total Agents {isLive && <span style={{ color: "#22c55e", fontSize: "0.6875rem" }}>(live)</span>}</div>
        <div style={valueStyle}>{stats.totalAgents}</div>
        <div style={deltaStyle}>{"\u2191"} {stats.activeAgents} active</div>
      </div>
      <div style={cardStyle}>
        <div style={labelStyle}>Active Agents {isLive && <span style={{ color: "#22c55e", fontSize: "0.6875rem" }}>(live)</span>}</div>
        <div style={valueStyle}>{stats.activeAgents}</div>
        <div style={deltaStyle}>
          {"\u2191"} {stats.totalAgents > 0 ? `${Math.round((stats.activeAgents / stats.totalAgents) * 100)}%` : "0%"} of total
        </div>
      </div>
      <div style={cardStyle}>
        <div style={labelStyle}>Total Requests {isLive && <span style={{ color: "#22c55e", fontSize: "0.6875rem" }}>(live)</span>}</div>
        <div style={valueStyle}>{formatNumber(stats.totalRequests)}</div>
        <div style={deltaStyle}>
          {"\u2191"} avg {formatNumber(stats.totalAgents > 0 ? Math.round(stats.totalRequests / stats.totalAgents) : 0)}/agent
        </div>
      </div>
      <div style={cardStyle}>
        <div style={labelStyle}>Total Revenue (x402) {isLive && <span style={{ color: "#22c55e", fontSize: "0.6875rem" }}>(live)</span>}</div>
        <div style={valueStyle}>{formatCurrency(stats.totalRevenue)}</div>
        <div style={deltaStyle}>{"\u2191"} avg rep: {stats.avgReputation}/100</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-refresh status indicator
// ---------------------------------------------------------------------------

function AutoRefreshIndicator({
  lastUpdated,
  isRefreshing,
  enabled,
  intervalMs,
  onToggle,
  onRefreshNow,
}: {
  lastUpdated: Date | null;
  isRefreshing: boolean;
  enabled: boolean;
  intervalMs: number;
  onToggle: () => void;
  onRefreshNow: () => void;
}) {
  const [, setTick] = useState(0);

  // Re-render every 5 seconds to update "ago" text
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  function timeAgo(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const secs = Math.floor(diffMs / 1000);
    if (secs < 5) return "just now";
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    return `${mins}m ago`;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 16,
        padding: "8px 14px",
        background: enabled ? "#f0fdf4" : "#fefce8",
        border: `1px solid ${enabled ? "#bbf7d0" : "#fef08a"}`,
        borderRadius: 8,
        fontSize: "0.8125rem",
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: isRefreshing ? "#3b82f6" : enabled ? "#22c55e" : "#eab308",
          animation: isRefreshing ? "pulse 1s infinite" : "none",
        }}
      />
      <span style={{ color: "#374151" }}>
        Auto-refresh: {enabled ? `every ${intervalMs / 1000}s` : "paused"}
        {lastUpdated && ` · Updated ${timeAgo(lastUpdated)}`}
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button
          onClick={onRefreshNow}
          disabled={isRefreshing}
          style={{
            padding: "2px 10px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: isRefreshing ? "not-allowed" : "pointer",
            fontSize: "0.75rem",
            color: "#374151",
          }}
        >
          {isRefreshing ? "Refreshing..." : "Refresh now"}
        </button>
        <button
          onClick={onToggle}
          style={{
            padding: "2px 10px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: "pointer",
            fontSize: "0.75rem",
            color: "#374151",
          }}
        >
          {enabled ? "Pause" : "Resume"}
        </button>
      </div>
    </div>
  );
}
