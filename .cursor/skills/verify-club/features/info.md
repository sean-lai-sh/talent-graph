# Info

`/` is a quiet chips canvas with an underlined `info` link. `/info` keeps the same chip, with a small bottom-left stack: program copy, Login, and `chips@techatnyu.org`. There is no timer.

## Sub-features

- `info-underline` on `/` is the only chrome besides the chip. No Sign in, no applicant list.
- `info-page` shows the chip, copy, Login, and contact. No countdown. No Create account.
- `info-login` sends Login to `/login`.

## How to get to it (user POV)

- Open `/` and choose `info`.
- Open `/info` directly.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy instance at the printed URL (`/` has `info`; `/info` has Login and `chips@techatnyu.org`).
- Viewport width ≥ 1280.
- Do not submit Login.

- **Landing.** Navigate to `/`. The page shows an underlined `info` control. It does not show `Sign in`, `Applicants`, or `Cleo Marsh`. Snapshot and screenshot.
- **Open info.** Choose `info`. The URL is `/info`. The chip is still in the center. Bottom left shows the program copy, `Login`, and `chips@techatnyu.org`. There is no timer. Snapshot and screenshot.
- **Login door.** Choose `Login`. The browser lands on `/login`. Do not submit.
- **Proof.** Save accessibility snapshots and screenshots of (1) `/` with underlined info, (2) `/info` bottom-left stack. Put them in `evidence/<run-id>/info/`.

## Gotchas

- Do not sign in. This recipe proves the public note, not a Convex session.
- `/info` is not the seed board. `Tech@NYU` as brand chrome belongs on `/demo`.
- There is no countdown above the chip.
