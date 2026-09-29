import { defaultReviewStatus } from "./review.ts";
import type { ClubPerson } from "./types.ts";

export type NormalizedContact = { kind: "email"; value: string } | { kind: "phone"; value: string };

export type ProfileDraft = {
  name: string;
  affiliation: string;
  linkedin: string;
  x: string;
  website: string;
  github: string;
  resumeStorageId?: string;
  resumeUrl?: string;
};

export type LookupDecision =
  | { decision: "invalid"; error: string }
  | { decision: "self"; error: string }
  | { decision: "exists" }
  | { decision: "available" };

type SignupPlan =
  | { action: "rejected"; error: string }
  | { action: "exists" }
  | { action: "duplicate" }
  | {
      action: "create";
      person: ClubPerson;
      contact: NormalizedContact;
      referrerUserId: string;
      tokenHash: string;
      createdAt: string;
    };

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const SELF_ERROR = "You can't refer yourself.";

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /[a-z]/i.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function parseContact(
  raw: string,
): { ok: true; contact: NormalizedContact } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Enter an email or phone number." };
  if (trimmed.includes("@")) {
    const value = trimmed.toLowerCase();
    if (!EMAIL.test(value)) return { ok: false, error: "Enter a valid email address." };
    return { ok: true, contact: { kind: "email", value } };
  }
  const phone = normalizePhone(trimmed);
  if (!phone) {
    const error = /\d/.test(trimmed)
      ? "Enter a valid phone number."
      : "Enter a valid email or phone number.";
    return { ok: false, error };
  }
  return { ok: true, contact: { kind: "phone", value: phone } };
}

export function isSelfContact(
  actor: { email?: string; phone?: string },
  contact: NormalizedContact,
): boolean {
  if (contact.kind === "email") {
    return actor.email?.trim().toLowerCase() === contact.value;
  }
  if (!actor.phone) return false;
  return normalizePhone(actor.phone) === contact.value;
}

function personHasContact(person: ClubPerson, contact: NormalizedContact): boolean {
  if (contact.kind === "email") return person.email?.trim().toLowerCase() === contact.value;
  if (!person.phone) return false;
  return normalizePhone(person.phone) === contact.value;
}

export function peopleWithContact(
  people: readonly ClubPerson[],
  contact: NormalizedContact,
): ClubPerson[] {
  return people.filter((person) => personHasContact(person, contact));
}

export type PersonMatch =
  | { kind: "person"; personId: string }
  | { kind: "none" }
  | { kind: "ambiguous" };

export function personMatch(people: readonly { id: string }[]): PersonMatch {
  if (people.length > 1) return { kind: "ambiguous" };
  const person = people[0];
  return person ? { kind: "person", personId: person.id } : { kind: "none" };
}

export function lookupDecision(input: {
  raw: string;
  actor: { email?: string; phone?: string };
  profileExists: boolean;
}): LookupDecision {
  const parsed = parseContact(input.raw);
  if (!parsed.ok) return { decision: "invalid", error: parsed.error };
  if (isSelfContact(input.actor, parsed.contact)) {
    return { decision: "self", error: SELF_ERROR };
  }
  if (input.profileExists) return { decision: "exists" };
  return { decision: "available" };
}

function normalizeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.toString();
}

type NormalizedProfile = {
  name: string;
  website?: string;
  affiliation?: string;
  linkedin?: string;
  x?: string;
  github?: string;
  resumeStorageId?: string;
  resumeUrl?: string;
};

export function normalizeProfile(
  draft: ProfileDraft,
  hasResumeFile = false,
): { ok: true; profile: NormalizedProfile } | { ok: false; error: string } {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  const website = optionalUrl(draft.website, "Enter a valid personal page URL.");
  if (website.ok === false) return website;
  const linkedin = optionalUrl(draft.linkedin, "Enter a valid LinkedIn URL.");
  if (linkedin.ok === false) return linkedin;
  const x = optionalUrl(draft.x, "Enter a valid X URL.");
  if (x.ok === false) return x;
  const github = optionalUrl(draft.github, "Enter a valid GitHub URL.");
  if (github.ok === false) return github;

  const resumeStorageId = draft.resumeStorageId?.trim() || undefined;
  const hasResume = hasResumeFile || resumeStorageId !== undefined;
  if (!hasResume && !linkedin.url && !x.url) {
    return { ok: false, error: "Add a resume or a LinkedIn or X profile." };
  }

  const profile: NormalizedProfile = { name };
  if (website.url) profile.website = website.url;
  const affiliation = draft.affiliation.trim();
  if (affiliation) profile.affiliation = affiliation;
  if (linkedin.url) profile.linkedin = linkedin.url;
  if (x.url) profile.x = x.url;
  if (github.url) profile.github = github.url;
  if (resumeStorageId) profile.resumeStorageId = resumeStorageId;
  const resumeUrl = draft.resumeUrl?.trim();
  if (resumeUrl) profile.resumeUrl = resumeUrl;
  return { ok: true, profile };
}

