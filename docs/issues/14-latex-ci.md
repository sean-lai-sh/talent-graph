# LaTeX CI build + theory-sync check

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/13

**Closeout · depends on: #14**

## Goal
Keep the LaTeX design note versioned and buildable in-repo without assuming a local TeX install (none is present on the dev machine).

## Files
- `.github/workflows/theory.yml` — on push/PR touching `docs/theory/**`: run in `ghcr.io/xu-cheng/texlive-full:latest` (or `texlive/texlive`), `latexmk -pdf -interaction=nonstopmode main.tex` inside `docs/theory/`, upload `main.pdf` as a workflow artifact. Fail the job on LaTeX errors.
- `docs/theory/README.md` — how to rebuild locally (`docker run --rm -v "$PWD/docs/theory:/work" -w /work texlive/texlive latexmk -pdf main.tex`), and the policy: *the committed `talent_white_paper.pdf` is refreshed from CI artifacts when `main.tex` changes; `main.tex` is the source of truth.*
- `scripts/check-theory-sync.ts` — fails if `main.tex` is newer in git history than `talent_white_paper.pdf` (compare last-commit dates via `git log -1 --format=%ct -- <file>`). Wire into CI as a non-blocking warning job (`continue-on-error: true`) so drift is visible but doesn't block algorithm PRs.
- Add a `theory` label and a PR template checkbox: "If this PR changes scoring/inference math, `docs/theory/main.tex` and README were updated."

## Acceptance
- Workflow builds the current `main.tex` successfully (it uses `geometry, amsmath, booktabs, enumitem, xcolor, hyperref, microtype, titlesec, fancyhdr, longtable, tabularx`; all in texlive-full).
- Sync script exits 0 on the current tree.
