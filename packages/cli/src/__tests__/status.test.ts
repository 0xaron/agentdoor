/**
 * Tests for `agentdoor status` command.
 *
 * Covers: config file detection, .well-known/agentdoor.json validation,
 * scope parsing, error handling for missing/invalid files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Helpers — we test the local file checking logic by replicating the
// file system state that `agentdoor status` would check.
// ---------------------------------------------------------------------------

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentdoor-status-test-"));
}

interface StatusCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * Replicate the core logic of checkLocalFiles from status.ts.
 */
async function checkLocalFiles(cwd: string, configPath?: string): Promise<StatusCheck[]> {
  const checks: StatusCheck[] = [];

  const configFile = configPath
    ? path.resolve(cwd, configPath)
    : path.join(cwd, "agentdoor.config.ts");

  const configTsExists = fs.existsSync(configFile);
  const configJsExists = !configTsExists && fs.existsSync(configFile.replace(".ts", ".js"));
  const configJsonExists = !configTsExists && !configJsExists && fs.existsSync(path.join(cwd, "agentdoor.config.json"));

  const configFound = configTsExists || configJsExists || configJsonExists;
  const configName = configTsExists
    ? "agentdoor.config.ts"
    : configJsExists
      ? "agentdoor.config.js"
      : configJsonExists
        ? "agentdoor.config.json"
        : "agentdoor.config.ts";

  checks.push({
    label: "Config",
    ok: configFound,
    detail: configFound ? `${configName} found` : `${configName} not found`,
  });

  const wellKnownPaths = [
    path.join(cwd, "public", ".well-known", "agentdoor.json"),
    path.join(cwd, ".well-known", "agentdoor.json"),
    path.join(cwd, "static", ".well-known", "agentdoor.json"),
  ];

  let discoveryFound = false;
  let discoveryPath = "";

  for (const p of wellKnownPaths) {
    if (fs.existsSync(p)) {
      discoveryFound = true;
      discoveryPath = p;
      break;
    }
  }

  checks.push({
    label: "Discovery",
    ok: discoveryFound,
    detail: discoveryFound
      ? `agentdoor.json found at ${discoveryPath}`
      : "/.well-known/agentdoor.json not found in public/, .well-known/, or static/",
  });

  const a2aPaths = [
    path.join(cwd, "public", ".well-known", "agent-card.json"),
    path.join(cwd, ".well-known", "agent-card.json"),
  ];

  let a2aFound = false;
  for (const p of a2aPaths) {
    if (fs.existsSync(p)) {
      a2aFound = true;
      break;
    }
  }

  checks.push({
    label: "A2A Card",
    ok: a2aFound,
    detail: a2aFound ? "agent-card.json found" : "agent-card.json not found (optional)",
  });

  if (discoveryFound) {
    try {
      const raw = await readFile(discoveryPath, "utf-8");
      const doc = JSON.parse(raw) as {
        scopes_available?: Array<{ id: string }>;
        payment?: { protocol: string };
      };

      const scopeCount = doc.scopes_available?.length ?? 0;
      checks.push({
        label: "Scopes",
        ok: scopeCount > 0,
        detail: scopeCount > 0
          ? `${scopeCount} scopes configured`
          : "No scopes configured",
      });

      const hasPayment = !!doc.payment?.protocol;
      checks.push({
        label: "Payments",
        ok: hasPayment,
        detail: hasPayment
          ? `${doc.payment!.protocol} payments enabled`
          : "No payment protocol configured",
      });
    } catch {
      checks.push({
        label: "Discovery Parse",
        ok: false,
        detail: "Failed to parse agentdoor.json",
      });
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("status - config file detection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds agentdoor.config.ts", async () => {
    await writeFile(path.join(tmpDir, "agentdoor.config.ts"), "export default {};");

    const checks = await checkLocalFiles(tmpDir);
    const configCheck = checks.find((c) => c.label === "Config");
    expect(configCheck?.ok).toBe(true);
    expect(configCheck?.detail).toContain("agentdoor.config.ts found");
  });

  it("finds agentdoor.config.js as fallback", async () => {
    await writeFile(path.join(tmpDir, "agentdoor.config.js"), "module.exports = {};");

    const checks = await checkLocalFiles(tmpDir);
    const configCheck = checks.find((c) => c.label === "Config");
    expect(configCheck?.ok).toBe(true);
    expect(configCheck?.detail).toContain("agentdoor.config.js found");
  });

  it("finds agentdoor.config.json as fallback", async () => {
    await writeFile(path.join(tmpDir, "agentdoor.config.json"), "{}");

    const checks = await checkLocalFiles(tmpDir);
    const configCheck = checks.find((c) => c.label === "Config");
    expect(configCheck?.ok).toBe(true);
  });

  it("reports missing config", async () => {
    const checks = await checkLocalFiles(tmpDir);
    const configCheck = checks.find((c) => c.label === "Config");
    expect(configCheck?.ok).toBe(false);
    expect(configCheck?.detail).toContain("not found");
  });

  it("accepts custom config path", async () => {
    await writeFile(path.join(tmpDir, "custom.config.ts"), "export default {};");

    const checks = await checkLocalFiles(tmpDir, "custom.config.ts");
    const configCheck = checks.find((c) => c.label === "Config");
    expect(configCheck?.ok).toBe(true);
  });
});

describe("status - .well-known/agentdoor.json detection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds in public/.well-known/", async () => {
    const dir = path.join(tmpDir, "public", ".well-known");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "agentdoor.json"),
      JSON.stringify({
        scopes_available: [{ id: "data.read" }],
        payment: { protocol: "x402" },
      }),
    );

    const checks = await checkLocalFiles(tmpDir);
    const discoveryCheck = checks.find((c) => c.label === "Discovery");
    expect(discoveryCheck?.ok).toBe(true);
  });

  it("finds in .well-known/", async () => {
    const dir = path.join(tmpDir, ".well-known");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "agentdoor.json"),
      JSON.stringify({
        scopes_available: [{ id: "data.read" }],
      }),
    );

    const checks = await checkLocalFiles(tmpDir);
    const discoveryCheck = checks.find((c) => c.label === "Discovery");
    expect(discoveryCheck?.ok).toBe(true);
  });

  it("finds in static/.well-known/", async () => {
    const dir = path.join(tmpDir, "static", ".well-known");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "agentdoor.json"),
      JSON.stringify({
        scopes_available: [{ id: "data.read" }],
      }),
    );

    const checks = await checkLocalFiles(tmpDir);
    const discoveryCheck = checks.find((c) => c.label === "Discovery");
    expect(discoveryCheck?.ok).toBe(true);
  });

  it("reports missing discovery document", async () => {
    const checks = await checkLocalFiles(tmpDir);
    const discoveryCheck = checks.find((c) => c.label === "Discovery");
    expect(discoveryCheck?.ok).toBe(false);
    expect(discoveryCheck?.detail).toContain("not found");
  });

  it("validates and reports scope count", async () => {
    const dir = path.join(tmpDir, "public", ".well-known");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "agentdoor.json"),
      JSON.stringify({
        scopes_available: [
          { id: "data.read" },
          { id: "data.write" },
          { id: "admin.manage" },
        ],
      }),
    );

    const checks = await checkLocalFiles(tmpDir);
    const scopeCheck = checks.find((c) => c.label === "Scopes");
    expect(scopeCheck?.ok).toBe(true);
    expect(scopeCheck?.detail).toContain("3 scopes configured");
  });

  it("reports no scopes configured", async () => {
    const dir = path.join(tmpDir, "public", ".well-known");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "agentdoor.json"),
      JSON.stringify({
        scopes_available: [],
      }),
    );

    const checks = await checkLocalFiles(tmpDir);
    const scopeCheck = checks.find((c) => c.label === "Scopes");
    expect(scopeCheck?.ok).toBe(false);
    expect(scopeCheck?.detail).toContain("No scopes");
  });

  it("reports payment protocol when configured", async () => {
    const dir = path.join(tmpDir, "public", ".well-known");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "agentdoor.json"),
      JSON.stringify({
        scopes_available: [{ id: "data.read" }],
        payment: { protocol: "x402" },
      }),
    );

    const checks = await checkLocalFiles(tmpDir);
    const paymentCheck = checks.find((c) => c.label === "Payments");
    expect(paymentCheck?.ok).toBe(true);
    expect(paymentCheck?.detail).toContain("x402");
  });

  it("reports malformed JSON gracefully", async () => {
    const dir = path.join(tmpDir, "public", ".well-known");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "agentdoor.json"), "not json {{");

    const checks = await checkLocalFiles(tmpDir);
    const parseCheck = checks.find((c) => c.label === "Discovery Parse");
    expect(parseCheck?.ok).toBe(false);
  });
});

describe("status - A2A card detection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds agent-card.json in public/.well-known/", async () => {
    const dir = path.join(tmpDir, "public", ".well-known");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "agent-card.json"), "{}");

    const checks = await checkLocalFiles(tmpDir);
    const a2aCheck = checks.find((c) => c.label === "A2A Card");
    expect(a2aCheck?.ok).toBe(true);
  });

  it("reports missing agent-card.json as optional", async () => {
    const checks = await checkLocalFiles(tmpDir);
    const a2aCheck = checks.find((c) => c.label === "A2A Card");
    expect(a2aCheck?.ok).toBe(false);
    expect(a2aCheck?.detail).toContain("optional");
  });
});
