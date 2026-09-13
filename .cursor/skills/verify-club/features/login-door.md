# Login door

`/login` is a centered Better Auth card with Sign in / Create account, Email, Password, and submit. Unauthenticated `/club` redirects here. `/example` stays a public seed board with no login wall. Do not submit the form and do not sign in.

## Sub-features

- `login-card` renders only the card, centered in the viewport. No `Club door` title, no Talent Graph kicker, no Convex explainer.
- `login-tabs` shows `Sign in` and `Create account`. Create account reveals Name.
- `club-gate` sends an unauthenticated `/club` visit to `/login`.
- `example-open` keeps `/example` on the public seed board with no sign-in card.

## How to get to it (user POV)

- Open `/login` in the browser.
- Open `/club` while signed out. The browser lands on `/login`.
- Open `/example` to confirm the public board is still there.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy public seed at the printed URL (`/` redirects; `/example` is the board; `/club` redirects to `/login`; `/login` is the card).
- Viewport width ≥ 1280.
- Do not submit Sign in or Create account.

- **Open login.** Navigate to `/login` on the doctor URL. The page shows buttons `Sign in` and `Create account`, textboxes `Email` and `Password`, and a submit control named `Sign in`. The page does not show `Club door`, `Talent Graph · your club`, or a Convex explainer. The card sits in the middle of the viewport, horizontally and vertically. Snapshot and screenshot.
- **Create account tab.** Choose `Create account`. A `Name` field appears. Submit is named `Create account`. Do not fill or submit. Snapshot.
- **Back to sign in.** Choose `Sign in`. Name is gone. Submit is named `Sign in`.
- **Club gate.** Navigate to `/club`. The browser lands on `/login` (URL contains `/login`). The same card is visible. No seed board, no `Tech@NYU` applicants list.
- **Example stays public.** Navigate to `/example`. Brand `Tech@NYU` and region `Applicants` are present. There is no sign-in card.
- **Proof.** Save accessibility snapshots and screenshots of (1) `/login` card-only and centered, (2) Create account with Name, (3) `/club` landing on `/login`, (4) `/example` still the seed board. Put them in `evidence/<run-id>/login-door/`.

## Gotchas

- Do not submit the form. This recipe proves the door and the gate, not a live Convex session.
- `/club` persist shares the developer deployment. A redirect is the only `/club` proof here.
- Root layout metadata must not put `Club door` in the `/login` body. Judge the visible page, not only `<title>`.
- Centering is a screenshot claim. HTML that contains the card is not enough.
- `/` still redirects to `/example`, not `/login`.
