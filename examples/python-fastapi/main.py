"""Python FastAPI example with AgentGate middleware.

Demonstrates how to make a FastAPI application agent-ready using the
agentgate-fastapi adapter. Agents can discover, register, authenticate,
and access protected endpoints programmatically.

Run with:
    uvicorn main:app --reload --port 3000
"""

from fastapi import Depends, FastAPI

from agentgate_fastapi import AgentGate, AgentGateConfig, AgentContext

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AgentGate Python Example",
    description="A sample FastAPI app with AgentGate agent authentication",
)

# --- AgentGate: 3 lines to make your API agent-ready ---
gate = AgentGate(
    app,
    config=AgentGateConfig(
        service_name="Python Example API",
        scopes=[
            {"name": "read", "description": "Read access to items"},
            {"name": "write", "description": "Write access to items"},
        ],
        token_ttl_seconds=3600,
    ),
)
# --- That's it. Your API is now agent-ready. ---
# AgentGate automatically:
#   - Serves /.well-known/agentgate.json (discovery)
#   - Mounts /agentgate/register + /agentgate/register/verify (registration)
#   - Mounts /agentgate/auth (returning agents)

# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

items = [
    {"id": 1, "name": "Widget A", "price": 9.99, "in_stock": True},
    {"id": 2, "name": "Widget B", "price": 19.99, "in_stock": True},
    {"id": 3, "name": "Gadget C", "price": 49.99, "in_stock": False},
]

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/items")
async def list_items():
    """Public endpoint -- no authentication required."""
    return {"items": items, "total": len(items)}


@app.get("/api/protected")
async def protected_data(agent: AgentContext = Depends(gate.agent_required())):
    """Protected endpoint -- requires a valid agent token."""
    return {
        "message": f"Hello, {agent.agent_name}!",
        "agent_id": agent.agent_id,
        "scopes": agent.scopes,
        "items": items,
    }


@app.get("/api/read-only")
async def read_only(
    agent: AgentContext = Depends(gate.agent_required(scopes=["read"])),
):
    """Protected endpoint -- requires the 'read' scope."""
    return {
        "agent_id": agent.agent_id,
        "items": items,
    }
