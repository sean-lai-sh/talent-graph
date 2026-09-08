# Referral graph utilities (adjacency, neighbourhoods, filters)

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
export function inDegree(g, personId): number
export function outDegree(g, personId): number
export function neighbourhood(g, personId, depth = 1): { people: Person[]; referrals: Referral[] }
export function filterGraph(g, f: { status?: PersonStatus[]; affiliation?: string; evidenceTypes?: EvidenceType[]; minSignal?: number; signals?: Map<string, ReferralSignalResult> }): ReferralGraph
export function toEdgeList(g): Array<{ source: string; target: string; weight: number /* R_uv */ }>
```
`toEdgeList` may import `referralStrength` from scoring (graph → scoring dependency is allowed; scoring → graph is not). `filterGraph` with `minSignal` requires `signals` to be passed in (do not compute inside).

## Tests — `tests/graph.test.ts`
Small 5-node fixture: in/out degree, neighbourhood depth 1 vs 2, filter by status and evidence type, edge weights equal `referralStrength`.

## Do not
- Compute layout or positions. Layout is visual-only and lives in the future UI.
- Encode Bradley–Terry results anywhere in this module.
