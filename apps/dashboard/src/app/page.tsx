export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>
        AgentGate Dashboard
      </h1>
      <p
        style={{
          fontSize: "1.25rem",
          color: "#666",
          maxWidth: "600px",
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        Monitor agent registrations, usage, and revenue.
      </p>
      <div
        style={{
          marginTop: "2rem",
          padding: "1.5rem 2rem",
          borderRadius: "8px",
          backgroundColor: "#f5f5f5",
          border: "1px solid #e0e0e0",
        }}
      >
        <p style={{ margin: 0, color: "#888" }}>
          This dashboard is currently under development. Check back soon for
          agent analytics, registration management, and revenue tracking.
        </p>
      </div>
    </main>
  );
}
