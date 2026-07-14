# Loop Configuration — ApplyWizz Dashboard Auth

## Active Loops

| Pattern | Cadence | Status | Automation prompt |
|---------|---------|--------|-------------------|
| Daily Triage | 1d | L1 report-only | `Run $loop-triage. Read STATE.md. Inspect git status and recent commits. Report only.` |

## Required Workflow

1. Read `STATE.md` first.
2. Inspect `git status` and recent commits.
3. Identify exactly one current task.
4. Classify it as one of:
   - PLAN
   - IMPLEMENT
   - REVIEW
   - FIX
   - VERIFY
5. Never combine multiple slices in one implementation.
6. Never implement work that has not been explicitly approved.
7. Never trust summaries alone; inspect source and git diff.
8. For implementation:
   - change only approved files;
   - add tests;
   - run targeted tests;
   - run the full test suite;
   - run lint;
   - run build;
   - create one local commit;
   - update `STATE.md` and `loop-run-log.md`;
   - stop for review.
9. For review:
   - inspect commit and diff directly;
   - independently run required verification;
   - return PASS, PASS WITH FIXES, or FAIL;
   - do not modify code unless the task is explicitly a FIX task;
   - update `STATE.md`;
   - stop for human approval.
10. For fixes:
    - fix only the reviewed defects;
    - do not add unrelated improvements;
    - rerun verification;
    - create one local fix commit;
    - stop for re-review.
11. Never automatically:
    - push
    - deploy
    - merge
    - create a pull request
    - apply a database migration
    - change middleware
    - remove Basic Auth
    - rotate or print secrets
    - modify production infrastructure
12. Stop immediately if:
    - scope is unclear;
    - tests fail repeatedly;
    - the same error occurs twice;
    - a migration is needed but was not approved;
    - a package installation is needed but was not approved;
    - authentication security assumptions are uncertain;
    - production access is required.
13. Record the stop reason in `STATE.md` and `loop-run-log.md`.
14. Wait for human approval before continuing.

## Human Gates

- No auto-fix until the checklist for the current slice is complete.
- All high-risk paths require explicit human review.
- Dashboard Auth slices must stay one slice at a time.
- Do not change Basic Auth, middleware, or production auth behavior without an approved slice.

## Worktrees

- Use the built-in worktree per thread for implementation or fix runs.
- One fix per worktree.
- Verifier approval is required before proposing the next step.

## Connectors

- MCP is optional for L1 report-only runs.
- For L2+, use connected tools only when the slice explicitly requires them.

## Budget

- Max sub-agent spawns per run: 0 (L1)
- Report-only first until an approved implementation slice begins
- Review `STATE.md` daily

## Links

- Pattern: [daily-triage](../../patterns/daily-triage.md)
- Checklist: [loop-design-checklist](../../docs/loop-design-checklist.md)
