/**
 * @deprecated Compatibility shim. `ModelRun` and the id formula now live in
 * `./models/run.ts`, the generic runner in `./models/define.ts`, and each
 * model in `./models/definitions/`. Import from those directly; this file
 * only re-exports them so existing callers keep compiling, and goes away
 * once they have moved.
 */

export {
  bradleyTerryModel,
  type CapabilityInput,
  type CapabilityRunOptions,
  runCapabilityVectors,
} from "./models/definitions/bradleyTerry.ts";
export {
  type JudgeCalibrationObservations,
  type JudgeCalibrationOptions,
  judgeReliabilityModel,
  runJudgeCalibration,
} from "./models/definitions/judgeReliability.ts";
export {
  type ReferralSignalInput,
  type ReferralSignalRunOptions,
  referralSignalModel,
  runReferralSignals,
} from "./models/definitions/referralSignal.ts";
export {
  createRun,
  type ModelRun,
  type ModelType,
  RUN_ID_FORMAT,
  type UpstreamRole,
  type UpstreamRun,
} from "./models/run.ts";
/**
 * Hashing lives in `src/provenance/` so that wanting a fingerprint does not
 * pull in the scoring/inference graph; re-exported here for existing callers.
 */
export { hashInputs, stableStringify } from "./provenance/hash.ts";

import { createRun } from "./models/run.ts";

/** @deprecated Renamed: import `createRun` from `./models/run.ts`. */
export const createModelRun = createRun;
