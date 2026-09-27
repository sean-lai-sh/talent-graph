"use client";

import { useConvex, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  type LookupDecision,
  lookupDecision,
  newStatusToken,
  normalizeProfile,
  type ProfileDraft,
  parseContact,
  planSignup,
} from "../../lib/referralSignup.ts";
import { Button, EmptyState, Field, Input } from "../ui/index.ts";

type Step =
  | { kind: "contact" }
  | { kind: "profile"; contact: string }
  | { kind: "done"; href: string };

type SubmitResult =
  | { status: "created"; token: string }
  | { status: "exists" }
  | { status: "duplicate" }
  | { status: "rejected"; error: string };

export function ReferralSignup({
  lookup,
  submit,
  uploadResume,
  onExists,
}: {
  lookup: (raw: string) => Promise<LookupDecision | null>;
  submit: (input: ProfileDraft & { contact: string }) => Promise<SubmitResult>;
  uploadResume: (file: File) => Promise<{ storageId: string } | { error: string }>;
  onExists: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "contact" });
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [x, setX] = useState("");
  const [website, setWebsite] = useState("");
  const [github, setGithub] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const alert = error ? (
    <p role="alert" className="text-xs text-danger">
      {error}
    </p>
  ) : null;

  if (step.kind === "done") {
    return (
      <div className="mx-auto max-w-md space-y-4 px-6 py-8">
        <EmptyState title="Referral submitted.">
          <a href={step.href} className="underline">
            View current status
          </a>
        </EmptyState>
        <p className="break-all text-xs text-muted">{step.href}</p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setStep({ kind: "contact" });
            setRaw("");
            setError(null);
            setName("");
            setAffiliation("");
            setLinkedin("");
            setX("");
            setWebsite("");
            setGithub("");
            setFile(null);
          }}
        >
          Refer someone else
        </Button>
      </div>
    );
  }

  if (step.kind === "profile") {
    return (
      <form
        className="mx-auto max-w-md space-y-3 px-6 py-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const draft: ProfileDraft = { name, affiliation, linkedin, x, website, github };
          const checked = normalizeProfile(draft, Boolean(file));
          if (!checked.ok) {
            setError(checked.error);
            return;
          }
          setBusy(true);
          setError(null);
          void (async () => {
            let resumeStorageId: string | undefined;
            if (file) {
              if (file.type && file.type !== "application/pdf") {
                setError("Resume must be a PDF.");
                setBusy(false);
                return;
              }
              const uploaded = await uploadResume(file);
              if ("error" in uploaded) {
                setError(uploaded.error);
                setBusy(false);
                return;
              }
              resumeStorageId = uploaded.storageId;
            }
            const result = await submit({
              name,
              affiliation,
              linkedin,
              x,
              website,
              github,
              contact: step.contact,
              ...(resumeStorageId ? { resumeStorageId } : {}),
            });
            setBusy(false);
            if (result.status === "rejected") {
              setError(result.error);
              return;
            }
            if (result.status === "exists") {
              onExists();
              return;
            }
            if (result.status === "duplicate") {
              setError("You already submitted this referral.");
              return;
            }
            setStep({
              kind: "done",
              href: new URL(`/status/${result.token}`, window.location.origin).toString(),
            });
          })().catch((caught: unknown) => {
            setBusy(false);
            setError(caught instanceof Error ? caught.message : "Could not submit this referral.");
          });
        }}
      >
        <Field label="Name">
          <Input required value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Email or phone">
          <Input value={step.contact} readOnly aria-readonly="true" />
        </Field>
        <Field label="Affiliation" hint="Context only. Never influences a number.">
          <Input value={affiliation} onChange={(event) => setAffiliation(event.target.value)} />
        </Field>
        <Field label="LinkedIn">
          <Input value={linkedin} onChange={(event) => setLinkedin(event.target.value)} />
        </Field>
        <Field label="X">
          <Input value={x} onChange={(event) => setX(event.target.value)} />
        </Field>
        <Field label="Personal page" hint="Optional.">
          <Input
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="https://example.com"
          />
        </Field>
        <Field label="GitHub" hint="Optional.">
          <Input value={github} onChange={(event) => setGithub(event.target.value)} />
        </Field>
        <Field label="Resume" hint="PDF up to 5 MB. Required if you do not add LinkedIn or X.">
          <Input
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        {alert}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setStep({ kind: "contact" });
              setError(null);
            }}
          >
            Back
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Submit referral
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="mx-auto max-w-md space-y-3 px-6 py-8"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        void lookup(raw)
          .then((result) => {
            if (!result) {
              setError("Sign in to continue.");
              return;
            }
            if (result.decision === "invalid" || result.decision === "self") {
              setError(result.error);
              return;
            }
            if (result.decision === "exists") {
              onExists();
              return;
            }
            const parsed = parseContact(raw);
            if (!parsed.ok) {
              setError(parsed.error);
              return;
            }
            setStep({ kind: "profile", contact: parsed.contact.value });
          })
          .catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : "Could not look up that contact.");
          })
          .finally(() => setBusy(false));
      }}
    >
      <Field label="Email or phone" hint="Lookup uses this contact, never a name.">
        <Input
          required
          autoComplete="off"
          value={raw}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setRaw(event.target.value)}
        />
      </Field>
      {alert}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy}>
          Continue
        </Button>
      </div>
    </form>
  );
}

