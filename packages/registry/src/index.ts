/**
 * @agentgate/registry
 *
 * Agent Registry - a searchable index that crawls /.well-known/agentgate.json
 * endpoints to build a directory of AgentGate-enabled services.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Crawler
// ---------------------------------------------------------------------------

export { AgentGateCrawler } from "./crawler.js";

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
