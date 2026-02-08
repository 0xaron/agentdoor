/**
 * `agentgate init` — Interactive setup command.
 *
 * Two modes:
 *   1. Interactive: prompts for framework, scopes, pricing, x402 config.
 *   2. --from-openapi: reads an OpenAPI spec and auto-generates everything.
 *
 * Generates:
 *   - agentgate.config.ts
 *   - public/.well-known/agentgate.json
 *   - public/.well-known/agent-card.json (A2A compat)
 */

import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseOpenApiSpec, type InferredScope } from "../openapi-parser.js";
import { generateConfigFile, generateDiscoveryJson, generateA2ACard } from "../templates/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InitOptions {
  fromOpenapi?: string;
  output?: string;
  yes?: boolean;
}

type FrameworkChoice = "nextjs" | "express" | "hono" | "fastapi" | "other";

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

async function detectFramework(cwd: string): Promise<FrameworkChoice | null> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as Record<string, Record<string, string>>;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps["next"]) return "nextjs";
    if (deps["hono"]) return "hono";
    if (deps["express"]) return "express";
    if (deps["fastapi"]) return "fastapi";
  } catch {
    // Ignore parse errors.
  }

  return null;
}

// ---------------------------------------------------------------------------
// Interactive flow
// ---------------------------------------------------------------------------

