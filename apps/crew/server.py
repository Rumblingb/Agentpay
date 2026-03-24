"""
AgentPay Crew API — exposes the three-agent crew as an HTTP endpoint.

Start:  uvicorn server:app --port 8090 --reload
Env:    copy .env.example to .env and fill in your keys

Routes:
  POST /crew/run      — run a full plan → extract → fulfill pipeline
  POST /crew/plan     — plan only (Darwin, no booking)
  GET  /health        — health check
"""

import os
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from crewai import Crew, Task, Process

from src.agents import darwin, codex, claw
from src.crew import build_crew

app = FastAPI(title="AgentPay Crew", version="1.0.0")


# ── Request / Response models ─────────────────────────────────────────────────

class RunRequest(BaseModel):
    request: str                    # "Book me Derby to London tomorrow 8am"
    nationality: str = "uk"         # "uk" | "india"
    jobId: str | None = None        # pre-existing AgentPay job ID


class PlanRequest(BaseModel):
    request: str
    nationality: str = "uk"


# ── Auth middleware ───────────────────────────────────────────────────────────

CREW_KEY = os.getenv("CREW_API_KEY", "")

@app.middleware("http")
async def check_key(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if CREW_KEY:
        key = request.headers.get("x-crew-key", "")
        if key != CREW_KEY:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return await call_next(request)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "agents": ["darwin", "codex", "claw"]}


@app.post("/crew/plan")
async def plan_only(body: PlanRequest):
    """Darwin only — search and recommend, no booking."""
    plan_task = Task(
        description=(
            f"User request: '{body.request}'\n"
            f"Nationality / rail network: {body.nationality}\n\n"
            "Search for live train options. Return: best train, departure, arrival, "
            "fare, class, operator, and a one-sentence reason."
        ),
        expected_output="Human-readable train recommendation with times, fare, and operator.",
        agent=darwin,
    )
    crew = Crew(
        agents=[darwin],
        tasks=[plan_task],
        process=Process.sequential,
        verbose=False,
    )
    result = crew.kickoff()
    return {"result": str(result)}


@app.post("/crew/run")
async def run_full(body: RunRequest):
    """Full pipeline: Darwin plans → Codex extracts → Claw fulfills."""
    try:
        crew = build_crew(body.request, body.nationality, body.jobId)
        result = crew.kickoff()
        return {"result": str(result), "status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
