# Decide a case

A council admits or denies a person under consideration. The person leaves `Needs review` and appears under `Decided` with status `Admitted` or `Denied`. Reopen returns them to consideration. Decisions do not change Referral Signal or capability ranks.

## Sub-features

- `decide-admit` moves a candidate to `Decided` with status `Admitted`.
- `decide-deny` moves a candidate to `Decided` with status `Denied`.
- `decide-reopen` on a decided person shows `Reopen` and returns them to `Needs review` with status `Under review`.
- `decide-signal-unchanged` keeps the person's Referral Signal the same after the decision.

## How to get to it (user POV)

- Open a person in `Needs review` and choose `Admit` or `Deny` on the case.
- Open a person in `Decided` and choose `Reopen`.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy public seed at the printed URL.
- Viewport width ≥ 1280.
- Start from a fresh seed. Prefer `Alice Tanaka` (`New`) so Cleo's case stays intact for other recipes if you forget to reset.

- **Open Alice.** In `Applicants`, choose `Alice Tanaka`. Heading is `Alice Tanaka`. Status kicker is `New`. Buttons `Admit` and `Deny` are present. `Reopen` is not.
- **Note signal.** Snapshot the case so her Referral Signal numeral is recorded.
- **Admit.** Choose `Admit`. Status kicker becomes `Admitted`. `Admit` and `Deny` are gone. `Reopen` is present.
- **Confirm list.** In `Applicants`, `Alice Tanaka` is under `Decided`, not `Needs review`. Search `alice` if the list is long.
- **Signal unchanged.** The Referral Signal numeral matches the before snapshot. No new merged score appears.
- **Reopen.** Choose `Reopen`. Status kicker becomes `Under review`. `Alice Tanaka` returns to `Needs review`.
- **Deny path.** `Reset to seed`. Open `Alice Tanaka` again. Choose `Deny`. Status kicker is `Denied`. She is under `Decided`.
- **Restore.** Choose `Reset to seed` from the Account menu. `Alice Tanaka` is `New` in `Needs review` again.
- **Proof.** Snapshots of Alice before admit, after admit (list + case), after deny, and after reset, under `evidence/<run-id>/decide/`.

## Gotchas

- `Admit` / `Deny` are click-only. Do not send a keyboard shortcut and call the feature missing.
- `Noor Petrov` is already `Admitted` on the seed. Use her for Reopen if you want a decided person without mutating Alice first — then reset.
- After admit, the default list filter still shows Decided; she is not deleted.
- A status kicker change without a list-group check is incomplete proof.
- Reset after this recipe. A leftover Alice in Decided poisons `review-board` and `search-applicants`.
