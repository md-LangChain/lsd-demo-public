"""Simple research agent with an OpenAI-backed web search tool."""

from __future__ import annotations

import os

from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain.tools import tool
from openai import OpenAI

load_dotenv()

SYSTEM_PROMPT = """You are a helpful research assistant.

Use the web_search tool to find current information. Cite sources with URLs when you can.
"""


@tool
def web_search(query: str) -> str:
    """Search the web for current information.

    Args:
        query: The search query (be specific for better results).
    """
    client = OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.environ.get("OPENAI_BASE_URL") or None,
    )
    response = client.responses.create(
        model="gpt-4.1-mini",
        tools=[{"type": "web_search"}],
        input=query,
    )
    return response.output_text


agent = create_agent(
    model="openai:gpt-4.1-mini",
    tools=[web_search],
    system_prompt=SYSTEM_PROMPT,
)
