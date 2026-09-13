# Review board

The public council page lists people under consideration, opens one case, and shows Referral Signal, Relative Capability Estimate (Breakdown), and Structured Evidence (Referrals / notes) as three separate channels. Missing evidence is never a score of 0.

## Sub-features

- `board-load` renders the seed board on `/example` with brand `Tech@NYU` and region `Applicants`. Visiting `/` lands on `/example`.
- `board-list` groups `Needs review` and `Decided` and names seed people.
- `board-open-case` opens one person from the list or the next/previous controls.
- `board-cleo-channels` shows Cleo's Referral Signal **7**, `Early signal`, `Under-recognized`, and referrer `Rafael de Vries`.
- `board-insufficient` shows `Insufficient Evidence` (not `0`) for someone with no incoming referrals.

## How to get to it (user POV)

- Open `/` in the browser (redirects to `/example`).
- Open `/example` in the browser (public seed board).
- Choose a name in `Applicants`.
- Choose `Next applicant` or `Previous applicant` in the top bar.
- On a narrow viewport, choose `Open applicant list`, then a name. Or choose `← All candidates` on the case to return to the list.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy public seed at the printed URL (`GET /` redirects to `/example`; `/example` is HTTP 200 seed).
- Viewport width ≥ 1280.
- No in-session mutations since launch or since `Reset to seed`.

- **Load home redirect.** Navigate to `/` on the doctor URL. The browser lands on `/example`. Snapshot. The page shows `Tech@NYU`, region `Applicants`, searchbox `Search applicants`, groups `Needs review` and `Decided`, and a case heading (a seed name).
- **Load example door.** Navigate to `/example` directly. Snapshot. The same brand, Applicants region, and seed names are present. This is the public seed door, not a shortcut for `/`.
- **Open Cleo.** In `Applicants`, choose the button whose name includes `Cleo Marsh`. The heading level 1 reads `Cleo Marsh`. The status kicker reads `Under review`.
- **Referral Signal.** The case shows a numeric **7** and the band `Early signal`. The page does not show `0` as her signal. Screenshot so the dial or the numeral 7 is visible.
- **Breakdown / under-recognized.** The `Breakdown` card is visible and includes `Under-recognized` (and may also show `Single source`). Capability ranks sit in Breakdown, not merged into the 7.
- **Referrals.** The `Referrals` heading is visible. Expanding or reading the first written referrer shows `Rafael de Vries`.
- **Insufficient Evidence.** In `Applicants`, choose `Ife Doyle`. The heading reads `Ife Doyle`. The Referral Signal area shows `Insufficient Evidence` and does not show a score of `0`.
- **Stepper.** From Ife, choose `Previous applicant` or `Next applicant`. The heading changes to another seed name and the counter in the top bar updates.
- **Proof.** Save accessibility snapshots and screenshots of (1) visiting `/` then the loaded `/example` board with Applicants visible, (2) Cleo's case with signal 7, (3) Ife's Insufficient Evidence. Put them in `evidence/<run-id>/review-board/`.

## Gotchas

- Prove `/` redirects to `/example`, then prove the board on `/example`. Proving only one leaves the other unverified.
- On viewports under `lg`, `Applicants` is hidden. Open it with `Open applicant list` or the proof will look empty.
- The first selected case is whoever sorts first by Referral Signal, not Cleo. Always choose `Cleo Marsh` by name — do not assume the open case is hers.
- If cursor-ide-browser fails to load `127.0.0.1`, use `helpers/chrome-drive.ts` (see the skill Drive section).
- Do not treat engine unit tests (`cleo.v2Signal === 7`) as this feature's proof. The number must appear in the browser.
- Banned product phrases (`Talent Score`, `Capability Score`, …) must not appear on the board.
- Do not open `/club` to "get a real board." Unauthenticated `/club` redirects to `/login`. Signed-in persist is out of scope and shares Convex.
