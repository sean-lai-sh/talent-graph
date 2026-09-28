# Referral ladder

A member refers someone, answers Q1–Q3, and places them on the Ladder: an ordered list of people they already referred, one trait at a time, with a side panel of who is stronger. `/demo/home` shows the same steps on the public seed with no Convex. The signed-in path writes the answers and the weighted comparisons.

## Sub-features

- `questions` shows three chip rows, three short boxes, a role pick, and two forced-choice rows, using the applicant's name.
- `q2-empty` blocks Continue and shows an inline error when a Q2 box is empty.
- `ladder` shows the Concept B layout: trait chips, ordered list, Can't place zone, side panel, Skip this trait, and Next trait.
- `keyboard` moves the applicant with the arrow keys and confirms with Enter. The side panel updates.
- `drag` moves the applicant by pointer and the side panel updates before confirm.
- `council-records` shows the new comparison rows on the council Comparisons sheet.

## How to get to it (user POV)

- Open `/demo/home` (no sign-in). Choose `Submit Referral`.
- On a local backend, sign in as `ada.quill@example.test`, land on `/members`, and choose `Submit Referral`.
- After a placement, sign out, sign in as `council.clerk@example.test`, open the new applicant on `/club`, and choose `View comparisons`.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy instance. For the signed-in path, doctor prints `local-backend mode` and the Convex URL is loopback.
- Viewport width ≥ 1280.
- The password is the shell's `SEED_DEV_PASSWORD`. Do not write it into notes, snapshots, or the pull request.
- Use a fresh contact that is not already in the seed, for example `priya.ladder@example.test`, and the name `Priya Ladder`.

- **Demo contact.** Navigate to `/demo/home`. Choose `Submit Referral`. The kicker reads `STEP 1 OF 4`. Fill Email or phone with `priya.ladder@example.test`. Activate `Continue`.
- **Demo profile.** The kicker reads `STEP 2 OF 4`. Fill Name `Priya Ladder` and LinkedIn `https://www.linkedin.com/in/priya-ladder`. Activate `Continue`.
- **Demo questions.** The kicker reads `STEP 3 OF 4`. The heading is `How do you know Priya Ladder? Pick the closest one.` Activate `Class project`, `3-12 months`, and `No`. Fill `What was it?`, `What made it hard?`, and `What did Priya Ladder do that others wouldn't have?`. Activate `Major contributor`, `<10`, and `Top half`. Snapshot this step before Continue. Clear one Q2 box and activate `Continue`. An alert reads `Describe one specific thing you saw.` Restore the box. Activate `Continue`.
- **Demo ladder.** The kicker reads `STEP 4 OF 4 - PLACE PRIYA LADDER`. A trait question is the heading. The list includes `Priya Ladder` and `Applicant you're referring`. The side panel is `WHAT THIS PLACEMENT RECORDS`. Snapshot before moving. Focus the placement list, press ArrowUp, and snapshot the side panel again. Drag `Priya Ladder` to another row and snapshot again. Activate `Next trait: …` or `Finish` until the referral is submitted.
- **Member flow.** Sign in as `ada.quill@example.test`. Repeat contact, profile, questions, and ladder with contact `priya.member@example.test` and name `Priya Member`. Snapshot every step, and snapshot the ladder before and after a keyboard move and before and after a drag. Activate `Finish` or the last `Next trait`.
- **Council sheet.** Activate `Sign out`. Sign in as `council.clerk@example.test`. Open `Priya Member` from `Applicants` (search if needed). Choose `View comparisons`. The dialog `Comparisons` lists a trait with `Priya Member` won or lost against the anchors. Snapshot the sheet.

## Gotchas

- `/demo/home` must not call Convex. A failed preview is not proof of the signed-in write.
- Do not drive this on `:3000` or a shared Convex deployment. Local mode only, `@example.test` accounts only.
- The member flow must not show a score, theta, percentile, or rating. Counts such as `5 comparisons` are expected. Q3 includes the chip `Top 5%` because that is the question's wording.
- Can't place and Skip this trait are different. Can't place records the trait. Skip moves on without a placement.
- The Comparisons sheet omits insufficient observations. Prove a ranked placement, not only Can't place.
- Arrow keys only move the applicant while the placement list has focus. Do not use them as the council J/K shortcuts on this page.
