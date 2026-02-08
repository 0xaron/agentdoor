# Python FastAPI Example

A sample API built with FastAPI and the `agentgate-fastapi` adapter. Demonstrates how to add AgentGate agent authentication to a Python FastAPI application.

## What This Example Shows

- Mounting the AgentGate middleware on a FastAPI app
- Automatic discovery, registration, verification, and auth endpoints
- Protecting routes with the `agent_required` dependency
- Accessing agent context (agent ID, name, scopes) in route handlers

## Prerequisites

- Python >= 3.9
- pip

## Setup

```bash
cd examples/python-fastapi

# Create a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn main:app --reload --port 3000
```

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /.well-known/agentgate.json` | AgentGate discovery document |
| `POST /agentgate/register` | Agent registration |
| `POST /agentgate/register/verify` | Challenge verification |
| `POST /agentgate/auth` | Agent authentication |
| `GET /api/items` | List items (public) |
| `GET /api/protected` | Protected route (requires agent auth) |

## Testing with the Python SDK

```python
from agentgate import Agent, AgentConfig

agent = Agent(config=AgentConfig(agent_name="my-agent"))
await agent.connect("http://localhost:3000")
await agent.register(scopes=["read"])
response = await agent.request("GET", "/api/protected")
print(response.json())
```

## Packages Used

- [`agentgate-fastapi`](../../packages/fastapi-adapter) - FastAPI middleware adapter
- [`agentgate`](../../packages/python-sdk) - Python Agent SDK (for client-side testing)
