from langgraph.pregel import Pregel

from deep_agent.graph import SYSTEM_PROMPT, agent, web_search


def test_agent_compiles() -> None:
    assert isinstance(agent, Pregel)


def test_system_prompt_is_nonempty() -> None:
    assert len(SYSTEM_PROMPT.strip()) > 0


def test_web_search_tool_name() -> None:
    assert web_search.name == "web_search"
