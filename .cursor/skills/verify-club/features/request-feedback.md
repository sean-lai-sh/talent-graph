# Request feedback

A council asks a club member for a response inside a 48-hour window. The ask opens a sheet, a send adds a pending row on the case, and the member's name can show an `asked` / `pending` mark. This does not write a Referral Signal.

## Sub-features

- `ask-open` opens the `Ask someone` sheet from the Referrals card.
- `ask-send` sends a request to a member who is not already pending.
- `ask-pending` shows the new pending state on the case after send.
- `ask-dismiss` closes the sheet with `Close` or the backdrop without sending.

## How to get to it (user POV)

- On a case, choose the `+` control named `Ask someone` in the `Referrals` card.
- Close the sheet with `Close`, the backdrop (`Close` on the overlay), or `Escape`.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy public seed at the printed URL (`/` is the landing; `/demo` is the board).
- Viewport width ≥ 1280.
- Drive this recipe on `/demo`.
- Open `Cleo Marsh`. She already has a pending request to `Tomas Lindqvist`. Pick a different member.

- **Open sheet.** Choose the button named `Ask someone`. A dialog named `Ask someone` appears. Copy mentions `48 hours to respond.`
- **Dismiss.** Choose `Close`. The dialog is gone. Cleo's case is unchanged (still one pending request, no new name).
- **Reopen and pick.** Choose `Ask someone` again. Check a member who is not marked `pending` (seed suggestion includes `Rafael de Vries`; any non-pending checkbox is valid).
- **Note.** Fill `Note to the member` with `Verification ask`.
- **Send.** Choose `Send request`. The dialog closes. The case shows that member with an `asked` or `pending` mark, or a new waiting row.
- **Restore.** Account menu → `Reset to seed`. Reopen `Cleo Marsh`. The verification member is not pending unless they were on the seed (`Tomas Lindqvist` still is).
- **Proof.** Snapshot the open sheet, the case after send, and the case after reset, under `evidence/<run-id>/request-feedback/`.

## Gotchas

- Tomas is already pending on Cleo. His checkbox is disabled. Checking him and expecting a second send will stall.
- The trigger's accessible name is `Ask someone`, not `+`. Prefer the accessible name.
- `Record` on Dev Raman's overdue row is a different feature (transcribe a response). Do not count it as an ask.
- Escape closes the sheet. Confirm you are not also closing an Account menu.
- Reset after send. A leftover pending row is not seed state.
