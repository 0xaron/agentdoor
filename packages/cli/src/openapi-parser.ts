/**
 * OpenAPI spec parser. Reads an OpenAPI 3.x YAML/JSON spec and infers
 * AgentGate scopes from endpoint paths and HTTP methods.
 *
 * Suggests pricing based on operation complexity:
 *   - GET (read)       → $0.001/req
 *   - POST (create)    → $0.01/req
 *   - PUT/PATCH        → $0.005/req
 *   - DELETE           → $0.02/req
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InferredScope {
  /** Scope identifier, e.g. "weather.read". */
  id: string;

  /** Human-readable description. */
  description: string;

  /** Suggested price per request. */
  suggestedPrice: string;

  /** HTTP method(s) this scope covers. */
  method: string;

  /** URL path pattern this scope covers. */
  pathPattern: string;
}

interface OpenApiPath {
  [method: string]: OpenApiOperation | undefined;
}

interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: unknown[];
  responses?: Record<string, unknown>;
}

interface OpenApiSpec {
  openapi?: string;
  info?: { title?: string; description?: string; version?: string };
  paths?: Record<string, OpenApiPath>;
  tags?: Array<{ name: string; description?: string }>;
}

// ---------------------------------------------------------------------------
// Pricing heuristics
// ---------------------------------------------------------------------------

const METHOD_PRICES: Record<string, string> = {
  get: "$0.001/req",
  head: "$0.001/req",
  options: "$0.001/req",
  post: "$0.01/req",
  put: "$0.005/req",
  patch: "$0.005/req",
  delete: "$0.02/req",
};

function suggestPrice(method: string): string {
  return METHOD_PRICES[method.toLowerCase()] ?? "$0.005/req";
}

// ---------------------------------------------------------------------------
// Scope ID generation
// ---------------------------------------------------------------------------

/**
 * Convert a URL path like `/api/weather/forecast` into a scope group
 * like `weather`. Uses the first meaningful path segment after common
 * prefixes (api, v1, v2, etc.).
 */
