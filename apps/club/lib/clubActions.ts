import {
  actionAddComparison,
  actionAddReferral,
  actionMeddleReferral,
  actionReset,
  actionSetNow,
  actionSetStatus,
} from "../app/actions.ts";
import type { ClubBoardActions } from "./types.ts";

function unwired(name: keyof ClubBoardActions): ClubBoardActions["setNow"] {
  return async () => {
    throw new Error(`${name} is not wired for this board`);
  };
}

/**
 * Example boards may fall back to in-memory server actions.
 * Persisted `/club` requires explicit Convex handlers — no silent generateSeed writes.
 */
export function resolveBoardActions(
  variant: "example" | "club",
  actions?: Partial<ClubBoardActions>,
): ClubBoardActions {
  const pick = <K extends keyof ClubBoardActions>(
    name: K,
    exampleFn: ClubBoardActions[K],
  ): ClubBoardActions[K] => {
    const override = actions?.[name];
    if (override) return override as ClubBoardActions[K];
    if (variant === "example") return exampleFn;
    return unwired(name) as ClubBoardActions[K];
  };

  const resolved: ClubBoardActions = {
    setNow: pick("setNow", actionSetNow),
    setStatus: pick("setStatus", actionSetStatus),
    addReferral: pick("addReferral", actionAddReferral),
    meddleReferral: pick("meddleReferral", actionMeddleReferral),
    addComparison: pick("addComparison", actionAddComparison),
  };
  if (actions?.addPerson) resolved.addPerson = actions.addPerson;
  const reset = actions?.reset ?? (variant === "example" ? actionReset : undefined);
  if (reset) resolved.reset = reset;
  return resolved;
}
