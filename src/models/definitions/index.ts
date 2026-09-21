/**
 * Every model that ships with the core.
 *
 * `defineModel` registers as a side effect of a definition module running,
 * so something has to run them: `registry.ts` imports this aggregator, and a
 * caller that imports the registry (or the public barrel) therefore always
 * sees a populated `MODELS`. A new model is one more line here plus its own
 * file — still no central union or switch to edit.
 */

export * from "./bradleyTerry.ts";
export * from "./judgeReliability.ts";
export * from "./referralSignal.ts";