function pathToGroup(path: string): string {
  const segments = path
    .split("/")
    .filter(Boolean)
    .filter((s) => !s.startsWith("{") && !s.startsWith(":")) // Skip params
    .filter((s) => !/^(api|v\d+)$/i.test(s)); // Skip prefixes

  if (segments.length === 0) return "root";

  // Use the first meaningful segment as the group.
  return segments[0].toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Map an HTTP method to a scope action verb.
 */
function methodToAction(method: string): string {
  const map: Record<string, string> = {
    get: "read",
    head: "read",
    options: "read",
    post: "write",
    put: "write",
    patch: "write",
    delete: "delete",
  };
  return map[method.toLowerCase()] ?? "access";
}

// ---------------------------------------------------------------------------
// YAML parsing (minimal, handles common cases)
// ---------------------------------------------------------------------------

/**
 * Minimal YAML-to-JSON parser. Handles the subset of YAML commonly used
 * in OpenAPI specs (mappings, sequences, scalars, multi-line strings).
 *
 * For production use, consumers should install `yaml` or `js-yaml` and
 * parse externally. This is a best-effort fallback.
 */
function parseYaml(input: string): unknown {
  // If it looks like JSON, parse as JSON.
  const trimmed = input.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }

  // Extremely minimal YAML subset parser.
  // This handles flat and one-level-nested mappings which is enough for
  // extracting paths/methods from most OpenAPI specs.
  const result: Record<string, unknown> = {};
  const lines = input.split("\n");
  let currentKey = "";
  void 0; // _currentIndent removed (was unused)
  let inPaths = false;
  const paths: Record<string, Record<string, Record<string, unknown>>> = {};
  let currentPath = "";
  let currentMethod = "";

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");

    // Skip comments and empty lines.
    if (/^\s*(#|$)/.test(line)) continue;

    const indent = line.search(/\S/);
    const content = line.trim();

    // Top-level key: value.
    if (indent === 0 && content.includes(":")) {
      const colonIdx = content.indexOf(":");
      const key = content.slice(0, colonIdx).trim();
      const value = content.slice(colonIdx + 1).trim();

      currentKey = key;
      // indent tracking removed
      inPaths = key === "paths";

      if (value && !value.startsWith("{") && !value.startsWith("[")) {
        // Scalar value — strip quotes.
        result[key] = value.replace(/^["']|["']$/g, "");
      } else if (value) {
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
      }
      continue;
    }

    if (inPaths) {
      // Path level (indent ~2): /api/weather:
      if (indent === 2 && content.endsWith(":")) {
        currentPath = content.slice(0, -1).trim();
        if (currentPath.startsWith("/")) {
          paths[currentPath] = {};
        }
        continue;
      }

      // Method level (indent ~4): get:
      if (indent === 4 && content.endsWith(":") && currentPath) {
        currentMethod = content.slice(0, -1).trim().toLowerCase();
        if (["get", "post", "put", "patch", "delete", "head", "options"].includes(currentMethod)) {
          paths[currentPath][currentMethod] = {};
        }
        continue;
      }

      // Operation details (indent ~6): summary: "..."
      if (indent >= 6 && content.includes(":") && currentPath && currentMethod) {
        const colonIdx = content.indexOf(":");
        const key = content.slice(0, colonIdx).trim();
        const value = content.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");

        if (paths[currentPath]?.[currentMethod]) {
          paths[currentPath][currentMethod][key] = value;
        }
        continue;
      }
    }

    // Info block.
    if (currentKey === "info" && indent === 2 && content.includes(":")) {
      if (!result.info) result.info = {};
      const colonIdx = content.indexOf(":");
      const key = content.slice(0, colonIdx).trim();
      const value = content.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      (result.info as Record<string, string>)[key] = value;
    }
  }

  if (Object.keys(paths).length > 0) {
    result.paths = paths;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse an OpenAPI spec (JSON or YAML string) and infer AgentGate scopes.
 *
 * @param specContent - Raw OpenAPI spec content (JSON or YAML).
 * @returns Array of inferred scopes with suggested pricing.
 *
 * @example
 * ```ts
 * const scopes = parseOpenApiSpec(fs.readFileSync("./openapi.yaml", "utf-8"));
 * // [
 * //   { id: "weather.read", description: "Read weather data", suggestedPrice: "$0.001/req", ... },
 * //   { id: "weather.write", description: "Write weather data", suggestedPrice: "$0.01/req", ... },
 * // ]
 * ```
 */
export function parseOpenApiSpec(specContent: string): InferredScope[] {
  let spec: OpenApiSpec;

  try {
    spec = parseYaml(specContent) as OpenApiSpec;
  } catch {
    try {
      spec = JSON.parse(specContent) as OpenApiSpec;
    } catch {
      return [];
    }
  }

  if (!spec.paths || typeof spec.paths !== "object") {
    return [];
  }

  // Group endpoints by (group, action) to create scopes.
  const scopeMap = new Map<
    string,
    {
      methods: Set<string>;
      paths: string[];
      descriptions: string[];
    }
  >();

  for (const [path, operations] of Object.entries(spec.paths)) {
    if (!operations || typeof operations !== "object") continue;

    for (const [method, operation] of Object.entries(operations)) {
      if (!operation || typeof operation !== "object") continue;

      const lowerMethod = method.toLowerCase();
      if (!["get", "post", "put", "patch", "delete", "head", "options"].includes(lowerMethod)) {
        continue;
      }

      const group = pathToGroup(path);
      const action = methodToAction(lowerMethod);
      const scopeId = `${group}.${action}`;

      if (!scopeMap.has(scopeId)) {
        scopeMap.set(scopeId, {
          methods: new Set(),
          paths: [],
          descriptions: [],
        });
      }

      const entry = scopeMap.get(scopeId)!;
      entry.methods.add(lowerMethod.toUpperCase());
      entry.paths.push(path);

      const op = operation as OpenApiOperation;
      if (op.summary) {
        entry.descriptions.push(op.summary);
      } else if (op.description) {
        entry.descriptions.push(op.description.split("\n")[0]);
      }
    }
  }

  // Convert grouped entries into InferredScope objects.
  const scopes: InferredScope[] = [];

  for (const [scopeId, entry] of scopeMap.entries()) {
    const methods = Array.from(entry.methods);
    const primaryMethod = methods[0] ?? "GET";

    // Build a description from the first available operation summary,
    // or generate one from the scope ID.
    const description =
      entry.descriptions[0] ??
      `${scopeId.split(".")[1] === "read" ? "Read" : scopeId.split(".")[1] === "write" ? "Write" : "Access"} ${scopeId.split(".")[0]} data`;

    // Build a path pattern from the paths covered.
    const pathPattern =
      entry.paths.length === 1
        ? entry.paths[0]
        : `${commonPrefix(entry.paths)}*`;

    scopes.push({
      id: scopeId,
      description,
      suggestedPrice: suggestPrice(primaryMethod.toLowerCase()),
      method: methods.join("/"),
      pathPattern,
    });
  }

  // Sort by scope ID for deterministic output.
  scopes.sort((a, b) => a.id.localeCompare(b.id));

  return scopes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the longest common prefix among a set of path strings.
 */
function commonPrefix(paths: string[]): string {
  if (paths.length === 0) return "/";
  if (paths.length === 1) return paths[0];

  let prefix = paths[0];
  for (let i = 1; i < paths.length; i++) {
    while (!paths[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (prefix === "") return "/";
    }
  }

  // Trim to the last complete path segment.
  const lastSlash = prefix.lastIndexOf("/");
  if (lastSlash > 0) {
    prefix = prefix.slice(0, lastSlash + 1);
  }

  return prefix;
}
