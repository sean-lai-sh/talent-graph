/**
 * The two judgments one evidence item needs, store first and network second.
 *
 * With a store populated these issue no request at all: the record is the
 * observation, and the assessment is a projection of it. The fingerprint is
 * the service's, because only the service knows what it would send.
 */

import type { CareerEvidenceSpec } from "../models/spec.ts";
import type { JudgmentDeps } from "./coalescing.ts";
import { coalesce } from "./coalescing.ts";
import { expectationFor } from "./expectations.ts";
import type { ClaimAssessment, IdentityAssessment, JevJudgment } from "./judgments.ts";
import { projectClaim, projectIdentity } from "./projections.ts";
import type { CanonicalIdentity, GrokEvidenceItem } from "./types.ts";

/**
 * The identity judgment for one evidence item, from the store when it is
 * already recorded and from the network otherwise.
 *
 * With `deps.store` populated this issues no request at all: the record is the
 * observation, and the assessment is a projection of it. The fingerprint is
 * the service's, because only the service knows what it would send.
 */
export async function judgeIdentity(
  evidence: GrokEvidenceItem,
  identity: CanonicalIdentity,
  spec: CareerEvidenceSpec,
  deps: JudgmentDeps,
): Promise<JevJudgment<IdentityAssessment>> {
  const expected = expectationFor({
    fingerprint: deps.service.identityFingerprint(identity, evidence),
    kind: "identity",
    personId: identity.personId,
    evidence,
    spec,
  });
  const coalesced = await coalesce(deps, expected, (options) =>
    deps.service.assessIdentity(identity, evidence, options),
  );
  return (
    coalesced.judged ?? {
      assessment: projectIdentity(coalesced.record, spec),
      record: coalesced.record,
    }
  );
}

/** The claim judgment for one evidence item; store first, network second. */
export async function judgeClaim(
  evidence: GrokEvidenceItem,
  personId: string,
  spec: CareerEvidenceSpec,
  deps: JudgmentDeps,
): Promise<JevJudgment<ClaimAssessment>> {
  const expected = expectationFor({
    fingerprint: deps.service.claimFingerprint(evidence),
    kind: "claim",
    personId,
    evidence,
    spec,
  });
  const coalesced = await coalesce(deps, expected, (options) =>
    deps.service.assessClaim(evidence, personId, options),
  );
  return (
    coalesced.judged ?? {
      assessment: projectClaim(coalesced.record, spec),
      record: coalesced.record,
    }
  );
}
