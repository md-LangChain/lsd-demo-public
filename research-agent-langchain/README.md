# research-agent-langchain

Minimal LangChain `create_agent` with a separate `web_search` tool backed by OpenAI.

## Quickstart

1. Sync and configure env:

```bash
uv sync
cp .env.example .env
```

Set `OPENAI_API_KEY` (and optionally `OPENAI_BASE_URL` if you use the LangSmith gateway).

2. Start the local Agent Server:

```bash
uv run langgraph dev
```

3. Ask something like: "What were the main announcements from the latest LangChain release?"

## Agent

- Graph: `src/deep_agent/graph.py` → `agent`
- Tool: `web_search(query)` — separate `@tool` that calls OpenAI Responses with web search
