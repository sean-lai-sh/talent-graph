# Decide the judge objective: slope vs obvious talent, hits vs consistency

**Owner: Sean. This is a product decision, not a coding task.**
Do not implement a new spec until the boxes below are ticked.

**Phase D+ · depends on: #16 (V2 ships one number, `p̂`)**

## Why this exists

`judge_reliability@2.0.0` already updates weights. It does **not** say what
kind of scout the club is trying to become. That choice changes who gets
trusted when accepting members. Sean decides; the next spec version follows.

There are two independent axes. Answer both. They are not the same question.

---

## Axis 1 — What kind of person should a good judge have spotted?

When we score a referral after the fact, what counts as being *right*?

- [ ] **A. High slope.** Reward judges who named people whose residual
      outcome *rose* after the referral (got better than the opportunity
      correction predicted). The club is buying discovery of people who were
      not done yet.
- [ ] **B. Existing talent that is already obvious *later*.** Reward judges
      whose conviction matches how strong the person looks once the dust
      settles — including people who were already good and stayed good.
- [ ] **C. Both, as two numbers.** Keep a “were they right about the level?”
      score and a “did they catch the rise?” score. Do not average them into
      one `p̂` that owners cannot read.

The white paper already leans **C, with a thumb on surprise**: credit for
identifying strong people *before the rest of the graph knows*
(`docs/theory/main.tex`, “Reward Information Gain, Not Obvious Predictions”).
V2 today is closer to **B**: `E_uv = (x_uv − truth_uv)²` where `truth` is the
cohort percentile of the opportunity-corrected residual at T. A judge who
loudly referred someone who was already going to look strong (and did) scores
well. A judge who referred someone mid and then watched them steeply improve
is not specially rewarded for the slope — only for whether `x_uv` matched the
eventual residual level.

Slope (`ΔR*` between two cutoffs) is not in `src/` on this branch.

### Club translation

If you pick **A**, the people you overweight are early spotters of Cleo-shaped
members. Bram-shaped “everyone already knows” referrals get less trust.
If you pick **B**, a member who has been excellent for years is a valid hit,
and you will trust judges who are good at confirming the obvious.
If you pick **C**, the owner UI must show both or you will smuggle a hidden
blend into accept/archive.

---

## Axis 2 — What error shape do we want in a scout?

Same loss, different personality.

- [ ] **D. Convex / hit-big.** Miss a lot, occasionally name someone
      extreme. High variance is fine if the right tail is fat. One god-tier
      find outweighs a pile of duds. (Option-like. Bad under MSE.)
- [ ] **E. Consistent band.** Regularly spot *good and excellent*. Rarely
      call someone a god who is not, and rarely call someone bad who is
      good. Calibrated, mid-high, few extremes in either direction.
- [ ] **F. Both, as two numbers.** A “precision / consistency” weight and a
      “upside / information gain” weight. Owners pick which to sort by.
      Do not collapse them.

V2 today is **E, hard**. Squared error + EWMA (`η = 0.3`) + `p = exp(−τ Ē)`
punishes big misses more than it loves a single huge hit. A judge who is
wrong often and right once looks unreliable. Shrinkage (`λ = 3`) also stops
a one-hit wonder from becoming an oracle — which is correct for E and hostile
to D unless the “hit” is scored on a different objective (gain, not MSE).

### Club translation

**D** is how you find a Fox nobody would have admitted. You will also admit
more duds on that judge’s word.
**E** is how a small club stays sane: the people you trust are the ones who
keep being roughly right. You will systematically under-weight the weird
scout who is “wrong” until they are not.
**F** is the honest one if you refuse to pretend those are one virtue.

---

## What I (Sean) should write here before anyone codes

1. Axis 1 pick: A / B / C. One sentence why, in club language
   (“I want to overweight people who… when I accept a member”).
2. Axis 2 pick: D / E / F. Same.
3. If C or F: which number is allowed to *move Referral Signal weights*,
   and which is display-only / exploratory. V0 must stay reproducible when
   the extra number is off.
4. Forbidden blend: do not ship a single `p̂` that secretly mixes slope,
   level, consistency, and upside. If you want one slider in the product,
   say so explicitly and name it.

## What must not happen

- Do not retune `η`, `τ`, `λ` in `judge_reliability@2.0.0`. New objective ⇒
  new spec version + CHANGELOG + drift.
- Do not score judges against V1 capability estimates (circular). Truth
  stays outcomes.
- Do not treat “miss a lot, hit big” as a bug in E or a feature in D
  without ticking a box. It is the decision.

## Likely follow-up (only after the boxes)

- **A or C:** residual slope `ΔR*` between two Ts; `src/judges/` stays
  isolated from `src/inference/`.
- **D or F:** a second number (information gain / surprise), not a quieter
  MSE. Paper already names `IG_uv`.
- Example admin (`demo/`): show the chosen number(s) on the T slider. Never
  a single “trust score” unless Sean named it that.
