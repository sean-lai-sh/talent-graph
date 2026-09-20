# Login door

`/login` is the chips sign-in form: heading `Sign in`, Email, Password, submit. No Create account. Unauthenticated `/club` redirects here. `/` stays the chips landing. `/demo` stays a public seed board with no login wall. Do not submit the form and do not sign in.

## Sub-features

- `login-form` renders only the email/password form on a dark chips background. No `Club door` title, no Talent Graph kicker, no Convex explainer, no Create account.
- `club-gate` sends an unauthenticated `/club` visit to `/login`.
- `chips-open` keeps `/` on the chips landing with an underlined `info` control and no Sign in.
- `info-login` keeps Login on `/info`.
- `demo-open` keeps `/demo` on the public seed board with no sign-in form.

## How to get to it (user POV)

- Open `/login` in the browser.
- Open `/club` while signed out. The browser lands on `/login`.
- Open `/info` to confirm Login lives there, then `/` to confirm the chips landing has `info` only.
- Open `/demo` to confirm the public board is still there.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy instance at the printed URL (`/` is chips with `info`; `/info` has Login; `/example` redirects to `/demo`; `/demo` is the seed; `/club` redirects to `/login`; `/login` is Sign in + Email).
- Viewport width ≥ 1280.
- Do not submit Sign in.

- **Open login.** Navigate to `/login` on the doctor URL. The page shows heading `Sign in`, textboxes `Email` and `Password`, and a submit control named `Sign in`. The page does not show `Create account`, `Club door`, `Talent Graph · your club`, or a Convex explainer. Snapshot and screenshot.
- **Club gate.** Navigate to `/club`. The browser lands on `/login` (URL contains `/login`). The same form is visible. No seed board, no `Tech@NYU` applicants list.
- **Chips stays landing.** Navigate to `/`. The page shows an underlined `info` control. There is no Sign in and no applicant list.
- **Info holds Login.** Navigate to `/info`. `Login` and `contact` sit above the program copy; underlined `home` sits under it. There is no timer.
- **Demo stays public.** Navigate to `/demo`. Brand `Tech@NYU` and region `Applicants` are present. There is no sign-in form.
- **Proof.** Save accessibility snapshots and screenshots of (1) `/login` form-only, (2) `/club` landing on `/login`, (3) `/` still chips, (4) `/demo` still the seed board. Put them in `evidence/<run-id>/login-door/`.

## Gotchas

- Do not submit the form. This recipe proves the door and the gate, not a live Convex session.
- `/club` persist shares the developer deployment. A redirect is the only `/club` proof here.
- There is no Create account tab. Public signup is disabled; owners are provisioned out of band.
- Centering is a screenshot claim. HTML that contains the form is not enough.
- `/` is the chips landing, not a redirect to `/demo` or `/login`.
