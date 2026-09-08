# docs/theory

This directory holds the design note for talent-graph's scoring and inference
math (`main.tex`) and its compiled output (`talent_white_paper.pdf`).

## Source of truth

`main.tex` is canonical. The committed `talent_white_paper.pdf` is a build
artifact refreshed from CI, not hand-edited. If the two drift apart,
`main.tex` wins — regenerate the PDF from it.

`scripts/check-theory-sync.ts` compares the last-commit timestamp (via
`git log -1 --format=%ct`) of `main.tex` against `talent_white_paper.pdf`
and fails if the `.tex` source is newer than the committed PDF. It runs in
CI as a non-blocking (`continue-on-error: true`) job, so drift is visible
without blocking unrelated PRs.

## CI build

`.github/workflows/theory.yml` builds `main.tex` on every push/PR that
touches `docs/theory/**`, using `latexmk -pdf` inside a `texlive-full`
container (all packages this note uses — `geometry`, `amsmath`, `booktabs`,
`enumitem`, `xcolor`, `hyperref`, `microtype`, `titlesec`, `fancyhdr`,
`longtable`, `tabularx` — are preinstalled there). The resulting `main.pdf`
is uploaded as a workflow artifact named `main-pdf`. The build fails the job
on any LaTeX error.

## Rebuilding locally

No local TeX install is assumed or required. Use Docker:

```bash
docker run --rm -v "$PWD/docs/theory:/work" -w /work \
  texlive/texlive latexmk -pdf -interaction=nonstopmode main.tex
```

This produces `docs/theory/main.pdf`. To refresh the committed PDF:

1. Run the command above (or download the `main-pdf` artifact from the
   relevant CI run on GitHub Actions).
2. Copy/rename the result over `docs/theory/talent_white_paper.pdf`.
3. Commit `main.tex` and the refreshed `talent_white_paper.pdf` together.

## When to update this note

Any PR that changes scoring or inference math (Bradley–Terry fitting,
referral signal, comparison selection, drift metrics, etc.) should update
`main.tex` — and this README if the rebuild/policy steps change — in the
same PR. See the PR template checkbox.
