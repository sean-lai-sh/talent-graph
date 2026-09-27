import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeView, emptyState } from "../apps/club/lib/engine.ts";
import {
  hashStatusToken,
  lookupDecision,
  mergeCandidate,
  newStatusToken,
  normalizeProfile,
  parseContact,
  planSignup,
  statusLine,
} from "../apps/club/lib/referralSignup.ts";
import { reviveState } from "../apps/club/lib/serialize.ts";
import { MEMBER_NAV } from "../apps/club/lib/shellNav.ts";

const NOW = "2026-09-27T15:04:00.000Z";
const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}
const ACTOR = { userId: "user-member", email: "member@example.com", phone: "(212) 555-0199" };

const draft = {
  name: "Ada Example",
  affiliation: "Example Lab",
  linkedin: "",
  x: "",
  website: "https://ada.example.com",
  github: "https://github.com/ada-example",
  resumeStorageId: "storage-resume",
};

function plan(overrides: Partial<Parameters<typeof planSignup>[0]> = {}) {
  return planSignup({
    rawContact: "ada@example.com",
    actor: ACTOR,
    profileExists: false,
    referrerAlreadyLinked: false,
    draft,
    now: NOW,
    personId: "p-ada",
    tokenHash: "hash-ada",
    ...overrides,
  });
}

