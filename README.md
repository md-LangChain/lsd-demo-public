# lsd-demo

Template for a LangChain research agent plus a local chat UI that talks to any LangGraph Agent Server (local or LangSmith deployment).

## Quick start

```bash
git clone https://github.com/md-LangChain/lsd-demo-public.git
cd lsd-demo-public
cp .env.example .env
# fill in OPENAI_API_KEY and LANGSMITH_API_KEY

cd research-agent-langchain && uv sync && uv run langgraph dev
# in another terminal, from repo root:
python3 chat-ui/server.py
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765) and point the UI at `http://127.0.0.1:2024`.

## What's in this repo

| Path | Purpose |
|------|---------|
| `research-agent-langchain/` | Research agent with a `web_search` tool (OpenAI Responses) |
| `chat-ui/` | Local chat UI + proxy for Agent Server endpoints |
| `mda/` | Optional place to add MDA agents |

## Prerequisites

- Python 3.11+ (this repo pins 3.14 locally via `.python-version`)
- [uv](https://docs.astral.sh/uv/)
- An OpenAI API key (or LangSmith gateway key)
- A LangSmith API key (for tracing / hosted Agent Server / chat UI)

## 1. Configure env

From the repo root:

```bash
cp .env.example .env
```

Required:

- `OPENAI_API_KEY`
- `LANGSMITH_API_KEY`

Optional:

- `OPENAI_BASE_URL` — LangSmith OpenAI gateway
- `LANGGRAPH_API_URL` / `AGENT_SERVER_URL` — default Agent Server URL for the chat UI
- `LANGSMITH_WORKSPACE_ID` — if listing deployments fails
- `LANGSMITH_CONTROL_PLANE_HOST` — EU/APAC/AWS control planes
- `LANGSMITH_DEPLOYMENT_NAME` — name used when deploying

Never commit `.env`.

## 2. Run the research agent (local)

```bash
cd research-agent-langchain
uv sync
uv run langgraph dev
# or: make serve
```

Local Agent Server defaults to `http://127.0.0.1:2024`.

- Graph: `src/deep_agent/graph.py` → `agent`
- Tool: `web_search(query)` via OpenAI Responses + web search
- Try: *"What were the main announcements from the latest LangChain release?"*

### Make targets (`research-agent-langchain/`)

```bash
make install             # uv sync --no-dev
make dev                 # uv sync (incl. dev deps)
make serve               # langgraph dev
make test                # unit tests
make integration-tests   # integration tests
make lint / make format  # Ruff
```

## 3. Chat UI

The UI proxies Agent Server traffic and injects `LANGSMITH_API_KEY` server-side so the key never reaches the browser.

```bash
# from repo root, with .env configured
python3 chat-ui/server.py
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

- Use local (`http://127.0.0.1:2024`) or a hosted `*.langgraph.app` URL
- Works with this agent or any other Agent Server deployment

## 4. Deploy research-agent-langchain

```bash
cd research-agent-langchain
uv sync
cp .env.example .env   # if you have not already
# set OPENAI_API_KEY and LANGSMITH_API_KEY
```

Confirm `langgraph.json` registers the graph:

```json
{
  "graphs": {
    "agent": "deep_agent.graph:agent"
  },
  "env": ".env"
}
```

Optional local smoke test:

```bash
uv run langgraph dev
```

Deploy:

```bash
uv run langgraph login   # once, if needed
uv run langgraph deploy
```

Or create a deployment in the [LangSmith UI](https://smith.langchain.com) from this folder / GitHub repo and select the `agent` graph.

Then set in the repo-root `.env`:

```bash
LANGGRAPH_API_URL=https://YOUR-DEPLOYMENT.langgraph.app
```

and restart the chat UI.

## 5. Optional: MDA agents

Put MDA projects under `mda/`. See `mda/README.md` for the usual flow (`mda init` → add a tool → keys in `.env` → `mda deploy`).

## Security

- Do not commit `.env` or real API keys
- Use `.env.example` as the template
- The chat UI keeps `LANGSMITH_API_KEY` on the server, not in the browser

## Layout

```
lsd-demo/
├── .env.example
├── chat-ui/
├── research-agent-langchain/
├── mda/
├── pyproject.toml
└── README.md
```
