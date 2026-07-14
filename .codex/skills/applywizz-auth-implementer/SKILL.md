---
name: applywizz-auth-implementer
description: Implement exactly one approved ApplyWizz Dashboard Auth slice, preserve security constraints, run verification, create one local commit, and stop.
user_invocable: false
---

# ApplyWizz Auth Implementer

Use this skill only for an explicitly approved Dashboard Auth slice.

## Responsibilities
- Read the approved slice scope and `STATE.md`.
- Inspect the current source and git diff directly.
- Implement only the approved slice.
- Preserve all security constraints and enumeration behavior.
- Add or update tests for the changed surface.
- Run the required verification commands.
- Create one local commit.
- Update `STATE.md` and `loop-run-log.md`.
- Stop for review.

## Required report format
- A. Files changed
- B. Exported functions/routes changed
- C. Behavior implemented
- D. Security behavior
- E. Test results
- F. Lint/build results
- G. Commit hash
- H. Scope confirmation
- I. Push/deploy confirmation
- J. Open questions

## Hard rules
- Do not push.
- Do not deploy.
- Do not merge.
- Do not change middleware unless the slice explicitly permits it.
- Do not add migrations unless explicitly approved.
- Do not touch unrelated files.
