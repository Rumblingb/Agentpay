"""
AgentPay tools — callable by any CrewAI agent.

Each tool wraps an API call to either AgentPay, OpenClaw, or a search provider.
"""

import os
import httpx
from crewai.tools import tool

AGENTPAY_URL = os.getenv("AGENTPAY_API_URL", "https://api.agentpay.so")
BRO_KEY      = os.getenv("BRO_CLIENT_KEY", "")
OPENCLAW_URL = os.getenv("OPENCLAW_API_URL", "")
OPENCLAW_KEY = os.getenv("OPENCLAW_API_KEY", "")


def _bro_headers() -> dict:
    h = {"Content-Type": "application/json"}
    if BRO_KEY:
        h["x-bro-key"] = BRO_KEY
    return h


@tool("search_trains_uk")
def search_trains_uk(from_station: str, to_station: str, date: str, time: str) -> str:
    """Search live UK train departures via Darwin. Returns JSON with trains, prices, operators."""
    resp = httpx.post(
        f"{AGENTPAY_URL}/api/concierge/intent",
        headers=_bro_headers(),
        json={
            "transcript": f"trains from {from_station} to {to_station} on {date} around {time}",
            "hirerId": "crew-agent",
        },
        timeout=30,
    )
    return resp.text


@tool("search_trains_india")
def search_trains_india(from_station: str, to_station: str, date: str) -> str:
    """Search Indian Railways trains between two stations. Returns trains, classes, fares."""
    resp = httpx.post(
        f"{AGENTPAY_URL}/api/concierge/intent",
        headers=_bro_headers(),
        json={
            "transcript": f"trains from {from_station} to {to_station} on {date}",
            "hirerId": "crew-agent",
            "travelProfile": {"nationality": "india"},
        },
        timeout=30,
    )
    return resp.text


@tool("book_train_via_openclaw")
def book_train_via_openclaw(job_id: str, train_details: str) -> str:
    """
    Hand off a confirmed booking job to OpenClaw for fulfillment.
    job_id: the AgentPay jobId from a confirmed intent.
    train_details: JSON string with train number, class, passenger info.
    """
    if not OPENCLAW_URL or not OPENCLAW_KEY:
        return '{"status":"skipped","reason":"OPENCLAW_API_URL or OPENCLAW_API_KEY not set"}'
    resp = httpx.post(
        f"{OPENCLAW_URL}/fulfill",
        headers={"Authorization": f"Bearer {OPENCLAW_KEY}", "Content-Type": "application/json"},
        json={"jobId": job_id, "details": train_details},
        timeout=60,
    )
    return resp.text


@tool("get_job_status")
def get_job_status(job_id: str) -> str:
    """Check the current status of an AgentPay booking job."""
    resp = httpx.get(
        f"{AGENTPAY_URL}/api/concierge/status/{job_id}",
        headers=_bro_headers(),
        timeout=15,
    )
    return resp.text


@tool("web_search")
def web_search(query: str) -> str:
    """Search the web for travel information, visa requirements, or current rail news."""
    # Uses DuckDuckGo HTML scrape — no API key required
    resp = httpx.get(
        "https://html.duckduckgo.com/html/",
        params={"q": query},
        headers={"User-Agent": "Mozilla/5.0 AgentPay-Crew/1.0"},
        timeout=15,
        follow_redirects=True,
    )
    # Extract text snippets from result snippets (simple parse)
    import re
    snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', resp.text, re.DOTALL)
    clean = [re.sub(r'<[^>]+>', '', s).strip() for s in snippets[:5]]
    return "\n\n".join(clean) if clean else "No results found."
