/**
 * `agentgate status` — Check current AgentGate configuration and status.
 *
 * Reads the local config file and checks for the presence of required files
 * (.well-known/agentgate.json, etc.). Optionally probes a running server to
 * verify endpoints are live.
 */

import { Command } from "commander";
import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatusOptions {
  url?: string;
  config?: string;
}

interface StatusCheck {
  label: string;
  ok: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Local file checks
// ---------------------------------------------------------------------------

async function checkLocalFiles(cwd: string, configPath?: string): Promise<StatusCheck[]> {
  const checks: StatusCheck[] = [];

  // Check agentgate.config.ts
  const configFile = configPath
    ? resolve(cwd, configPath)
    : join(cwd, "agentgate.config.ts");

  const configTsExists = existsSync(configFile);
  const configJsExists = !configTsExists && existsSync(configFile.replace(".ts", ".js"));
  const configJsonExists = !configTsExists && !configJsExists && existsSync(join(cwd, "agentgate.config.json"));

  const configFound = configTsExists || configJsExists || configJsonExists;
  const configName = configTsExists
    ? "agentgate.config.ts"
    : configJsExists
      ? "agentgate.config.js"
      : configJsonExists
        ? "agentgate.config.json"
        : "agentgate.config.ts";

  checks.push({
    label: "Config",
    ok: configFound,
    detail: configFound ? `${configName} found` : `${configName} not found`,
  });

  // Check .well-known/agentgate.json
  const wellKnownPaths = [
    join(cwd, "public", ".well-known", "agentgate.json"),
    join(cwd, ".well-known", "agentgate.json"),
    join(cwd, "static", ".well-known", "agentgate.json"),
  ];

  let discoveryFound = false;
  let discoveryPath = "";

  for (const p of wellKnownPaths) {
    if (existsSync(p)) {
      discoveryFound = true;
      discoveryPath = p;
      break;
    }
  }

  checks.push({
    label: "Discovery",
    ok: discoveryFound,
    detail: discoveryFound
      ? `agentgate.json found at ${discoveryPath}`
      : "/.well-known/agentgate.json not found in public/, .well-known/, or static/",
  });

  // Check agent-card.json (A2A compat)
  const a2aPaths = [
    join(cwd, "public", ".well-known", "agent-card.json"),
    join(cwd, ".well-known", "agent-card.json"),
  ];

  let a2aFound = false;
  for (const p of a2aPaths) {
    if (existsSync(p)) {
      a2aFound = true;
      break;
    }
  }

  checks.push({
    label: "A2A Card",
    ok: a2aFound,
    detail: a2aFound ? "agent-card.json found" : "agent-card.json not found (optional)",
  });

  // Parse discovery document for scope info.
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
        detail: "Failed to parse agentgate.json",
      });
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Remote endpoint checks
// ---------------------------------------------------------------------------

async function checkRemoteEndpoints(baseUrl: string): Promise<StatusCheck[]> {
  const checks: StatusCheck[] = [];

  // Check discovery endpoint.
  try {
    const discoveryUrl = new URL("/.well-known/agentgate.json", baseUrl).toString();
    const res = await fetch(discoveryUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    checks.push({
      label: "Discovery",
      ok: res.ok,
      detail: res.ok
        ? `/.well-known/agentgate.json serving (${res.status})`
        : `/.well-known/agentgate.json returned ${res.status}`,
    });

    if (res.ok) {
      const body = (await res.json()) as {
        scopes_available?: Array<{ id: string }>;
        registration_endpoint?: string;
        auth_endpoint?: string;
      };

      const scopeCount = body.scopes_available?.length ?? 0;
      checks.push({
        label: "Scopes",
        ok: scopeCount > 0,
        detail: `${scopeCount} scopes available`,
      });

      // Check registration endpoint.
      if (body.registration_endpoint) {
        try {
          const regUrl = new URL(body.registration_endpoint, baseUrl).toString();
          const regRes = await fetch(regUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(5000),
          });

          // We expect a 400 (bad request) since we sent an empty body — that
          // means the endpoint is alive and validating input.
          checks.push({
            label: "Registration",
            ok: regRes.status === 400 || regRes.status === 200 || regRes.status === 201,
            detail: `${body.registration_endpoint} (POST) responding (${regRes.status})`,
          });
        } catch {
          checks.push({
            label: "Registration",
            ok: false,
            detail: `${body.registration_endpoint} (POST) unreachable`,
          });
        }
      }

      // Check auth endpoint.
      if (body.auth_endpoint) {
        try {
          const authUrl = new URL(body.auth_endpoint, baseUrl).toString();
          const authRes = await fetch(authUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(5000),
          });

          checks.push({
            label: "Auth",
            ok: authRes.status === 400 || authRes.status === 200,
            detail: `${body.auth_endpoint} (POST) responding (${authRes.status})`,
          });
        } catch {
          checks.push({
            label: "Auth",
            ok: false,
            detail: `${body.auth_endpoint} (POST) unreachable`,
          });
        }
      }
    }
  } catch (err) {
    checks.push({
      label: "Connection",
      ok: false,
      detail: `Failed to connect to ${baseUrl}: ${err instanceof Error ? err.message : "unknown error"}`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function displayChecks(title: string, checks: StatusCheck[]): void {
  console.log(chalk.bold.cyan(`\n  ${title}\n`));

  for (const check of checks) {
    const icon = check.ok ? chalk.green("OK") : chalk.red("FAIL");
    const label = check.label.padEnd(15);
    console.log(`   ${icon} ${label} ${check.detail}`);
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Check current AgentGate configuration and endpoint status")
    .option("-u, --url <url>", "Base URL of a running server to probe endpoints")
    .option("-c, --config <path>", "Path to agentgate config file")
    .action(async (options: StatusOptions) => {
      const cwd = process.cwd();

      // Local file checks.
      const localChecks = await checkLocalFiles(cwd, options.config);
      displayChecks("AgentGate Status (Local)", localChecks);

      // Remote checks if URL provided.
      if (options.url) {
        const remoteChecks = await checkRemoteEndpoints(options.url);
        displayChecks("AgentGate Status (Remote)", remoteChecks);
      } else {
        console.log(
          chalk.dim("   Tip: Use --url <base-url> to probe a running server's endpoints.\n"),
        );
      }

      // Summary.
      const allOk = localChecks.every((c) => c.ok);
      if (allOk) {
        console.log(chalk.green("  All checks passed.\n"));
      } else {
        const failCount = localChecks.filter((c) => !c.ok).length;
        console.log(
          chalk.yellow(`  ${failCount} check(s) need attention. Run "agentgate init" to fix.\n`),
        );
      }
    });
}
