"""
Three-agent crew for AgentPay / Bro:

  Darwin   — Reasoning agent (Claude opus-4-6). Plans the journey, interprets
              the user's request, decides which trains/routes to offer.

  Codex    — Code/data agent (GPT-4o). Handles structured data extraction,
              price formatting, API response parsing, code generation tasks.

  Claw     — Fulfillment agent (GPT-4o-mini, cheap). Executes the booking via
              OpenClaw once Darwin + Codex agree on the best option.
"""

import os
from crewai import Agent
from .tools import (
    search_trains_uk,
    search_trains_india,
    book_train_via_openclaw,
    get_job_status,
    web_search,
)

# ── Darwin — Reasoning (Claude) ──────────────────────────────────────────────

darwin = Agent(
    role="Travel Planner",
    goal=(
        "Understand what the user wants, find the best train options "
        "using live data, and present a clear recommendation with price and timing."
    ),
    backstory=(
        "You are Darwin, a premium travel concierge AI. You speak like a knowledgeable "
        "friend — confident, concise, no jargon. You always use live data before recommending. "
        "You operate on UK and Indian rail networks."
    ),
    tools=[search_trains_uk, search_trains_india, web_search],
    llm="claude-opus-4-6",          # maps to Anthropic via LiteLLM in CrewAI
    verbose=True,
    memory=True,
    max_iter=4,
)

# ── Codex — Data/Code (GPT-4o) ───────────────────────────────────────────────

codex = Agent(
    role="Data Analyst",
    goal=(
        "Extract structured booking data from Darwin's recommendation — "
        "train number, departure time, class, fare — and format it for confirmation."
    ),
    backstory=(
        "You are a precise data extraction agent. You take messy API responses "
        "and convert them into clean JSON objects for downstream use. "
        "You never invent data — if it's not in the source, you flag it as missing."
    ),
    tools=[],
    llm="gpt-4o",                   # maps to OpenAI via LiteLLM in CrewAI
    verbose=True,
    memory=False,
    max_iter=2,
)

# ── Claw — Fulfillment (GPT-4o-mini, cheap) ──────────────────────────────────

claw = Agent(
    role="Fulfillment Executor",
    goal=(
        "Take the structured booking data from Codex and execute the booking "
        "via OpenClaw. Confirm the job ID and ticket reference back to Darwin."
    ),
    backstory=(
        "You are a reliable execution agent. You receive a clean booking payload, "
        "call the fulfillment API, and report the outcome. "
        "If the API fails, you report the exact error — you never fabricate a booking."
    ),
    tools=[book_train_via_openclaw, get_job_status],
    llm="gpt-4o-mini",
    verbose=True,
    memory=False,
    max_iter=3,
)
