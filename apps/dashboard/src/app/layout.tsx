import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AgentGate Dashboard",
  description:
    "Monitor agent registrations, usage, and revenue for your AgentGate-enabled APIs.",
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
