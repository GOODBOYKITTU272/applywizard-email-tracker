---
name: applywizz-auth-reviewer
description: Review one approved ApplyWizz Dashboard Auth slice by inspecting source and git diff, running the required tests, and returning a verdict without editing code.
user_invocable: false
---

# ApplyWizz Auth Reviewer

Use this skill only to review a completed Dashboard Auth slice.

## Responsibilities
- Inspect the source and git diff directly.
- Independently run the required verification commands.
- Check scope, security, regressions, and logging behavior.
- Return a clear verdict.
- Stop for human approval.

## Required report format
- A. PASS / PASS WITH FIXES / FAIL
- B. Required fixes
- C. Non-blocking notes
- D. Safe to proceed?
- E. Push/deploy needed?

## Hard rules
- Do not edit files during review.
- Do not push.
- Do not deploy.
- Do not merge.
- Do not broaden scope beyond the reviewed slice.
