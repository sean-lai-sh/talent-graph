# V0: referral strength R_uv and Referral Signal S_v with explanation

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/2

**Phase B · depends on: #1**

## Goal
Deterministic, fully inspectable Referral Signal. This is the only V0 score.

## Math (implement exactly)
```
n(x)  = (x − 1) / 4                       x ∈ {1,…,5}
X_uv  = 0.50·n(conviction) + 0.30·n(confidence) + 0.20·n(relationshipDepth)
R_uv  = X_uv · EVIDENCE_MULTIPLIER[evidenceType]          ∈ [0,1]
p_u   = 1 for every referrer (not learned yet)
Top5(v) = up to 5 incoming referrals with largest R_uv (ties: earlier createdAt first, then id)
S_v   = |Top5(v)| ? mean(R_uv, u ∈ Top5(v)) : 0
ReferralSignal_v = 100 · S_v      // float; round ONLY in a display helper
```

## Files
### `src/scoring/referralStrength.ts`
- `normalizeScale(x: Scale5): number`
- `referralStrength(r: Referral): number` — returns `R_uv`.
- `referralStrengthBreakdown(r)` → `{ normalized: {conviction, confidence, relationshipDepth}, weighted: X_uv, multiplier, strength }` for explanation UIs.

### `src/scoring/referralSignal.ts`
```ts
export interface ReferralSignalResult {
  personId: string;
  signal: number;            // 100·S_v, unrounded
  s: number;                 // S_v in [0,1]
  contributing: Array<{ referral: Referral; strength: number }>; // Top5, sorted desc
  incomingCount: number;
  usedCount: number;         // |Top5|
  firsthandCount: number;    // evidenceType ∈ {firsthand_work, firsthand_personal} among ALL incoming
  strongest: number | null;  // max R_uv or null
  evidenceTypes: EvidenceType[]; // distinct, among all incoming
  explanation: string;       // fixed text: "Referral Signal summarizes the current strength of referral evidence. It is not an objective measure of ability."
}
export function computeReferralSignal(personId: string, referrals: Referral[], opts?: { topK?: number }): ReferralSignalResult
export function computeAllReferralSignals(people: Person[], referrals: Referral[], opts?): Map<string, ReferralSignalResult>
export function displayReferralSignal(r: ReferralSignalResult): number   // Math.round
```
`topK` defaults to `config.topKReferrals` (5). Only referrals whose `candidateId === personId` count. Ignore referrals whose referrer id equals candidate id (defensive).

## Tests — `tests/scoring.test.ts`
- `normalizeScale(1)=0`, `(3)=0.5`, `(5)=1`.
- All-5 firsthand_work referral ⇒ `R=1`; all-1 ⇒ `R=0`; reputation all-5 ⇒ `0.6`.
- Six incoming referrals ⇒ only the five strongest are averaged; `usedCount=5`, `incomingCount=6`.
- Zero referrals ⇒ `signal=0`, `strongest=null`, `contributing=[]`.
- `signal` retains float precision (e.g. `73.33333…`); `displayReferralSignal` rounds.
- Changing `affiliation` on the Person does not change the result (assert equality).
- Rubric `Evaluation` records are not an input at all (type-level: function signature has none).

## Do not
- Import anything from `src/inference/`.
- Use rubric evaluations or comparisons.
