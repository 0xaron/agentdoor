# LangChain + AgentGate Integration Example

Shows how to combine the AgentGate SDK with LangChain to give an LLM agent autonomous access to AgentGate-enabled APIs. The agent can discover, register with, and call external services without any browser automation.

## What This Example Shows

- Wrapping AgentGate sessions as LangChain `DynamicStructuredTool` instances
- Giving an LLM agent tool-calling access to authenticated APIs
- Combining multiple AgentGate services into a single LangChain agent

## Prerequisites

- Node.js >= 18
- pnpm >= 9
- An OpenAI API key (set `OPENAI_API_KEY` environment variable)
- A running AgentGate-enabled service (e.g., the `express-weather-api` example)

## Setup

```bash
# From the repository root
pnpm install

# Start a service first (in another terminal)
cd examples/express-weather-api
pnpm dev

# Set your OpenAI API key
export OPENAI_API_KEY=sk-...

# Run the LangChain agent
cd examples/agent-langchain
pnpm start
```

## How It Works

1. The AgentGate SDK connects to a weather API (discovery + registration)
2. The session is wrapped as LangChain tools (`get_current_weather`, `get_weather_forecast`)
3. A LangChain OpenAI Functions agent uses these tools to answer natural language queries
4. All API calls are authenticated automatically via the AgentGate session

## Packages Used

- [`@agentgate/sdk`](../../packages/sdk) - Agent-side TypeScript SDK
- [`langchain`](https://www.npmjs.com/package/langchain) - LangChain framework
- [`@langchain/openai`](https://www.npmjs.com/package/@langchain/openai) - OpenAI LLM integration
