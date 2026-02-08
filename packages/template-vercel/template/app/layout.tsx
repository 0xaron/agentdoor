import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent-Ready API | AgentGate",
  description: "An API powered by AgentGate with x402 micropayments",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
