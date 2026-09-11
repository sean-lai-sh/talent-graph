import {
  actionAddPerson,
  actionDecide,
  actionRecordFeedback,
  actionRequestFeedback,
  actionReset,
  actionSetReviewConfig,
} from "../app/actions.ts";
import type { ClubBoardActions } from "./types.ts";

type Required = Pick<
  ClubBoardActions,
  "decide" | "requestFeedback" | "recordFeedback" | "setReviewConfig"
>;

function unwired<K extends keyof Required>(name: K): Required[K] {
  const thrower = async () => {
    throw new Error(`${name} is not wired for this board`);
  };
  return thrower as unknown as Required[K];
}

/**
 * Example boards may fall back to in-memory server actions.
 * Persisted `/club` requires explicit Convex handlers — no silent generateSeed writes.
 */
export function resolveBoardActions(
  variant: "example" | "club",
  actions?: Partial<ClubBoardActions>,
): ClubBoardActions {
  const pick = <K extends keyof Required>(name: K, exampleFn: Required[K]): Required[K] => {
    const override = actions?.[name];
    if (override) return override as Required[K];
    if (variant === "example") return exampleFn;
    return unwired(name);
  };

  const resolved: ClubBoardActions = {
    decide: pick("decide", actionDecide),
    requestFeedback: pick("requestFeedback", actionRequestFeedback),
    recordFeedback: pick("recordFeedback", actionRecordFeedback),
    setReviewConfig: pick("setReviewConfig", actionSetReviewConfig),
  };
  const addPerson = actions?.addPerson ?? (variant === "example" ? actionAddPerson : undefined);
  if (addPerson) resolved.addPerson = addPerson;
  const reset = actions?.reset ?? (variant === "example" ? actionReset : undefined);
  if (reset) resolved.reset = reset;
  return resolved;
}
