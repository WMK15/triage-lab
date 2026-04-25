"""
Drive the local TriageSpike env with OpenAI tool-use.

Modeled on docs.openreward.ai/quickstart.md (which uses Anthropic), adapted to
the OpenAI Chat Completions API. Caps at MAX_TURNS, prints token usage and a
rough cost estimate at the end.
"""
from __future__ import annotations

import json
import os
import sys

from dotenv import load_dotenv
from openai import OpenAI
from openreward import OpenReward

load_dotenv()

LOCAL_URL = "http://localhost:8080"
MODEL = os.environ.get("SPIKE_MODEL", "gpt-5-mini")
MAX_TURNS = 10

# Rough OpenAI pricing (USD per token); used only for spike-level cost feedback.
# Adjust if SPIKE_MODEL is overridden.
PRICE_INPUT_PER_TOKEN = 0.25e-6
PRICE_OUTPUT_PER_TOKEN = 2.00e-6

# Hard cost ceiling for the whole run. Hits abort the loop with a clear message.
# £2 by default; conversion to USD is conservative so the cap fires slightly early.
MAX_GBP = float(os.environ.get("SPIKE_MAX_GBP", "2.0"))
USD_PER_GBP = 1.27
MAX_USD = MAX_GBP * USD_PER_GBP


class CostCapExceeded(RuntimeError):
    pass


def _connect_env(or_client: OpenReward):
    """Try a few likely names — the server's registered name isn't fully documented."""
    candidates = ["triagespike", "TriageSpike", "triage_spike", "TriageSpike@local"]
    last_err = None
    for name in candidates:
        try:
            env = or_client.environments.get(name=name)
            print(f"[spike] connected to env: {name}")
            return env
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"[spike]   tried name={name!r}: {type(e).__name__}: {e}")
    raise RuntimeError(f"Could not locate env on {LOCAL_URL}. Last error: {last_err}")


def _to_chat_completions_tools(tools: list[dict]) -> list[dict]:
    """OpenReward's format='openai' returns Responses-API shape (flat name/parameters).
    Chat Completions expects them nested under .function. Translate here."""
    out = []
    for t in tools:
        if "function" in t:
            out.append(t)  # already chat-completions shape
        else:
            out.append(
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "parameters": t.get("parameters", {}),
                    },
                }
            )
    return out


def main() -> int:
    or_client = OpenReward(base_url=LOCAL_URL)
    oai = OpenAI()

    env = _connect_env(or_client)

    tasks = env.list_tasks(split="test")
    raw_tools = env.list_tools(format="openai")
    tools = _to_chat_completions_tools(raw_tools)
    print(f"[spike] tasks={len(tasks)} tools={len(tools)} model={MODEL}")
    if raw_tools:
        print(f"[spike] raw tool[0]: {json.dumps(raw_tools[0])[:200]}")
        print(f"[spike] chat tool[0]: {json.dumps(tools[0])[:200]}")

    task = tasks[0]
    with env.session(task=task) as session:
        prompt_blocks = session.get_prompt()
        prompt_text = "".join(b.text for b in prompt_blocks)
        messages: list[dict] = [{"role": "user", "content": prompt_text}]

        finished = False
        turns = 0
        total_input = 0
        total_output = 0
        total_reward = 0.0

        while not finished and turns < MAX_TURNS:
            cost_so_far = (
                total_input * PRICE_INPUT_PER_TOKEN
                + total_output * PRICE_OUTPUT_PER_TOKEN
            )
            if cost_so_far >= MAX_USD:
                raise CostCapExceeded(
                    f"Hit cap ${MAX_USD:.2f} (~£{MAX_GBP:.2f}) at turn {turns} "
                    f"with cost ${cost_so_far:.4f}"
                )
            turns += 1
            resp = oai.chat.completions.create(
                model=MODEL,
                messages=messages,
                tools=tools,
                tool_choice="auto",
            )
            usage = resp.usage
            total_input += usage.prompt_tokens
            total_output += usage.completion_tokens

            msg = resp.choices[0].message
            assistant_msg: dict = {"role": "assistant", "content": msg.content or ""}
            if msg.tool_calls:
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ]
            messages.append(assistant_msg)

            if not msg.tool_calls:
                print(f"[spike] turn {turns}: no tool call; assistant said: {msg.content!r}")
                break

            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments or "{}")
                result = session.call_tool(tc.function.name, args)
                text = "".join(
                    getattr(b, "text", str(b)) for b in getattr(result, "blocks", [])
                )
                reward = float(getattr(result, "reward", 0.0) or 0.0)
                total_reward += reward
                fin = bool(getattr(result, "finished", False))
                print(
                    f"[spike] turn {turns}: {tc.function.name}({args}) "
                    f"-> reward={reward} finished={fin}"
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": text,
                    }
                )
                if fin:
                    finished = True

        cost = total_input * PRICE_INPUT_PER_TOKEN + total_output * PRICE_OUTPUT_PER_TOKEN
        print("\n[spike] === DONE ===")
        print(f"[spike] turns={turns} finished={finished} total_reward={total_reward}")
        print(f"[spike] tokens input={total_input} output={total_output}")
        print(f"[spike] estimated cost=${cost:.4f}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
