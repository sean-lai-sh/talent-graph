# Config loader (Doppler-backed tunables) + ModelRun record

> GitHub: https://github.com/sean-lai-sh/talent-graph/issues/10

**Phase C · depends on: #5**

## Goal
Central defaults that a future app can override via env (Doppler project `talent-graph`, config `dev`), and a reproducibility record for every inference run.

## `src/config.ts`
```ts
export interface TalentGraphConfig { btRegularization: number; btMaxIterations: number; btTolerance: number; minComparisons: number; minOpponents: number; topKReferrals: number; }
export const DEFAULT_CONFIG: TalentGraphConfig = { btRegularization: 0.1, btMaxIterations: 500, btTolerance: 1e-6, minComparisons: 3, minOpponents: 2, topKReferrals: 5 };
export function loadConfig(env: Record<string, string | undefined> = process.env): TalentGraphConfig
```
Env names: `TG_BT_REGULARIZATION`, `TG_BT_MAX_ITERATIONS`, `TG_BT_TOLERANCE`, `TG_MIN_COMPARISONS`, `TG_MIN_OPPONENTS`, `TG_TOP_K_REFERRALS`. Invalid values fall back to default with a `console.warn`. Modules in `scoring/` and `inference/` take options explicitly and only use `DEFAULT_CONFIG` as fallbacks; nothing reads `process.env` except `loadConfig`. Document in README: `doppler run --project talent-graph --config dev -- bun test` works, plain `bun test` works.

Add a comment on λ = 0.1: chosen as a modest default that keeps single-comparison nodes near 0 on the seed data; **not** theoretically optimal.

## `src/modelRun.ts`
```ts
export interface ModelRun<TOut = unknown> { id: string; modelType: "referral_signal_v0" | "bradley_terry_v1"; modelVersion: string; parameters: Record<string, unknown>; inputHash: string; createdAt: Date; outputs: TOut; }
export function createModelRun<TOut>(modelType, modelVersion, parameters, inputs: unknown, outputs: TOut, now: Date): ModelRun<TOut>
export function hashInputs(inputs: unknown): string   // stable JSON (sorted keys) → SHA-256 via Bun.CryptoHasher
```
Wrap `computeAllReferralSignals` and `computeCapabilityVectors` with thin `run*` functions that return a `ModelRun`. Same inputs + params ⇒ same `inputHash`.

## Tests — `tests/config.test.ts`, `tests/modelRun.test.ts`
- Env override parsed; garbage falls back to default.
- Hash stable under key reordering; changes when a comparison is added.


## Update-mechanism note (see #15)
`ModelRun.parameters` must include the full `ModelSpec` (kind + version + all weights), not just λ. `inputHash` + spec version together must be sufficient to reproduce any historical number exactly.
