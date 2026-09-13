# Demo review queue

After the dashboard, demo prints a review queue: candidates grouped by evidence state. Buckets are labels (`Under-recognized`, `Ready to decide`, `Single source`, `No referrals`, …). No bucket is a number and no line merges Referral Signal with capability.

## Sub-features

- `queue-header` prints `Review queue (candidates, by evidence state):`.
- `queue-buckets` prints the seed's bucket labels with people under them.
- `queue-cleo` places `Cleo Marsh` under `Under-recognized`.
- `queue-reasons` prints factual reasons after each name (counts / states), not a score.

## How to get to it (user POV)

- Run `bun run demo` from the repository root and read past the first `====` rule to the review-queue section.
- Or run `.cursor/skills/verify-engine/helpers/demo.sh demo-review-queue` and open that section in `stdout.txt`.

## Driving it with verify-engine

Preconditions:

- Doctor is clean.
- `TG_*` unset.

- **Run demo.** `.cursor/skills/verify-engine/helpers/demo.sh demo-review-queue`. Exit code `0`.
- **Find the section.** After a line of `=` characters, stdout contains `Review queue (candidates, by evidence state):`.
- **Cleo.** Under a line `  Under-recognized`, a following indented line starts with `Cleo Marsh`.
- **Other seed pins.** `Dev Raman` appears under `Single source`. `Alice Tanaka` and `Bram Okafor` appear under `Ready to decide`. `Ife Doyle` appears under `No referrals`.
- **No merged number.** Queue lines do not print a single combined rank for a person. Reasons may mention counts.
- **Proof.** Quote the queue header plus the Cleo line in `notes.md`. Keep full stdout.

## Gotchas

- Queue order is evidence-state precedence, not Referral Signal sort (the Club UI sorts the list differently). Do not expect Bram first here.
- Members and archived people are not in this candidate queue.
- The same `bun run demo` transcript can serve dashboard, queue, reports, and calibration if you keep one file and cite sections. Still record the feature id you claimed.
