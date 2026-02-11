export default function Home() {
  return (
    <main
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "4rem 2rem",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: "#111",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
        Agent-Ready API
      </h1>
      <p style={{ color: "#666", marginBottom: "2rem" }}>
        Powered by <strong>AgentDoor</strong> + <strong>x402</strong>{" "}
        micropayments
      </p>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
          Endpoints
        </h2>
        <ul style={{ paddingLeft: "1.5rem" }}>
          <li>
            <code>GET /api/data</code> &mdash; Read data (scope:{" "}
            <code>data.read</code>, $0.001/req)
          </li>
          <li>
            <code>POST /api/data</code> &mdash; Write data (scope:{" "}
            <code>data.write</code>, $0.01/req)
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
          Agent Discovery
        </h2>
        <p>
          Agents can discover this API at{" "}
          <a href="/.well-known/agentdoor" style={{ color: "#0070f3" }}>
            /.well-known/agentdoor
          </a>
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
          How It Works
        </h2>
        <ol style={{ paddingLeft: "1.5rem" }}>
          <li>Agent discovers capabilities via <code>/.well-known/agentdoor</code></li>
          <li>Agent authenticates and negotiates scopes</li>
          <li>x402 handles micropayments (USDC on Base)</li>
          <li>Agent calls API endpoints with valid credentials</li>
        </ol>
      </section>

      <footer style={{ color: "#999", fontSize: "0.875rem", borderTop: "1px solid #eee", paddingTop: "1rem" }}>
        Built with{" "}
        <a
          href="https://github.com/agentdoor/agentdoor"
          style={{ color: "#0070f3" }}
        >
          AgentDoor
        </a>
      </footer>
    </main>
  );
}