export function ReferralSignupConnected() {
  const convex = useConvex();
  const router = useRouter();
  const generateUrl = useMutation(api.referral.generateResumeUploadUrl);
  const registerUpload = useMutation(api.referral.registerResumeUpload);
  const submitSignup = useMutation(api.referral.submitReferralSignup);

  return (
    <ReferralSignup
      onExists={() => router.push("/members/referral/add")}
      lookup={(raw) => convex.query(api.referral.lookupReferralContact, { contact: raw })}
      uploadResume={async (file) => {
        const issued = await generateUrl({});
        if ("error" in issued) return issued;
        const response = await fetch(issued.url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });
        if (!response.ok) return { error: "Resume upload failed." };
        const body = (await response.json()) as { storageId?: Id<"_storage"> };
        if (!body.storageId) return { error: "Resume upload failed." };
        const registered = await registerUpload({ storageId: body.storageId });
        if ("error" in registered) return registered;
        return { storageId: body.storageId };
      }}
      submit={(input) =>
        submitSignup({
          contact: input.contact,
          name: input.name,
          affiliation: input.affiliation,
          linkedin: input.linkedin,
          x: input.x,
          website: input.website,
          github: input.github,
          ...(input.resumeStorageId
            ? { resumeStorageId: input.resumeStorageId as Id<"_storage"> }
            : {}),
        })
      }
    />
  );
}

export function ReferralSignupPreview() {
  const router = useRouter();
  return (
    <ReferralSignup
      onExists={() => router.push("/members/referral/add")}
      lookup={async (raw) => {
        const parsed = parseContact(raw);
        const profileExists =
          parsed.ok &&
          (parsed.contact.value === "exists@example.com" ||
            parsed.contact.value === "+12125550100");
        return lookupDecision({
          raw,
          actor: { email: "preview@example.com" },
          profileExists,
        });
      }}
      uploadResume={async () => ({ storageId: "preview-resume" })}
      submit={async (input) => {
        const issued = await newStatusToken();
        const plan = planSignup({
          rawContact: input.contact,
          actor: { userId: "preview", email: "preview@example.com" },
          profileExists: false,
          referrerAlreadyLinked: false,
          draft: input,
          now: new Date().toISOString(),
          personId: "p-preview",
          tokenHash: issued.hash,
        });
        if (plan.action === "rejected") return { status: "rejected", error: plan.error };
        if (plan.action === "exists") return { status: "exists" };
        if (plan.action === "duplicate") return { status: "duplicate" };
        return { status: "created", token: issued.token };
      }}
    />
  );
}
