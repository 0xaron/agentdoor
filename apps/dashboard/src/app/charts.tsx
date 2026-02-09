"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

// ---------------------------------------------------------------------------
// Traffic Chart (agent vs human stacked bars)
// ---------------------------------------------------------------------------

export function TrafficChart({
  data,
}: {
  data: { label: string; agents: number; humans: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6b7280" }} />
        <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="agents" stackId="traffic" fill="#6366f1" name="Agents" />
        <Bar dataKey="humans" stackId="traffic" fill="#93c5fd" name="Humans" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Revenue Chart (x402 vs subscriptions stacked bars)
// ---------------------------------------------------------------------------

export function RevenueChart({
  data,
}: {
  data: { label: string; x402: number; subscriptions: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6b7280" }} />
        <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Tooltip formatter={(value: any) => `$${Number(value).toLocaleString()}`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="x402" stackId="revenue" fill="#10b981" name="x402 Revenue" />
        <Bar dataKey="subscriptions" stackId="revenue" fill="#a7f3d0" name="Subscriptions" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Registrations Per Day Chart (horizontal bar chart)
// ---------------------------------------------------------------------------

export function RegistrationsChart({
  data,
}: {
  data: { date: string; count: number }[];
}) {
  const formatted = data.map((d) => ({
    date: d.date.slice(5), // "01-03" from "2026-01-03"
    count: d.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(data.length * 40, 100)}>
      <BarChart data={formatted} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis type="number" tick={{ fontSize: 12, fill: "#6b7280" }} />
        <YAxis dataKey="date" type="category" tick={{ fontSize: 12, fill: "#6b7280" }} width={50} />
        <Tooltip />
        <Bar dataKey="count" fill="#6366f1" name="Registrations" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Framework Breakdown (horizontal bar chart)
// ---------------------------------------------------------------------------

export function FrameworkChart({
  data,
}: {
  data: { name: string; percentage: number; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={data.length * 50}>
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis type="number" tick={{ fontSize: 12, fill: "#6b7280" }} domain={[0, 100]} unit="%" />
        <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: "#6b7280" }} width={80} />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Tooltip formatter={(value: any, _name: any, props: any) => [`${Number(value)}% (${props.payload.count} agents)`, "Usage"]} />
        <Bar dataKey="percentage" fill="#6366f1" name="Usage %" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
