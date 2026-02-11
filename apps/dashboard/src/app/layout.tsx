import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AgentDoor Dashboard",
  description:
    "Monitor agent registrations, usage, and revenue for your AgentDoor-enabled APIs.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #f8f9fb;
            color: #1a1a2e;
            line-height: 1.5;
          }
          a { color: inherit; text-decoration: none; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
