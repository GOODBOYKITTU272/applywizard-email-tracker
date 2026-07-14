# Loop Budget — ApplyWizz Email Tracker

> Primary loop: **Daily Triage** (report-only first)

## Daily limits

| Loop | Max runs/day | Max tokens/day | Max sub-agent spawns/run |
|------|--------------|----------------|--------------------------|
| Daily Triage | 2 | 100k | 0 (L1) / 2 (L2) |

## On budget exceed

1. Pause schedulers or automations.
2. Append an event to `loop-run-log.md`.
3. Notify human through `STATE.md` and the current report.

## Kill switch

- Command or issue label: `loop-pause-all`
- Resume only after human clears the flag in `STATE.md`

## Estimate spend

```bash
npx @cobusgreyling/loop-cost --pattern daily-triage --level L1
```

## Alerts This Period

<!-- Append throttle or self-limit events here -->
