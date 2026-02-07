# Agent SDK

The AgentGate SDK is the agent-side client library. It handles the full lifecycle of connecting to AgentGate-enabled services: discovery, registration, challenge-response, credential caching, authenticated requests, and x402 payments.

Available for TypeScript (`@agentgate/sdk`) and Python (`agentgate`).

## TypeScript

### Installation

```bash
npm install @agentgate/sdk
```

### Quick Start

```typescript
import { AgentGate } from "@agentgate/sdk";

// Create an agent instance (auto-generates a keypair if none exists)
const agent = new AgentGate({
  keyPath: "~/.agentgate/keys.json",
});

// Connect to any AgentGate-enabled service
const session = await agent.connect("https://api.weatherco.com");

// Make authenticated requests
const weather = await session.get("/api/weather", {
  params: { city: "san-francisco" },
});
console.log(weather); // { temp: 72, unit: "F", ... }
```

The `connect()` call performs the entire flow automatically:

1. Fetches `/.well-known/agentgate.json` from the target service (cached after first fetch).
2. Sends `POST /agentgate/register` with the agent's public key and requested scopes.
3. Signs the challenge nonce with the agent's private key.
4. Sends `POST /agentgate/register/verify` with the signature.
5. Stores the returned credentials (API key + JWT) locally.
6. Returns a `Session` object for making authenticated requests.

Subsequent `connect()` calls to the same service skip registration and reuse cached credentials.

### AgentGate Class

```typescript
class AgentGate {
  constructor(options?: AgentGateOptions);

  connect(url: string, options?: ConnectOptions): Promise<Session>;
  disconnect(url: string): Promise<void>;
  listSessions(): Map<string, Session>;
}
```

#### `AgentGateOptions`

```typescript
interface AgentGateOptions {
  // Path to store the Ed25519 keypair. If the file does not exist,
  // a new keypair is generated and saved. If omitted, an ephemeral
  // keypair is generated in memory (lost on process exit).
  keyPath?: string;

  // Use an x402 wallet address as the agent's identity. When set,
  // the wallet address is sent during registration, linking auth
  // identity to payment identity.
  x402Wallet?: string;

  // Override the default credential cache directory.
  // Default: ~/.agentgate/credentials/
  credentialCachePath?: string;

  // Default scopes to request when connecting to any service.
  // Can be overridden per-connection via ConnectOptions.
  defaultScopes?: string[];

  // Default metadata sent during registration.
  metadata?: Record<string, string>;
}
```

#### `ConnectOptions`

```typescript
interface ConnectOptions {
  // Specific scopes to request for this service.
  // If omitted, requests all available scopes from the discovery document.
  scopes?: string[];

  // Additional metadata for this specific registration.
  metadata?: Record<string, string>;

  // Force re-registration even if cached credentials exist.
  forceRegister?: boolean;

  // Timeout in milliseconds for the entire connect flow.
  // Default: 10000 (10 seconds)
  timeout?: number;
}
```

### Session Class

A `Session` is returned by `agent.connect()` and provides methods for making authenticated requests to the connected service.

```typescript
class Session {
  readonly agentId: string;
  readonly baseUrl: string;
  readonly scopes: string[];
  readonly rateLimit: { requests: number; window: string };

  get(path: string, options?: RequestOptions): Promise<any>;
  post(path: string, body?: any, options?: RequestOptions): Promise<any>;
  put(path: string, body?: any, options?: RequestOptions): Promise<any>;
  patch(path: string, body?: any, options?: RequestOptions): Promise<any>;
  delete(path: string, options?: RequestOptions): Promise<any>;

  // Raw fetch with automatic auth headers
  fetch(path: string, init?: RequestInit): Promise<Response>;

  // Refresh the JWT token (automatically called when token expires)
  refreshToken(): Promise<void>;

  // Get the current auth headers (useful for custom HTTP clients)
  getAuthHeaders(): Record<string, string>;
}
```

#### `RequestOptions`

```typescript
interface RequestOptions {
  // URL query parameters
  params?: Record<string, string>;

  // Additional headers
  headers?: Record<string, string>;

  // Attach x402 payment header to this request
  x402?: boolean;

  // Override the x402 payment amount (default: use price from discovery document)
  x402Amount?: string;
}
```

### Examples

#### Basic Usage

```typescript
import { AgentGate } from "@agentgate/sdk";

const agent = new AgentGate({
  keyPath: "~/.agentgate/keys.json",
  metadata: {
    framework: "custom",
    name: "my-weather-bot",
    version: "1.0.0",
  },
});

const session = await agent.connect("https://api.weatherco.com", {
  scopes: ["weather.read", "weather.forecast"],
});

// GET request with query parameters
const current = await session.get("/api/weather", {
  params: { city: "sf", units: "metric" },
});

// POST request with body
const alert = await session.post("/api/alerts/subscribe", {
  city: "sf",
  threshold: "extreme",
});
```

#### x402 Payment Integration