function optionalUrl(
  raw: string,
  error: string,
): { ok: true; url?: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true };
  const url = normalizeHttpUrl(trimmed);
  if (!url) return { ok: false, error };
  return { ok: true, url };
}

export function planSignup(input: {
  rawContact: string;
  actor: { userId: string; email?: string; phone?: string };
  profileExists: boolean;
  referrerAlreadyLinked: boolean;
  draft: ProfileDraft;
  now: string;
  personId: string;
  tokenHash: string;
}): SignupPlan {
  const parsed = parseContact(input.rawContact);
  if (!parsed.ok) return { action: "rejected", error: parsed.error };
  if (isSelfContact(input.actor, parsed.contact)) {
    return { action: "rejected", error: SELF_ERROR };
  }
  if (input.referrerAlreadyLinked) return { action: "duplicate" };
  if (input.profileExists) return { action: "exists" };

  const normalized = normalizeProfile(input.draft);
  if (!normalized.ok) return { action: "rejected", error: normalized.error };
  const { profile } = normalized;
  const person: ClubPerson = {
    id: input.personId,
    name: profile.name,
    status: "candidate",
    reviewStatus: defaultReviewStatus("candidate"),
    createdAt: input.now,
    updatedAt: input.now,
  };
  if (parsed.contact.kind === "email") person.email = parsed.contact.value;
  else person.phone = parsed.contact.value;
  if (profile.affiliation) person.affiliation = profile.affiliation;
  if (profile.linkedin) person.linkedin = profile.linkedin;
  if (profile.x) person.x = profile.x;
  if (profile.github) person.github = profile.github;
  if (profile.website) person.website = profile.website;
  if (profile.resumeStorageId) person.resumeStorageId = profile.resumeStorageId;
  if (profile.resumeUrl) person.resume = profile.resumeUrl;

  return {
    action: "create",
    person,
    contact: parsed.contact,
    referrerUserId: input.actor.userId,
    tokenHash: input.tokenHash,
    createdAt: input.now,
  };
}

export function mergeCandidate(people: readonly ClubPerson[], person: ClubPerson): ClubPerson[] {
  if (people.some((row) => row.id === person.id)) return [...people];
  if (person.email && people.some((row) => row.email === person.email)) return [...people];
  const phone = person.phone;
  if (phone && people.some((row) => personHasContact(row, { kind: "phone", value: phone }))) {
    return [...people];
  }
  return [...people, person];
}

export function statusLine(createdAtIso: string): string {
  const date = new Date(createdAtIso);
  if (Number.isNaN(date.getTime())) return "Referred, under review";
  const month = MONTHS[date.getUTCMonth()] ?? "January";
  return `Referred on ${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}, under review`;
}

export async function hashStatusToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function newStatusToken(): Promise<{ token: string; hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return { token, hash: await hashStatusToken(token) };
}

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export const UPLOAD_URL_LIMIT = { perMember: 10, windowMs: 60 * 60 * 1000 } as const;

export function uploadUrlAllowed(issuedAt: readonly number[], now: number): boolean {
  const since = now - UPLOAD_URL_LIMIT.windowMs;
  return issuedAt.filter((at) => at > since).length < UPLOAD_URL_LIMIT.perMember;
}

export function resumeFileError(
  file: { contentType?: string; size: number } | null,
): string | null {
  if (!file) return "Upload the resume again.";
  if (file.contentType !== "application/pdf") return "Resume must be a PDF.";
  if (file.size > RESUME_MAX_BYTES) return "Resume must be 5 MB or smaller.";
  return null;
}

export function resumeClaimError(
  upload: { uploaderUserId: string; usedAt?: number } | null,
  userId: string,
): string | null {
  if (!upload || upload.uploaderUserId !== userId) return "Upload the resume again.";
  if (upload.usedAt !== undefined) return "That resume is already attached to a referral.";
  return null;
}
