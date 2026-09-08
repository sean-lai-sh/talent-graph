#!/usr/bin/env bun
/**
 * check-theory-sync.ts
 *
 * Compares the last-commit timestamp of docs/theory/main.tex against
 * docs/theory/talent_white_paper.pdf. If main.tex was committed more
 * recently than the PDF, the compiled PDF is stale and should be
 * refreshed from a CI artifact (see docs/theory/README.md).
 *
 * Zero dependencies: shells out to `git log` via Bun.spawnSync.
 *
 * Exit codes:
 *   0 - PDF is up to date (or newer/equal) relative to main.tex
 *   1 - main.tex is newer than the committed PDF (drift detected)
 */

const TEX_PATH = "docs/theory/main.tex";
const PDF_PATH = "docs/theory/talent_white_paper.pdf";

function lastCommitTimestamp(path: string): number | null {
  const result = Bun.spawnSync([
    "git",
    "log",
    "-1",
    "--format=%ct",
    "--",
    path,
  ]);

  if (result.exitCode !== 0) {
    const stderr = result.stderr?.toString().trim();
    throw new Error(
      `git log failed for ${path} (exit ${result.exitCode}): ${stderr}`,
    );
  }

  const stdout = result.stdout?.toString().trim();
  if (!stdout) {
    return null;
  }

  const timestamp = Number.parseInt(stdout, 10);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Could not parse git log output for ${path}: "${stdout}"`);
  }

  return timestamp;
}

function main(): void {
  const texTimestamp = lastCommitTimestamp(TEX_PATH);
  const pdfTimestamp = lastCommitTimestamp(PDF_PATH);

  if (texTimestamp === null) {
    console.error(`No commit history found for ${TEX_PATH}. Nothing to check.`);
    process.exit(0);
  }

  if (pdfTimestamp === null) {
    console.error(
      `No commit history found for ${PDF_PATH}, but ${TEX_PATH} exists. ` +
        `Compile main.tex and commit the PDF (see docs/theory/README.md).`,
    );
    process.exit(1);
  }

  if (texTimestamp > pdfTimestamp) {
    console.error(
      `docs/theory drift detected:\n` +
        `  ${TEX_PATH} last committed at ${texTimestamp} (${new Date(texTimestamp * 1000).toISOString()})\n` +
        `  ${PDF_PATH} last committed at ${pdfTimestamp} (${new Date(pdfTimestamp * 1000).toISOString()})\n` +
        `main.tex has changed since the PDF was last refreshed. Rebuild the PDF ` +
        `from the CI artifact (or locally via docker, see docs/theory/README.md) ` +
        `and commit it alongside your main.tex changes.`,
    );
    process.exit(1);
  }

  console.log(
    `docs/theory is in sync: ${PDF_PATH} (${pdfTimestamp}) is at least as new as ${TEX_PATH} (${texTimestamp}).`,
  );
  process.exit(0);
}

main();
