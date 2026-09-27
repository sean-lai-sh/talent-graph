# Signed-in club

An admin signs in on the throwaway backend and sees the council board at `/club`. A member signs in and reaches the member portal at `/members`. Both accounts are the synthetic `@example.com` users launch provisioned. This is the only recipe that submits the sign-in form.

## Sub-features

- `admin-board` signs in as `admin@example.com` and shows the council board (`Council`, region `Applicants`).
- `member-portal` signs out, signs in as `member@example.com`, and shows the member portal (`Forum`, `Submit Referral`, no `Council` nav).

## How to get to it (user POV)

- Open `/login` and sign in as the admin. The app lands on `/club`.
- Sign out. Sign in as the member. The app lands on `/members`.

## Driving it with agent-browser

Commands are `agent-browser --session verify-club` from the skill Drive section. Snapshot before every click or fill, and use the `@eN` ref from that snapshot.

Preconditions:

- Doctor reports a healthy instance, `anonymous-agent`, and the two synthetic users.
- Passwords come from `runs/<run-id>/local.env`. Do not print them.
- Viewport width ≥ 1280.
- The walk is foreground-only and ends with `agent-browser --session verify-club close`.

- **Admin door.** Open `/login` on the doctor URL. Snapshot. The page shows heading `Sign in`, textboxes for email and password, and a button `Sign in`. It does not show `Create account`.
- **Admin sign-in.** Fill the email textbox with `admin@example.com` and the password textbox from `ADMIN_PASSWORD`. Click `Sign in`. Wait until the URL contains `/club` and the page shows `Council` and region `Applicants` (click `Create club` first if that button is the only council content). Snapshot and screenshot.
- **Sign out.** Click `Sign out`. The page is the sign-in form again.
- **Member sign-in.** Fill `member@example.com` and `MEMBER_PASSWORD`. Click `Sign in`. Wait until the URL contains `/members`. The page shows heading `Forum` and nav `Submit Referral`. It does not show a `Council` nav item. Snapshot and screenshot.
- **Close.** `agent-browser --session verify-club close`.
- **Proof.** Save snapshots and screenshots of (1) the login form, (2) the admin council board, (3) the member portal. Put them in `evidence/<run-id>/signed-in/`. The step table in `notes.md` records each result. Do not put passwords in that file.

## Gotchas

- Doctor must have named `anonymous-agent` before any fill. A cloud URL, `:3000`, or any email that is not `@example.com` means stop.
- Do not leave the browser open. Cleanup also closes it, but the walk itself ends with `close`.
- Do not run this recipe in the background. A second walk provisions nothing new but can submit again.
- `/demo` is a different board (the public seed). This recipe does not prove Cleo's signal.
- An empty Applicants list is still the council board. `Create club` is only a step when the board has not been created yet.