```typescript
const agent = new AgentGate({
  keyPath: "~/.agentgate/keys.json",
  x402Wallet: "0x1234567890abcdef1234567890abcdef12345678",
});

const session = await agent.connect("https://api.premiumdata.com");

// Automatically attach x402 payment header
const data = await session.get("/api/premium/dataset", {
  x402: true,
});
```

When `x402: true` is set, the SDK:
1. Reads the price for the scope from the cached discovery document.
2. Constructs an x402 payment payload using the agent's wallet.
3. Attaches it as the `X-PAYMENT` header on the request.

#### Connecting to Multiple Services

```typescript
const agent = new AgentGate({ keyPath: "~/.agentgate/keys.json" });

// Register with multiple services (these run in parallel)
const [weather, stocks, maps] = await Promise.all([
  agent.connect("https://api.weatherco.com"),
  agent.connect("https://api.stockdata.com"),
  agent.connect("https://api.maps-service.com"),
]);

const forecast = await weather.get("/forecast", { params: { city: "sf" } });
const price = await stocks.get("/price", { params: { symbol: "AAPL" } });
const route = await maps.get("/directions", {
  params: { from: "sf", to: "la" },
});
```

#### Using Raw Fetch

```typescript
const session = await agent.connect("https://api.example.com");

// Use the raw fetch method for full control
const response = await session.fetch("/api/data", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "test" }),
});

const data = await response.json();
console.log(response.status, data);
```

#### Getting Auth Headers for External HTTP Clients

```typescript
const session = await agent.connect("https://api.example.com");

// Use with axios, got, or any HTTP client
const headers = session.getAuthHeaders();
// { "Authorization": "Bearer agk_live_..." }

const response = await axios.get("https://api.example.com/api/data", {
  headers,
});
```

### Keystore Management

The SDK manages Ed25519 keypairs through the keystore.

#### Auto-Generation

If `keyPath` is provided and the file does not exist, a new keypair is generated and saved automatically:

```typescript
const agent = new AgentGate({
  keyPath: "~/.agentgate/keys.json",
});
// First run: generates keypair, saves to ~/.agentgate/keys.json
// Subsequent runs: loads existing keypair
```

#### CLI Key Generation

Generate a keypair via the CLI:

```bash
npx agentgate keygen
# Saves to ~/.agentgate/keys.json
# Prints the public key
```

#### Key File Format

```json
{
  "algorithm": "ed25519",
  "publicKey": "MCowBQYDK2VwAyEAZn3LRXO1Kx4vBqUCKdFt2MYSjCqWR7lE9G8gNxN5aSk=",
  "secretKey": "MC4CAQAwBQYDK2VwBCIEIPh05zHrIrc8xKdPKJlPv...",
  "createdAt": "2026-02-08T12:00:00Z"
}
```

Keep the `secretKey` private. Never commit it to version control. The public key is what gets shared during registration.

#### Ephemeral Keys

If `keyPath` is omitted, an ephemeral keypair is generated in memory. This is useful for short-lived agents or testing, but credentials are lost when the process exits:

```typescript
const agent = new AgentGate(); // ephemeral key, no persistence
```

### Credential Caching

The SDK caches registration credentials per-service to avoid re-registering on every `connect()` call.

**Cache location:** `~/.agentgate/credentials/` (or the path set via `credentialCachePath`).

**Cache structure:**

```
~/.agentgate/
  keys.json                           # Ed25519 keypair
  credentials/
    api.weatherco.com.json            # Cached credentials for weatherco
    api.stockdata.com.json            # Cached credentials for stockdata
```

Each credential file contains the agent ID, API key, JWT, and expiration. The SDK automatically:
- Loads cached credentials on `connect()`.
- Skips registration if valid credentials exist.
- Refreshes the JWT when it expires (using the `/agentgate/auth` endpoint).
- Re-registers if the API key is rejected (e.g. revoked by the service).

To force re-registration:

```typescript
const session = await agent.connect("https://api.weatherco.com", {
  forceRegister: true,
});
```

To clear all cached credentials:

```typescript
await agent.disconnect("https://api.weatherco.com");
```

---

## Python

### Installation

```bash
pip install agentgate
```

### Quick Start

```python
from agentgate import AgentGate

agent = AgentGate(key_path="~/.agentgate/keys.json")

# Connect to a service (discovery + register + auth)
session = agent.connect("https://api.weatherco.com")

# Make authenticated requests
weather = session.get("/api/weather", params={"city": "sf"})
print(weather)  # {"temp": 72, "unit": "F"}
```

### AgentGate Class

```python
class AgentGate:
    def __init__(
        self,
        key_path: str | None = None,
        x402_wallet: str | None = None,
        credential_cache_path: str | None = None,
        default_scopes: list[str] | None = None,
        metadata: dict[str, str] | None = None,
    ): ...

    def connect(
        self,
        url: str,
        scopes: list[str] | None = None,
        metadata: dict[str, str] | None = None,
        force_register: bool = False,
        timeout: float = 10.0,
    ) -> Session: ...

    async def connect_async(
        self,
        url: str,
        scopes: list[str] | None = None,
        metadata: dict[str, str] | None = None,
        force_register: bool = False,
        timeout: float = 10.0,
    ) -> AsyncSession: ...

    def disconnect(self, url: str) -> None: ...
    def list_sessions(self) -> dict[str, Session]: ...
```

