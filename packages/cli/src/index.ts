#!/usr/bin/env node

/**
 * AgentGate CLI — the command-line tool for setting up and managing
 * AgentGate integrations.
 *
 * Commands:
 *   init     - Interactive setup (or --from-openapi for auto-import)
 *   status   - Check current AgentGate configuration and endpoint status
 *   keygen   - Generate Ed25519 keypair for agent authentication
 *
 * Usage:
 *   npx agentgate init
 *   npx agentgate init --from-openapi ./openapi.yaml
 *   npx agentgate status
 *   npx agentgate status --url http://localhost:3000
 *   npx agentgate keygen
 */

import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerKeygenCommand } from "./commands/keygen.js";

const program = new Command();

program
  .name("agentgate")
  .description("Make your website agent-ready in 3 lines of code")
  .version("0.1.0");

// Register commands.
registerInitCommand(program);
registerStatusCommand(program);
registerKeygenCommand(program);

// Parse and execute.
program.parse(process.argv);

// Show help if no command provided.
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
