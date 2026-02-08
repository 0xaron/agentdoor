/**
 * Registry API
 *
 * Express-compatible router factory for the AgentRegistry.
 * Returns an object with route handler methods that can be mounted
 * on any Express-like router.
 *
 * Routes:
 *   GET    /api/registry      - List/search services
 *   GET    /api/registry/:id  - Get service details
 *   POST   /api/registry      - Submit a URL for crawling
 *   DELETE /api/registry/:id  - Remove a service
 */

import type { AgentRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Types for Express-like request/response
// ---------------------------------------------------------------------------

interface ApiRequest {
  query?: Record<string, string | undefined>;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(data: unknown): void;
}

type RouteHandler = (req: ApiRequest, res: ApiResponse) => Promise<void>;

export interface RegistryRouter {
  /** GET /api/registry - list/search services */
  listServices: RouteHandler;
  /** GET /api/registry/:id - get service details */
  getService: RouteHandler;
  /** POST /api/registry - submit a URL for crawling */
  addService: RouteHandler;
  /** DELETE /api/registry/:id - remove a service */
  removeService: RouteHandler;

  /**
   * Attach all routes to an Express-like router.
   * Usage: `createRegistryApi(registry).mount(expressRouter, "/api/registry")`
   */
  mount(router: unknown, basePath?: string): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an Express-compatible set of route handlers for the registry.
 *
 * @param registry - The AgentRegistry instance to serve
 * @returns A RegistryRouter with route handler methods and a mount helper
 */
export function createRegistryApi(registry: AgentRegistry): RegistryRouter {
  // GET /api/registry
  const listServices: RouteHandler = async (req, res) => {
    try {
      const query = req.query?.query;
      const scope = req.query?.scope;
      const hasPayment =
        req.query?.hasPayment !== undefined
          ? req.query.hasPayment === "true"
          : undefined;
      const limit = req.query?.limit ? parseInt(req.query.limit, 10) : 50;
      const offset = req.query?.offset ? parseInt(req.query.offset, 10) : 0;

      const results = await registry.search({
        query,
        scope,
        hasPayment,
        limit,
        offset,
      });

      res.status(200).json({
        success: true,
        data: results,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
        timestamp: new Date().toISOString(),
      });
    }
  };

  // GET /api/registry/:id
  const getService: RouteHandler = async (req, res) => {
    try {
      const id = req.params?.id;
      if (!id) {
        res.status(400).json({
          success: false,
          error: "Missing service ID",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const entry = await registry.getServiceById(id);
      if (!entry) {
        res.status(404).json({
          success: false,
          error: `Service ${id} not found`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: entry,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
        timestamp: new Date().toISOString(),
      });
    }
  };

  // POST /api/registry
  const addService: RouteHandler = async (req, res) => {
    try {
      const url = req.body?.url;
      if (!url || typeof url !== "string") {
        res.status(400).json({
          success: false,
          error: 'Missing or invalid "url" in request body',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const entry = await registry.addService(url);

      res.status(201).json({
        success: true,
        data: entry,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to add service",
        timestamp: new Date().toISOString(),
      });
    }
  };

  // DELETE /api/registry/:id
  const removeService: RouteHandler = async (req, res) => {
    try {
      const id = req.params?.id;
      if (!id) {
        res.status(400).json({
          success: false,
          error: "Missing service ID",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const removed = await registry.removeServiceById(id);
      if (!removed) {
        res.status(404).json({
          success: false,
          error: `Service ${id} not found`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { deleted: id },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
        timestamp: new Date().toISOString(),
      });
    }
  };

  // Mount helper for Express routers
  const mount = (router: unknown, basePath = "/api/registry") => {
    const r = router as Record<string, (...args: unknown[]) => unknown>;
    if (typeof r.get === "function") {
      r.get(basePath, listServices);
      r.get(`${basePath}/:id`, getService);
    }
    if (typeof r.post === "function") {
      r.post(basePath, addService);
    }
    if (typeof r.delete === "function") {
      r.delete(`${basePath}/:id`, removeService);
    }
  };

  return {
    listServices,
    getService,
    addService,
    removeService,
    mount,
  };
}
