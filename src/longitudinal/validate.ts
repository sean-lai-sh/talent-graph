import type {
  CareerEvent,
  EvidenceClaim,
  GrokEvidencePacket,
  MonitoringPlan,
  SourceProvenance,
} from "./types.ts";

export type LongitudinalValidationResult = { ok: true } | { ok: false; errors: string[] };

function result(errors: string[]): LongitudinalValidationResult {
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function validIso(value: string): boolean {
  return typeof value === "string" && value !== "" && !Number.isNaN(Date.parse(value));
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function validateProvenance(provenance: SourceProvenance): LongitudinalValidationResult {
  const errors: string[] = [];
  if (provenance.sourceId.trim() === "") errors.push("sourceId must be non-empty");
  if (!validHttpUrl(provenance.url)) errors.push("url must be HTTP(S)");
  if (provenance.publisher.trim() === "") errors.push("publisher must be non-empty");
  if (!validDate(provenance.publishedAt)) errors.push("publishedAt must be a valid Date");
  if (!validDate(provenance.retrievedAt)) errors.push("retrievedAt must be a valid Date");
  if (
    validDate(provenance.publishedAt) &&
    validDate(provenance.retrievedAt) &&
    provenance.publishedAt.getTime() > provenance.retrievedAt.getTime()
  ) {
    errors.push("publishedAt must not follow retrievedAt");
  }
  if (provenance.quotedText.trim() === "") errors.push("quotedText must be non-empty");
  if (provenance.contentHash.trim() === "") errors.push("contentHash must be non-empty");
  return result(errors);
}

export function validateEvidenceClaim(claim: EvidenceClaim): LongitudinalValidationResult {
  const errors: string[] = [];
  if (claim.personId.trim() === "") errors.push("personId must be non-empty");
  if (claim.statement.trim() === "") errors.push("statement must be non-empty");
  if (
    !Number.isFinite(claim.identityConfidence) ||
    claim.identityConfidence < 0 ||
    claim.identityConfidence > 1
  ) {
    errors.push("identityConfidence must be in [0, 1]");
  }
  const provenance = validateProvenance(claim.provenance);
  if (!provenance.ok) errors.push(...provenance.errors);
  return result(errors);
}

export function validateCareerEvent(event: CareerEvent): LongitudinalValidationResult {
  const errors: string[] = [];
  if (event.personId.trim() === "") errors.push("personId must be non-empty");
  if (event.title.trim() === "") errors.push("title must be non-empty");
  if (!validDate(event.observedAt)) errors.push("observedAt must be a valid Date");
  if (event.evidenceClaimIds.length === 0) errors.push("at least one evidence claim is required");
  for (const judgment of event.judgments) {
    if (!Number.isFinite(judgment.score) || judgment.score < 0 || judgment.score > 4) {
      errors.push(`${judgment.dimension} score must be in [0, 4]`);
    }
    if (
      !Number.isFinite(judgment.confidence) ||
      judgment.confidence < 0 ||
      judgment.confidence > 1
    ) {
      errors.push(`${judgment.dimension} confidence must be in [0, 1]`);
    }
  }
  return result(errors);
}

export function validateMonitoringPlan(plan: MonitoringPlan): LongitudinalValidationResult {
  const errors: string[] = [];
  if (plan.personId.trim() === "") errors.push("personId must be non-empty");
  if (plan.caseId.trim() === "") errors.push("caseId must be non-empty");
  if (plan.horizonDays !== 90 && plan.horizonDays !== 180) {
    errors.push("horizonDays must be 90 or 180");
  }
  if (!validDate(plan.baselineAt)) errors.push("baselineAt must be a valid Date");
  if (!validDate(plan.dueAt)) errors.push("dueAt must be a valid Date");
  if (
    validDate(plan.baselineAt) &&
    validDate(plan.dueAt) &&
    plan.dueAt.getTime() <= plan.baselineAt.getTime()
  ) {
    errors.push("dueAt must follow baselineAt");
  }
  return result(errors);
}

export function validateGrokEvidencePacket(
  packet: GrokEvidencePacket,
): LongitudinalValidationResult {
  const errors: string[] = [];
  if (packet.schemaVersion !== "1") errors.push("schemaVersion must be 1");
  if (packet.personId.trim() === "") errors.push("personId must be non-empty");
  if (packet.runId.trim() === "") errors.push("runId must be non-empty");
  if (!validIso(packet.retrievedAt)) errors.push("retrievedAt must be an ISO date");
  if (!validIso(packet.cutoffAt)) errors.push("cutoffAt must be an ISO date");

  const retrievedAt = Date.parse(packet.retrievedAt);
  const cutoffAt = Date.parse(packet.cutoffAt);
  packet.items.forEach((item, index) => {
    const prefix = `items[${index}]`;
    if (item.sourceId.trim() === "") errors.push(`${prefix}.sourceId must be non-empty`);
    if (!validHttpUrl(item.url)) errors.push(`${prefix}.url must be HTTP(S)`);
    if (item.publisher.trim() === "") errors.push(`${prefix}.publisher must be non-empty`);
    if (!validIso(item.publishedAt)) errors.push(`${prefix}.publishedAt must be an ISO date`);
    else if (Date.parse(item.publishedAt) > cutoffAt) {
      errors.push(`${prefix}.publishedAt exceeds cutoffAt`);
    }
    if (Number.isFinite(retrievedAt) && Date.parse(item.publishedAt) > retrievedAt) {
      errors.push(`${prefix}.publishedAt exceeds retrievedAt`);
    }
    if (item.quotedText.trim() === "") errors.push(`${prefix}.quotedText must be non-empty`);
    if (item.contentHash.trim() === "") errors.push(`${prefix}.contentHash must be non-empty`);
    if (item.statement.trim() === "") errors.push(`${prefix}.statement must be non-empty`);
  });
  return result(errors);
}