async function interactiveInit(cwd: string, options: InitOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n  AgentGate Setup\n"));

  const detectedFramework = await detectFramework(cwd);

  // Step 1: Framework selection.
  const { framework } = await inquirer.prompt<{ framework: FrameworkChoice }>([
    {
      type: "list",
      name: "framework",
      message: `What framework are you using?${detectedFramework ? chalk.dim(` (auto-detected: ${detectedFramework})`) : ""}`,
      choices: [
        { name: "Next.js (App Router)", value: "nextjs" },
        { name: "Express.js", value: "express" },
        { name: "Hono", value: "hono" },
        { name: "FastAPI (Python)", value: "fastapi" },
        { name: "Other", value: "other" },
      ],
      default: detectedFramework ?? "express",
    },
  ]);

  // Step 2: OpenAPI spec.
  const { hasOpenapi } = await inquirer.prompt<{ hasOpenapi: boolean }>([
    {
      type: "confirm",
      name: "hasOpenapi",
      message: "Do you have an OpenAPI spec?",
      default: false,
    },
  ]);

  let scopes: InferredScope[] = [];

  if (hasOpenapi) {
    const { openapiPath } = await inquirer.prompt<{ openapiPath: string }>([
      {
        type: "input",
        name: "openapiPath",
        message: "Path to OpenAPI spec:",
        default: "./openapi.yaml",
        validate: (input: string) => {
          const resolved = resolve(cwd, input);
          return existsSync(resolved) || `File not found: ${resolved}`;
        },
      },
    ]);

    console.log(chalk.dim("\n  Parsing OpenAPI spec..."));
    const specPath = resolve(cwd, openapiPath);
    const specContent = await readFile(specPath, "utf-8");
    scopes = parseOpenApiSpec(specContent);
    console.log(chalk.green(`  Found ${scopes.length} scopes from ${scopes.length} endpoint groups\n`));

    // Let user select which scopes to expose.
    if (scopes.length > 0) {
      const { selectedScopes } = await inquirer.prompt<{ selectedScopes: string[] }>([
        {
          type: "checkbox",
          name: "selectedScopes",
          message: "Select scopes to expose to agents:",
          choices: scopes.map((s) => ({
            name: `${s.id.padEnd(20)} ${s.description.padEnd(30)} ${chalk.dim(s.suggestedPrice ?? "")}`,
            value: s.id,
            checked: !s.id.includes("admin") && !s.id.includes("delete"),
          })),
        },
      ]);

      scopes = scopes.filter((s) => selectedScopes.includes(s.id));
    }
  } else {
    // Manual scope entry.
    const { scopeInput } = await inquirer.prompt<{ scopeInput: string }>([
      {
        type: "input",
        name: "scopeInput",
        message: 'Enter scope IDs (comma-separated, e.g. "data.read, data.write"):',
        default: "data.read, data.write",
      },
    ]);

    scopes = scopeInput.split(",").map((s) => s.trim()).filter(Boolean).map((id) => ({
      id,
      description: `Access to ${id}`,
      suggestedPrice: "$0.001/req",
      method: "GET",
      pathPattern: `/${id.replace(".", "/")}/*`,
    }));
  }

  // Step 3: Service info.
  const { serviceName, serviceDescription } = await inquirer.prompt<{
    serviceName: string;
    serviceDescription: string;
  }>([
    {
      type: "input",
      name: "serviceName",
      message: "Service name:",
      default: "My API",
    },
    {
      type: "input",
      name: "serviceDescription",
      message: "Service description:",
      default: "API with AgentGate integration",
    },
  ]);

  // Step 4: x402 payments.
  const { enableX402 } = await inquirer.prompt<{ enableX402: boolean }>([
    {
      type: "confirm",
      name: "enableX402",
      message: "Enable x402 payments?",
      default: true,
    },
  ]);

  let x402Wallet: string | undefined;
  let x402Network: string | undefined;

  if (enableX402) {
    const answers = await inquirer.prompt<{ wallet: string; network: string }>([
      {
        type: "input",
        name: "wallet",
        message: "Your x402 wallet address:",
        validate: (input: string) => input.length > 0 || "Wallet address is required",
      },
      {
        type: "list",
        name: "network",
        message: "Preferred network:",
        choices: ["base", "solana", "ethereum", "polygon"],
        default: "base",
      },
    ]);
    x402Wallet = answers.wallet;
    x402Network = answers.network;
  }

  // Step 5: Generate files.
  console.log(chalk.dim("\n  Generating files...\n"));

  const outputDir = options.output ? resolve(cwd, options.output) : cwd;

  const configScopes = scopes.map((s) => ({
    id: s.id,
    description: s.description,
    price: s.suggestedPrice,
    rateLimit: "1000/hour",
  }));

  const pricing: Record<string, string> = {};
  for (const s of scopes) {
    if (s.suggestedPrice) {
      pricing[s.id] = s.suggestedPrice;
    }
  }

  // Generate agentgate.config.ts
  const configContent = generateConfigFile({
    framework,
    serviceName,
    serviceDescription,
    scopes: configScopes,
    pricing,
    x402: enableX402
      ? {
          network: x402Network ?? "base",
          currency: "USDC",
          paymentAddress: x402Wallet ?? "",
        }
      : undefined,
  });

  await writeFile(join(outputDir, "agentgate.config.ts"), configContent, "utf-8");
  console.log(chalk.green("  agentgate.config.ts"));

  // Generate .well-known/agentgate.json
  const wellKnownDir = join(outputDir, "public", ".well-known");
  await mkdir(wellKnownDir, { recursive: true });

  const discoveryJson = generateDiscoveryJson({
    serviceName,
    serviceDescription,
    scopes: configScopes,
    x402: enableX402
      ? {
          network: x402Network ?? "base",
          currency: "USDC",
          paymentAddress: x402Wallet ?? "",
        }
      : undefined,
  });

  await writeFile(
    join(wellKnownDir, "agentgate.json"),
    JSON.stringify(discoveryJson, null, 2),
    "utf-8",
  );
  console.log(chalk.green("  public/.well-known/agentgate.json"));

  // Generate .well-known/agent-card.json (A2A compat)
  const agentCard = generateA2ACard({ serviceName, serviceDescription, scopes: configScopes });
  await writeFile(
    join(wellKnownDir, "agent-card.json"),
    JSON.stringify(agentCard, null, 2),
    "utf-8",
  );
  console.log(chalk.green("  public/.well-known/agent-card.json"));

  // Print next steps.
  console.log(chalk.bold.cyan("\n  Next steps:\n"));

  const snippets: Record<FrameworkChoice, string> = {
    nextjs: `  ${chalk.dim("// middleware.ts")}
  import { createAgentGateMiddleware } from "@agentgate/next";
  import config from "./agentgate.config";

  export default createAgentGateMiddleware(config);
  export const config = { matcher: ["/(.*)" ] };`,

    express: `  ${chalk.dim("// server.ts")}
  import agentgate from "@agentgate/express";
  import config from "./agentgate.config";

  app.use(agentgate(config));`,

    hono: `  ${chalk.dim("// index.ts")}
  import { agentgate } from "@agentgate/hono";
  import config from "./agentgate.config";

  agentgate(app, config);`,

    fastapi: `  ${chalk.dim("# main.py")}
  from agentgate_fastapi import AgentGate
  AgentGate(app, config_path="./agentgate.config.json")`,

    other: `  ${chalk.dim("// See docs for your framework")}
  import config from "./agentgate.config";
  // https://agentgate.dev/docs/frameworks`,
  };

  console.log(snippets[framework]);
  console.log();
}

// ---------------------------------------------------------------------------
// --from-openapi flow
// ---------------------------------------------------------------------------

