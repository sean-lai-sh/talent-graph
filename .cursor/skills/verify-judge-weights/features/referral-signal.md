# Referral signal

Adding a new judge's referral never lowers a candidate's signal.

## Sub-features

- `detect` — on only when `REFERRAL_SIGNAL_V0_2_0`, `judgePseudoWeight`, and `pseudoWeight` are in the checkout.
- `monotonic` — an equal-strength referral from a judge at reliability 0.09 beside a judge at 0.81 does not lower `s`.

## How to get to it (user POV)

- This check is the weight-aware Referral Signal. The member referral form is covered by admin-only weights, not by this math.
- The run calls `computeReferralSignal` with the registered 0.2.0 spec.

## Driving it with cursor-ide-browser

Preconditions: the markers above are in this checkout. If any marker is missing, print `SKIPPED - needs #123 on main` and stop this feature.

- Run `.cursor/skills/verify-judge-weights/run.sh`.
- Read the `referral-signal` line in `evidence/<run>/run.txt`.

## Gotchas

- Main still has Referral Signal 0.1.0 and a `test.todo` for this property. That todo is not the feature.
- Setting an env var does not turn this on.
- A skip must not increment `passed`.
