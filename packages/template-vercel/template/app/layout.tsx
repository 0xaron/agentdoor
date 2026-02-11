import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent-Ready API | AgentDoor",
  description: "An API powered by AgentDoor with x402 micropayments",
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
