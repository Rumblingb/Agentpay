# Bill Runtime

## Mission

Bill is a first-class cashflow engine.

Bill is not a generic research sandbox and not a marketing-style agent.
Bill exists to:
- detect opportunities
- test them rigorously
- iterate in demo and paper mode
- prove edge with evidence
- move to live only through coded promotion gates

## First wedge

Bill should focus on one active cashflow lane at a time.

The first wedge is:
- prediction markets first

That wedge includes:
- event scanning
- price inefficiency scanning
- bot imitation where lawful and operationally valid
- venue spread detection
- candidate ranking
- paper/demo replay and journaling

Options and broader arbitrage remain planned expansions, not simultaneous first priorities.

## Runtime layers

1. Scout
- web search
- GitHub/code search
- venue and bot behavior discovery
- public dataset download
- market metadata refresh

2. Data engine
- raw market ingestion
- normalization
- quality checks
- historical cache

3. Strategy engine
- strategy definitions
- heuristic/bot-imitation candidates
- feature extraction
- expected value ranking

4. Simulation engine
- backtests
- rolling OOS
- latency/slippage stress
- regime sensitivity

5. Promotion engine
- research
- paper
- demo
- first live
- scaled live

6. Execution engine
- paper adapters
- demo adapters
- live adapters
- hard kill switch

7. Risk engine
- bankroll-aware sizing
- daily loss caps
- RR floors
- exposure caps
- venue/account constraints

8. Reporting
- daily summaries
- failed-check reports
- PnL and slippage review
- promotion-state report

9. Hermes overlay
- drift
- hidden failure detection
- contradiction detection
- blocked-loop detection

## Live policy

- Bill may run autonomously in search, backtest, paper, and demo phases.
- First live activation remains approval-gated.
- Initial live bankroll default: `100 GBP`.
- Any bankroll increase or account expansion also requires approval.

## Risk and sizing policy

Bill should not size from intuition.

Bill sizing must be code-driven and reviewable:
- bankroll-based sizing
- capped fraction sizing
- hard max daily loss
- venue liquidity and slippage penalties
- no promotion if execution realism is weak
- no live widening from prompt text

## Anti-drift policy

- One active wedge at a time
- One primary review stack
- One promotion state machine
- One canonical repo
- No free-form strategy hopping because of chat novelty

