# lsd-demo

Demo stack for a LangChain research agent and a local chat UI that talks to any LangGraph Agent Server (local or LangSmith deployment).

## What's in this repo

| Path | Purpose |
|------|---------|
| `research-agent-langchain/` | Research agent with a `web_search` tool (OpenAI Responses) |
| `chat-ui/` | UI to show Agent Server endpoints 
| `mda/` | folder to run mda section in 

## Prerequisites

- Python 3.14+
- [uv](https://docs.astral.sh/uv/)
- An OpenAI API key (or LangSmith gateway key)
- A LangSmith API key (for tracing / hosted Agent Server / chat UI)

## 1. Configure env

From the repo root, create a `.env` 

```bash
cp research-agent-langchain/.env.example .env
```

## Deploy the research-agent-langchain to the platform 

```bash
uv sync
uv run langgraph deploy
```

## Chat UI

```bash
# from repo root, with .env configured
python3 chat-ui/server.py
```
