# Comparisons

The Comparisons sheet lists traits, not opponents. Each collapsed row is the open applicant's won–lost record (`3–0`, or `8–2–2` when ties exist). Expanding a trait shows `Won against` and `Lost to`. Member opponents get a ` · member` tag.

## Sub-features

- `trait-rows` shows dimension names with an en-dash record and no opponent names on those lines.
- `expand-agency` opens Agency and lists won/lost opponents.
- `close-sheet` returns to the case without changing the open applicant.

## How to get to it (user POV)

- Open `/demo`, choose `Cleo Marsh`, then choose `View comparisons` on the Breakdown card.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy public seed at the printed URL (`/` is the chips landing; `/demo` is HTTP 200 seed; `/example` redirects to `/demo`).
- Viewport width ≥ 1280.
- No in-session mutations since launch or since `Reset to seed`.

- **Open Cleo.** Navigate to `/demo`. In `Applicants`, choose the button whose name includes `Cleo Marsh`. The heading level 1 reads `Cleo Marsh`.
- **Open sheet.** Choose `View comparisons`. A dialog named `Comparisons` opens. Agency shows `3–0`. Problem solving shows `8–2–2`. Those lines do not include opponent names.
- **Expand Agency.** Choose `Agency`. `Won against` lists Tess Weber, Hugo Costa, and Oren Goldberg · member. `Lost to` is empty or shows an em dash.
- **Close.** Choose `Close`. The case heading is still `Cleo Marsh`.
- **Proof.** Save accessibility snapshots and screenshots of (1) the trait rows, (2) Agency expanded. Put them in `evidence/<run-id>/comparisons/`.

## Gotchas

- Assert by trait name, not row index. Problem solving is first in dimension order; Agency is third.
- Skip and not-observed compares stay off the sheet.
- Do not treat `tests/comparisonRecord.test.ts` as this feature's proof. The records must appear in the browser.