### Session Class

```python
class Session:
    agent_id: str
    base_url: str
    scopes: list[str]
    rate_limit: dict

    def get(self, path: str, params: dict = None, headers: dict = None, x402: bool = False) -> Any: ...
    def post(self, path: str, json: Any = None, headers: dict = None, x402: bool = False) -> Any: ...
    def put(self, path: str, json: Any = None, headers: dict = None, x402: bool = False) -> Any: ...
    def patch(self, path: str, json: Any = None, headers: dict = None, x402: bool = False) -> Any: ...
    def delete(self, path: str, headers: dict = None, x402: bool = False) -> Any: ...

    def refresh_token(self) -> None: ...
    def get_auth_headers(self) -> dict[str, str]: ...
```

### Examples

#### Basic Usage

```python
from agentgate import AgentGate

agent = AgentGate(
    key_path="~/.agentgate/keys.json",
    metadata={
        "framework": "custom",
        "name": "data-collector",
        "version": "1.0.0",
    },
)

session = agent.connect(
    "https://api.weatherco.com",
    scopes=["weather.read"],
)

data = session.get("/api/weather", params={"city": "sf"})
print(f"Temperature: {data['temp']}F")
```

#### Async Usage

```python
import asyncio
from agentgate import AgentGate

async def main():
    agent = AgentGate(key_path="~/.agentgate/keys.json")

    # Connect to multiple services concurrently
    weather, stocks = await asyncio.gather(
        agent.connect_async("https://api.weatherco.com"),
        agent.connect_async("https://api.stockdata.com"),
    )

    forecast = await weather.get("/forecast", params={"city": "sf"})
    price = await stocks.get("/price", params={"symbol": "AAPL"})

asyncio.run(main())
```

#### x402 Payment

```python
agent = AgentGate(
    key_path="~/.agentgate/keys.json",
    x402_wallet="0x1234567890abcdef1234567890abcdef12345678",
)

session = agent.connect("https://api.premiumdata.com")
data = session.get("/api/premium/dataset", x402=True)
```

#### LangChain Integration

```python
from agentgate.integrations.langchain import AgentGateToolkit

toolkit = AgentGateToolkit(key_path="~/.agentgate/keys.json")

# Discover and wrap multiple services as LangChain tools
tools = toolkit.get_tools([
    "https://api.weatherco.com",
    "https://api.stockdata.com",
])

# Each service's scopes become individual LangChain tools
# e.g., "weatherco_weather_read", "stockdata_price_read"
from langchain.agents import initialize_agent

agent = initialize_agent(tools, llm, agent="zero-shot-react-description")
result = agent.run("What is the weather in SF and the current price of AAPL?")
```

#### CrewAI Integration

```python
from agentgate.integrations.crewai import AgentGateTools

agentgate_tools = AgentGateTools(key_path="~/.agentgate/keys.json")
tools = agentgate_tools.for_services([
    "https://api.weatherco.com",
])

from crewai import Agent, Task, Crew

researcher = Agent(
    role="Weather Researcher",
    goal="Gather weather data",
    tools=tools,
)
```

#### Using with requests

```python
import requests

session = agent.connect("https://api.example.com")
headers = session.get_auth_headers()

# Use with the requests library directly
response = requests.get(
    "https://api.example.com/api/data",
    headers=headers,
)
```

---

## Error Handling

Both the TypeScript and Python SDKs raise typed errors for common failure cases.

### TypeScript

```typescript
import { AgentGate, AgentGateError, RegistrationError, AuthError } from "@agentgate/sdk";

try {
  const session = await agent.connect("https://api.example.com");
} catch (error) {
  if (error instanceof RegistrationError) {
    console.error("Registration failed:", error.message);
    console.error("Code:", error.code);  // e.g. "already_registered"
  } else if (error instanceof AuthError) {
    console.error("Auth failed:", error.message);
  } else if (error instanceof AgentGateError) {
    console.error("AgentGate error:", error.message);
  }
}
```

### Python

```python
from agentgate import AgentGate
from agentgate.errors import AgentGateError, RegistrationError, AuthError

try:
    session = agent.connect("https://api.example.com")
except RegistrationError as e:
    print(f"Registration failed: {e.message} (code: {e.code})")
except AuthError as e:
    print(f"Auth failed: {e.message}")
except AgentGateError as e:
    print(f"AgentGate error: {e.message}")
```

### Error Types

| Error | When |
|---|---|
| `DiscoveryError` | Failed to fetch or parse `/.well-known/agentgate.json`. |
| `RegistrationError` | Registration was rejected (invalid key, rate limited, already registered). |
| `ChallengeError` | Challenge signing or verification failed. |
| `AuthError` | Authentication failed (invalid credentials, expired token, suspended agent). |
| `RateLimitError` | Agent exceeded its rate limit. Contains `retryAfter` seconds. |
| `NetworkError` | HTTP request failed (timeout, DNS, connection refused). |
| `AgentGateError` | Base error class for all AgentGate errors. |
