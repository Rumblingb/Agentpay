"""
AgentPay Crew — three-agent pipeline.

Flow:
  1. Darwin searches for trains and recommends the best option
  2. Codex extracts structured booking data from Darwin's output
  3. Claw executes the booking via OpenClaw (or logs it for manual fulfillment)
"""

from crewai import Crew, Task, Process
from .agents import darwin, codex, claw


def build_crew(user_request: str, nationality: str = "uk", job_id: str | None = None) -> Crew:
    """
    Build and return a Crew configured for the given travel request.

    Args:
        user_request: Natural language request, e.g. "Book me a train from Derby to London tomorrow morning"
        nationality:  "uk" or "india"
        job_id:       If provided, skip search and go straight to fulfillment for this existing job
    """

    # ── Task 1: Plan the journey ─────────────────────────────────────────────
    plan_task = Task(
        description=(
            f"User request: '{user_request}'\n"
            f"Nationality / rail network: {nationality}\n\n"
            "Search for live train options using the appropriate tool. "
            "Return a clear recommendation: best train, departure time, arrival time, "
            "fare, class, and operator. Include a one-sentence reason why this is the best option."
        ),
        expected_output=(
            "A human-readable recommendation with: train number/service, "
            "departure time, arrival time, fare (with currency), class, and operator."
        ),
        agent=darwin,
    )

    # ── Task 2: Extract structured data ─────────────────────────────────────
    extract_task = Task(
        description=(
            "From Darwin's recommendation above, extract the booking details as a JSON object. "
            "Include: trainNumber, from, to, departureTime, arrivalTime, fare, currency, "
            "class, operator. If any field is missing, set it to null."
        ),
        expected_output='{"trainNumber": "...", "from": "...", ...}',
        agent=codex,
        context=[plan_task],
    )

    # ── Task 3: Execute fulfillment ──────────────────────────────────────────
    fulfill_task = Task(
        description=(
            f"Execute the booking using the structured data from Codex. "
            f"{'Job ID for fulfillment: ' + job_id if job_id else 'Use book_train_via_openclaw tool.'}\n"
            "Report: success/failure, ticket reference (if available), and any errors."
        ),
        expected_output=(
            "Fulfillment result: status (success/pending/failed), jobId, "
            "ticketReference (if available), and any error message."
        ),
        agent=claw,
        context=[extract_task],
    )

    return Crew(
        agents=[darwin, codex, claw],
        tasks=[plan_task, extract_task, fulfill_task],
        process=Process.sequential,
        verbose=True,
        memory=True,
        embedder={
            "provider": "openai",
            "config": {"model": "text-embedding-3-small"},
        },
    )


def run(user_request: str, nationality: str = "uk", job_id: str | None = None) -> str:
    """Run the crew and return the final result as a string."""
    crew = build_crew(user_request, nationality, job_id)
    result = crew.kickoff()
    return str(result)
