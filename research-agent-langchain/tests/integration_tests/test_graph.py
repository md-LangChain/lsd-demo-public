import os

import pytest

from deep_agent.graph import agent

pytestmark = pytest.mark.anyio

if not os.getenv("OPENAI_API_KEY"):
    pytest.skip(
        "Set OPENAI_API_KEY to run integration tests.", allow_module_level=True
    )


async def test_agent_smoke() -> None:
    result = await agent.ainvoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "Say hello in one sentence.",
                }
            ]
        }
    )
    assert result is not None
    assert result.get("messages")
