import { Router } from "express";
import type { ResolvedConfig } from "@agentdoor/core";
import { generateDiscoveryDocument } from "@agentdoor/core";

/**
 * Creates a router that serves the AgentDoor discovery document
 * at GET /.well-known/agentdoor.json.
 *
 * The discovery document is generated once from config and cached
 * in memory. It tells agents everything they need to know:
 * available scopes, pricing, registration endpoint, auth methods, etc.
 *
 * Response is served with Cache-Control: public, max-age=3600 so
 * CDNs and agents can cache it for up to 1 hour.
 */
export function createDiscoveryRouter(config: ResolvedConfig): Router {
  const router = Router();

  // Pre-generate the discovery document at startup so we avoid
  // re-computing it on every request. The document is static
  // for the lifetime of the server process.
  const discoveryDocument = generateDiscoveryDocument(config);
  const documentBody = JSON.stringify(discoveryDocument);

  router.get("/.well-known/agentdoor.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-AgentDoor-Version", discoveryDocument.agentdoor_version);
    res.status(200).send(documentBody);
  });

  return router;
}
