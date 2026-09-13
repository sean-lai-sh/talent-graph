# Account menu

The Account control opens a menu for the signed-example council member `Admin`. From there a council adds a person, changes which dimensions this round requires, or restores the seed. Add and settings are in-session; Reset to seed puts the example back.

## Sub-features

- `account-open` opens the menu named for Account and shows `Admin` / `Council`.
- `account-add` creates a person with Name and Phone and selects the new case.
- `account-settings` saves a required-dimension checklist.
- `account-reset` restores the seed people and Cleo's Referral Signal **7**.

## How to get to it (user POV)

- Choose the `Account` button in the top bar (the Admin avatar).
- Choose `Add a person`, `Round settings`, or `Reset to seed`.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy public seed at the printed URL.
- Viewport width ≥ 1280.
- No leftover mutations. Refresh `/` if unsure.

- **Open menu.** Choose the button named `Account`. A menu appears with `Admin`, `Council`, `Add a person`, `Round settings`, and `Reset to seed`.
- **Add person.** Choose `Add a person`. Fill `Name` with `Verification Candidate` and `Phone` with `+15550199`. Choose `Add`. The heading level 1 reads `Verification Candidate`. `Applicants` includes that name under `Needs review`.
- **Reset.** Choose `Account`, then `Reset to seed`. `Verification Candidate` is gone. `Cleo Marsh` is in `Needs review` again.
- **Confirm seed.** Choose `Cleo Marsh`. Referral Signal is **7**.
- **Round settings.** Choose `Account`, then `Round settings`. Uncheck `Agency` (leave at least one box checked). Choose `Save`. The menu closes.
- **Reset settings.** Choose `Account`, then `Reset to seed` so required dimensions return to Problem solving, Agency, Output.
- **Proof.** Snapshots of the open menu, the added person, Cleo after reset (signal 7), under `evidence/<run-id>/account-menu/`.

## Gotchas

- Name and Phone are required. Submit stays inert if either is empty — not a broken button.
- Affiliation copy says it never influences a number. Do not expect a signal on a brand-new person.
- `Reset to seed` is the recovery path after every mutating recipe, including this one.
- The Account menu closes on outside click and Escape. Re-open it between Add and Reset.
- Round settings refuse to save when every dimension is unchecked. Leave at least one checked.
- Do not use this menu on `/club`. Add / Reset are the example-board actions.
