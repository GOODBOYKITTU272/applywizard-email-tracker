# Loop Constraints

> Add rules below with `/constraints <rule>` in your agent.
> The `loop-constraints` skill reads this file at the start of every run.
> Constraints here are **binding** — the agent MUST follow them.

## Push & Merge
- Don't push before telling me
- Never auto-merge to main without human approval
- Never create a pull request without human approval
- Never deploy without explicit approval

## Dashboard Auth
- Never change Basic Auth, middleware, or production auth behavior without an approved Dashboard Auth slice.
- Never modify dashboard auth application code unless the current slice explicitly allows it.
- Never add routes, UI, server actions, or cookies outside the approved slice scope.
- Never apply a database migration unless the slice explicitly says so.

## Paths
- Never edit `.env`, `.env.*`, secrets, credentials, or production config files without human approval.
- Never edit infrastructure configs without human approval.

## Code
- Always run tests before proposing a fix
- Never disable tests to make CI green
- Never refactor unrelated code — one slice per run
- Max 2 implementation attempts per task; escalate after
- Do not loop forever on repeated identical failures

## Communication
- Always tell me what you're about to do before doing it
- Never close an issue or PR without my approval

## Budget
- If token spend hits 80% of daily cap, switch to report-only
- If `loop-pause-all` is active, exit immediately

---
<!-- Add your own rules below. Use plain English. The loop reads this verbatim. -->
