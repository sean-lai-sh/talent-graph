# Admission credit

After a decision, each referrer has `decidedBy`, a position, and a leave-one-judge-out signal. The judge who decided gets no admission credit.

## Sub-features

- `detect` — on only when `computeAdmission`, `decidedBy`, `signalWithoutEachReferrer`, and `admissionObservations` are in the checkout.
- `snapshot` — the decision snapshot names the deciding judge and both leave-one-out signals.
- `positions` — both referrers have a finite position.
- `recusal` — `computeAdmission` terms omit the deciding judge.

## How to get to it (user POV)

- This check is engine-level. There is no member page for it until the admin judges UI lands.
- The run adds two member judges and a candidate, records two referrals, and admits the candidate as the first judge.

## Driving it with cursor-ide-browser

Preconditions: the four markers above are in this checkout. If any marker is missing, print `SKIPPED - needs #120 on main` and stop this feature.

- Run `.cursor/skills/verify-judge-weights/run.sh`.
- Read the `admission-credit` line in `evidence/<run>/run.txt`.
- A pass line means the snapshot, positions, and recusal all held.

## Gotchas

- Setting an env var does not turn this on.
- A skip must not increment `passed`.