async function initFromOpenApi(cwd: string, specPath: string, options: InitOptions): Promise<void> {
  console.log(chalk.bold.cyan("\n  AgentGate Setup (from OpenAPI)\n"));

  const resolvedPath = resolve(cwd, specPath);

  if (!existsSync(resolvedPath)) {
    console.error(chalk.red(`  Error: File not found: ${resolvedPath}`));
    process.exit(1);
  }

  console.log(chalk.dim(`  Reading OpenAPI spec: ${resolvedPath}`));
  const specContent = await readFile(resolvedPath, "utf-8");
  const scopes = parseOpenApiSpec(specContent);

  if (scopes.length === 0) {
    console.error(chalk.yellow("  Warning: No endpoints found in the OpenAPI spec."));
    console.log(chalk.dim("  Generating config with empty scopes. Edit agentgate.config.ts to add scopes manually.\n"));
  } else {
    console.log(chalk.green(`  Found ${scopes.length} scopes:`));
    for (const s of scopes) {
      const isDestructive = s.method === "DELETE" || s.id.includes("admin");
      const icon = isDestructive ? chalk.yellow("  skip") : chalk.green("  ");
      console.log(`  ${icon} ${s.id.padEnd(22)} ${s.method.padEnd(6)} ${s.pathPattern.padEnd(25)} ${chalk.dim(s.suggestedPrice ?? "")}`);
    }
    console.log();
  }

  const outputDir = options.output ? resolve(cwd, options.output) : cwd;
  const detectedFramework = await detectFramework(cwd);

  // Filter out destructive scopes by default.
  const activeScopes = scopes.filter((s) => s.method !== "DELETE" && !s.id.includes("admin"));

  const configScopes = activeScopes.map((s) => ({
    id: s.id,
    description: s.description,
    price: s.suggestedPrice,
    rateLimit: "1000/hour",
  }));

  const pricing: Record<string, string> = {};
  for (const s of activeScopes) {
    if (s.suggestedPrice) {
      pricing[s.id] = s.suggestedPrice;
    }
  }

  // Generate config file.
  const configContent = generateConfigFile({
    framework: detectedFramework ?? "express",
    serviceName: "My API",
    serviceDescription: "API with AgentGate integration",
    scopes: configScopes,
    pricing,
  });

  await writeFile(join(outputDir, "agentgate.config.ts"), configContent, "utf-8");
  console.log(chalk.green("  Generated agentgate.config.ts"));

  // Generate .well-known files.
  const wellKnownDir = join(outputDir, "public", ".well-known");
  await mkdir(wellKnownDir, { recursive: true });

  const discoveryJson = generateDiscoveryJson({
    serviceName: "My API",
    serviceDescription: "API with AgentGate integration",
    scopes: configScopes,
  });

  await writeFile(
    join(wellKnownDir, "agentgate.json"),
    JSON.stringify(discoveryJson, null, 2),
    "utf-8",
  );
  console.log(chalk.green("  Generated public/.well-known/agentgate.json"));

  const agentCard = generateA2ACard({
    serviceName: "My API",
    serviceDescription: "API with AgentGate integration",
    scopes: configScopes,
  });
  await writeFile(
    join(wellKnownDir, "agent-card.json"),
    JSON.stringify(agentCard, null, 2),
    "utf-8",
  );
  console.log(chalk.green("  Generated public/.well-known/agent-card.json"));

  // Print snippet.
  const framework = detectedFramework ?? "express";
  console.log(chalk.bold.cyan("\n  Next: Add 3 lines to your server:\n"));

  if (framework === "express") {
    console.log(chalk.white(`  const agentgate = require("@agentgate/express");`));
    console.log(chalk.white(`  const config = require("./agentgate.config");`));
    console.log(chalk.white(`  app.use(agentgate(config));`));
  } else if (framework === "nextjs") {
    console.log(chalk.white(`  import { createAgentGateMiddleware } from "@agentgate/next";`));
    console.log(chalk.white(`  import config from "./agentgate.config";`));
    console.log(chalk.white(`  export default createAgentGateMiddleware(config);`));
  } else if (framework === "hono") {
    console.log(chalk.white(`  import { agentgate } from "@agentgate/hono";`));
    console.log(chalk.white(`  import config from "./agentgate.config";`));
    console.log(chalk.white(`  agentgate(app, config);`));
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize AgentGate in your project")
    .option("--from-openapi <path>", "Auto-import from an OpenAPI spec file")
    .option("-o, --output <dir>", "Output directory (defaults to current directory)")
    .option("-y, --yes", "Accept all defaults (non-interactive)")
    .action(async (options: InitOptions) => {
      const cwd = process.cwd();

      if (options.fromOpenapi) {
        await initFromOpenApi(cwd, options.fromOpenapi, options);
      } else {
        await interactiveInit(cwd, options);
      }
    });
}