describe("referral signup contact", () => {
  test("rejects an empty, invalid email, and invalid phone with a clear message", () => {
    expect(parseContact("  ")).toEqual({ ok: false, error: "Enter an email or phone number." });
    expect(parseContact("ada@")).toEqual({ ok: false, error: "Enter a valid email address." });
    expect(parseContact("555-0100")).toEqual({ ok: false, error: "Enter a valid phone number." });
    expect(parseContact("not-a-contact")).toEqual({
      ok: false,
      error: "Enter a valid email or phone number.",
    });
  });

  test("matches normalized email and phone, and not a shared name", () => {
    expect(parseContact("Jane@Example.com ")).toEqual(parseContact("jane@example.com"));
    expect(parseContact("(212) 555-0100")).toEqual({
      ok: true,
      contact: { kind: "phone", value: "+12125550100" },
    });
    expect(parseContact("+1 212 555 0100")).toEqual(parseContact("(212) 555-0100"));

    const byEmail = plan({ rawContact: "Jane@Example.com ", personId: "p-email" });
    const byPhone = plan({
      rawContact: "(212) 555-0101",
      personId: "p-phone",
      draft: { ...draft, name: "Ada Example" },
    });
    expect(byEmail.action).toBe("create");
    expect(byPhone.action).toBe("create");
    if (byEmail.action !== "create" || byPhone.action !== "create") return;
    expect(byEmail.person.name).toBe(byPhone.person.name);
    expect(byEmail.person.email).toBe("jane@example.com");
    expect(byPhone.person.phone).toBe("+12125550101");
    expect(byEmail.person.id).not.toBe(byPhone.person.id);

    const people = mergeCandidate(mergeCandidate([], byEmail.person), byPhone.person);
    expect(people).toHaveLength(2);
  });

  test("an existing contact is exists, and a new contact is available", () => {
    expect(
      lookupDecision({
        raw: "ada@example.com",
        actor: { email: "member@example.com" },
        profileExists: true,
      }),
    ).toEqual({ decision: "exists" });
    expect(
      lookupDecision({
        raw: "ada@example.com",
        actor: { email: "member@example.com" },
        profileExists: false,
      }),
    ).toEqual({ decision: "available" });
  });

  test("the same referrer and contact does not create a second profile", () => {
    const first = plan();
    const second = plan({ profileExists: true, referrerAlreadyLinked: true });
    expect(first.action).toBe("create");
    expect(second).toEqual({ action: "duplicate" });
    if (first.action !== "create") return;
    const once = mergeCandidate([], first.person);
    const twice = mergeCandidate(once, first.person);
    expect(twice).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  test("a member cannot refer their own email or phone", () => {
    expect(plan({ rawContact: "Member@Example.com " })).toEqual({
      action: "rejected",
      error: "You can't refer yourself.",
    });
    expect(plan({ rawContact: "212.555.0199" })).toEqual({
      action: "rejected",
      error: "You can't refer yourself.",
    });
    expect(
      lookupDecision({
        raw: "+1 (212) 555-0199",
        actor: { phone: "2125550199" },
        profileExists: false,
      }),
    ).toEqual({ decision: "self", error: "You can't refer yourself." });
  });
});

describe("referral signup profile", () => {
  test("requires a resume or LinkedIn or X, and stores the personal page and GitHub", () => {
    const { resumeStorageId: _resume, ...withoutResume } = draft;
    expect(normalizeProfile({ ...withoutResume, linkedin: "", x: "" })).toEqual({
      ok: false,
      error: "Add a resume or a LinkedIn or X profile.",
    });
    expect(plan({ draft: { ...withoutResume, linkedin: "", x: "" } })).toEqual({
      action: "rejected",
      error: "Add a resume or a LinkedIn or X profile.",
    });
    expect(read("apps/club/convex/referral.ts")).toContain("planSignup({");

    const linkedin = normalizeProfile({
      ...withoutResume,
      linkedin: "linkedin.com/in/ada-example",
      x: "",
    });
    expect(linkedin.ok).toBe(true);
    if (!linkedin.ok) return;
    expect(linkedin.profile.linkedin).toBe("https://linkedin.com/in/ada-example");
    expect(linkedin.profile.website).toBe("https://ada.example.com/");
    expect(linkedin.profile.github).toBe("https://github.com/ada-example");

    const withX = normalizeProfile({
      ...withoutResume,
      x: "https://x.com/ada_example",
    });
    expect(withX.ok).toBe(true);

    const noPage = plan({ draft: { ...draft, website: "" } });
    expect(noPage.action).toBe("create");
    if (noPage.action === "create") expect(noPage.person.website).toBeUndefined();
    expect(normalizeProfile({ ...draft, website: "javascript:alert(1)" })).toEqual({
      ok: false,
      error: "Enter a valid personal page URL.",
    });
    expect(normalizeProfile({ ...draft, github: "not a url" })).toEqual({
      ok: false,
      error: "Enter a valid GitHub URL.",
    });
  });

  test("a created candidate reaches the admin board through the same recompute", () => {
    const created = plan({
      draft: {
        ...draft,
        linkedin: "https://www.linkedin.com/in/ada-example",
        resumeUrl: "https://files.example.com/ada.pdf",
      },
    });
    expect(created.action).toBe("create");
    if (created.action !== "create") return;
    const state = reviveState({ ...emptyState(NOW), people: [created.person] });
    expect(state.people[0]?.email).toBe("ada@example.com");
    expect(state.people[0]?.github).toBe("https://github.com/ada-example");
    expect(state.people[0]?.website).toBe("https://ada.example.com/");
    expect(state.people[0]?.resumeStorageId).toBe("storage-resume");
    expect(state.referrals).toEqual([]);

    const view = computeView(state);
    const row = view.candidates.find((candidate) => candidate.name === "Ada Example");
    expect(row?.status).toBe("candidate");
    expect(row?.reviewStatus).toBe("new");
    const person = view.people.find((item) => item.name === "Ada Example");
    expect(person?.linkedin).toBe("https://www.linkedin.com/in/ada-example");
    expect(person?.resume).toBe("https://files.example.com/ada.pdf");
    expect(person?.phone).toBeNull();
  });
});

describe("referral status token", () => {
  test("a 256-bit token is stored as a hash and the page is one status line", async () => {
    const issued = await newStatusToken();
    expect(Buffer.from(issued.token, "base64url").length).toBe(32);
    expect(issued.hash).toBe(await hashStatusToken(issued.token));
    expect(issued.hash).toHaveLength(64);
    expect(issued.hash).not.toBe(issued.token);

    expect(await hashStatusToken("guessed-token")).not.toBe(issued.hash);
    const schema = read("apps/club/convex/schema.ts");
    const table = schema.slice(schema.indexOf("memberReferrals: defineTable"));
    expect(table).toContain("tokenHash: v.string()");
    expect(table).not.toMatch(/\btoken: v\./);
    expect(read("apps/club/app/status/[token]/page.tsx")).toContain(
      "robots: { index: false, follow: false }",
    );

    const line = statusLine(NOW);
    expect(line).toBe("Referred on September 27, 2026, under review");
    expect(line).not.toContain("example.com");
    expect(line).not.toContain("Ada");
  });
});

describe("referral signup surface", () => {
  test("the member nav stays the same and the pane is no longer the placeholder", () => {
    const chrome = read("apps/club/components/shell/MemberChrome.tsx");
    const home = read("apps/club/app/members/MemberHome.tsx");
    expect(MEMBER_NAV.map((item) => item.id)).toEqual([
      "forum",
      "referral",
      "members",
      "evaluations",
      "events",
    ]);
    expect(chrome).not.toContain("Referral form lands here.");
    expect(home).toContain("ReferralSignupConnected");
    expect(read("apps/club/components/referral/ReferralSignup.tsx")).toContain(
      "View current status",
    );
    expect(read("apps/club/app/members/referral/add/page.tsx")).toContain("Under construction");
    expect(read("apps/club/app/status/[token]/page.tsx")).toContain("Not found.");
    expect(read("apps/club/convex/referral.ts")).not.toContain("src/");
    expect(read("apps/club/lib/referralSignup.ts")).not.toContain("src/");
  });
});
