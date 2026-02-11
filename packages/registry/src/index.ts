/**
 * @agentdoor/registry
 *
 * Agent Registry - a searchable index that crawls /.well-known/agentdoor.json
 * endpoints to build a directory of AgentDoor-enabled services.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Crawler
// ---------------------------------------------------------------------------

export { AgentDoorCrawler } from "./crawler.js";

export type { CrawlTarget, CrawlerConfig } from "./crawler.js";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export { AgentRegistry } from "./registry.js";

export type { RegistryEntry, RegistrySearchOptions } from "./registry.js";

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export { createRegistryApi } from "./api.js";
