# Search applicants

Search filters the Applicants list by person name. It does not change stored cases. An empty query restores the full seed list; a name that matches nobody shows a dedicated empty state.

## Sub-features

- `search-match` keeps only rows whose name contains the query (case-insensitive).
- `search-empty` shows `No one by that name.` when nothing matches.
- `search-clear` restores `Needs review` / `Decided` after the query is removed.
- `search-select` opens a visible match into the case pane.

## How to get to it (user POV)

- Type in the `Search applicants` field at the top of `Applicants`.
- On a narrow viewport, choose `Open applicant list` first, then use the same field.

## Driving it with cursor-ide-browser

Preconditions:

- Doctor reports a healthy public seed at the printed URL (`/` redirects; `/example` is the board).
- Viewport width ≥ 1280 so `Applicants` is visible.
- Drive this recipe on `/example`.
- The list includes `Cleo Marsh` and `Bram Okafor`.

- **Focus search.** Click the searchbox named `Search applicants`.
- **Title match.** Type `cleo`. The `Needs review` list contains `Cleo Marsh` and does not contain `Bram Okafor`.
- **Open match.** Choose `Cleo Marsh`. The heading level 1 reads `Cleo Marsh`.
- **Empty state.** Replace the query with `volcano`. The list shows `No one by that name.` and does not show seed names.
- **Clear query.** Clear the searchbox (select all, delete). `Needs review` and `Decided` return. `Cleo Marsh` and `Bram Okafor` are visible again. `Noor Petrov` remains under `Decided`.
- **Proof.** Snapshot and screenshot the match state (`cleo`) and the empty state (`volcano`) under `evidence/<run-id>/search-applicants/`.

## Gotchas

- Search is name-only. A bio or affiliation string is not a supported query; do not treat a miss as a product bug unless the name itself is present.
- Filtering does not persist. Refresh or `Reset to seed` also clears the query.
- The case pane may still show the previously selected person while the list is empty. Assert the list empty state, not only the heading.
- Typing `cleo` while a different field is focused will not filter. Target `Search applicants`.
