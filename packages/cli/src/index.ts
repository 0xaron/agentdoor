#!/usr/bin/env node

/**
 * AgentDoor CLI — the command-line tool for setting up and managing
 * AgentDoor integrations.
 *
 * Commands:
 *   init     - Interactive setup (or --from-openapi for auto-import)
 *   status   - Check current AgentDoor configuration and endpoint status
 *   keygen   - Generate Ed25519 keypair for agent authentication
 *
 * Usage:
 *   npx agentdoor init
 *   npx agentdoor init --from-openapi ./openapi.yaml
 *   npx agentdoor status
 *   npx agentdoor status --url http://localhost:3000
 *   npx agentdoor keygen
 */

import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerKeygenCommand } from "./commands/keygen.js";

const program = new Command();

program
  .name("agentdoor")
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
