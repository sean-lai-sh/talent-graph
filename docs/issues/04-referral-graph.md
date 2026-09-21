# Referral graph utilities (adjacency)

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/3

**Phase B · depends on: #1**

## Goal
Pure helpers over the directed referral graph `u → v` so a UI (later) or the seed/demo scripts can ask structural questions without touching scoring.

## File — `src/graph/referralGraph.ts`
```ts
export interface ReferralGraph {
  nodes: Map<string, Person>;
  out: Map<string, Referral[]>;   // referrals made by id
  in:  Map<string, Referral[]>;   // referrals received by id
}
export function buildReferralGraph(people: Person[], referrals: Referral[]): ReferralGraph
export function referrersOf(g, personId): Person[]
export function referredBy(g, personId): Person[]
```

**Layering, as of #56 T3 (owner decision D2): `src/graph/` imports only `src/domain/`.** The dependency runs `scoring → graph`; `graph → scoring` is not allowed. So edge weights are not computed here — `toEdgeList(sg: ScoredReferralGraph)` lives in `src/scoring/scoredGraph.ts`, and score-based selection is `selectBySignal(g, signals, minSignal)` in `src/analysis/graphSelection.ts`, where `signals` is a required parameter (never computed inside). `inDegree`, `outDegree`, `neighbourhood` and `filterGraph` were deleted in #56 T3: no caller outside the tests ever reached them.

## Tests — `tests/graph.test.ts`
Small 5-node fixture: `referrersOf` / `referredBy`, unknown endpoints dropped, edge weights equal `referralStrength`. `selectBySignal` is covered in `tests/graphSelection.test.ts`.

## Do not
- Compute layout or positions. Layout is visual-only and lives in the future UI.
- Encode Bradley–Terry results anywhere in this module.
