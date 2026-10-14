"use client";

import { useConvex, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Dimension } from "../../../../src/domain/types.ts";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { LadderPlacement, LadderStepView } from "../../lib/ladderPlacement.ts";
import {
  emptyQuestionDraft,
  type QuestionDraft,
  questionsContinueError,
  questionsToAnswers,
} from "../../lib/referralQuestions.ts";
import {
  type LookupDecision,
  lookupDecision,
  newStatusToken,
  normalizeProfile,
  type ProfileDraft,
  parseContact,
  planSignup,
  resumeFileError,
} from "../../lib/referralSignup.ts";
import type { MemberReferralAnswers } from "../../lib/types.ts";
import { Button, buttonClass, EmptyState, Field, Input } from "../ui/index.ts";
import { LadderStep } from "./LadderStep.tsx";
import type { PreviewBundle } from "./previewLadder.ts";
import { ReferralQuestions } from "./ReferralQuestions.tsx";

type Created = { personId: string; token: string; name: string; contact: string };

type Step =
  | { kind: "contact" }
  | { kind: "profile"; contact: string }
  | { kind: "questions"; created: Created }
  | { kind: "compare"; created: Created; ladder: Extract<LadderStepView, { skipped: false }> }
  | { kind: "done"; href: string; note?: string };

type SubmitResult =
  | { status: "created"; token: string; personId: string }
  | { status: "exists" }
  | { status: "duplicate" }
  | { status: "rejected"; error: string };

type SaveResult = { ok: true } | { error: string };
type LadderResult = LadderStepView | { error: string };

export function ReferralSignup({
  lookup,
  submit,
  uploadResume,
  onExists,
  saveAnswers,
  loadComparison,
  submitPlacement,
}: {
  lookup: (raw: string) => Promise<LookupDecision | null>;
  submit: (input: ProfileDraft & { contact: string }) => Promise<SubmitResult>;
  uploadResume: (file: File) => Promise<{ storageId: string } | { error: string }>;
  onExists: () => void;
  saveAnswers: (personId: string, answers: MemberReferralAnswers) => Promise<SaveResult>;
  loadComparison: (personId: string, name: string) => Promise<LadderResult>;
  submitPlacement: (
    personId: string,
    dimension: Dimension,
    placement: LadderPlacement,
  ) => Promise<SaveResult>;
}) {
  const [step, setStep] = useState<Step>({ kind: "contact" });
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<QuestionDraft>(emptyQuestionDraft);
  const [answersSaved, setAnswersSaved] = useState(false);
  const createdRef = useRef<Created | null>(null);
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
        {step.note ? <p className="text-sm text-secondary">{step.note}</p> : null}
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
            setDraft(emptyQuestionDraft());
            setAnswersSaved(false);
            createdRef.current = null;
          }}
        >
          Refer someone else
        </Button>
      </div>
    );
  }

  if (step.kind === "questions") {
    return (
      <ReferralQuestions
        name={step.created.name}
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          if (error) setError(null);
        }}
        locked={answersSaved}
        busy={busy}
        error={error}
        onBack={() => {
          setError(null);
          setStep({ kind: "profile", contact: step.created.contact });
        }}
        onContinue={() => {
          if (busy) return;
          const created = step.created;
          void (async () => {
            if (!answersSaved) {
              const problem = questionsContinueError(draft);
              if (problem) {
                setError(problem);
                return;
              }
              const answers = questionsToAnswers(draft);
              if (!answers) return;
              setBusy(true);
              setError(null);
              const saved = await saveAnswers(created.personId, answers);
              if ("error" in saved) {
                setError(saved.error);
                setBusy(false);
                return;
              }
              setAnswersSaved(true);
            }
            setBusy(true);
            setError(null);
            const ladder = await loadComparison(created.personId, created.name);
            setBusy(false);
            if ("error" in ladder) {
              setError(ladder.error);
              return;
            }
            if (ladder.skipped) {
              setStep({
                kind: "done",
                href: new URL(`/status/${created.token}`, window.location.origin).toString(),
                note: ladder.note,
              });
              return;
            }
            setStep({ kind: "compare", created, ladder });
          })().catch((caught: unknown) => {
            setBusy(false);
            setError(caught instanceof Error ? caught.message : "Could not save these answers.");
          });
        }}
      />
    );
  }

  if (step.kind === "compare") {
    const created = step.created;
    return (
      <LadderStep
        view={step.ladder}
        busy={busy}
        error={error}
        onBack={() => {
          setError(null);
          setStep({ kind: "questions", created });
        }}
        onPlace={async (dimension, placement) => {
          setBusy(true);
          setError(null);
          try {
            const result = await submitPlacement(created.personId, dimension, placement);
            setBusy(false);
            if ("error" in result) return result.error;
            return null;
          } catch (caught) {
            setBusy(false);
            return caught instanceof Error ? caught.message : "Could not record that placement.";
          }
        }}
        onFinished={() => {
          setStep({
            kind: "done",
            href: new URL(`/status/${created.token}`, window.location.origin).toString(),
          });
        }}
      />
    );
  }

  if (step.kind === "profile") {
    return (
      <form
        className="mx-auto max-w-md space-y-3 px-6 py-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const existing = createdRef.current;
          if (existing && existing.contact === step.contact) {
            setStep({
              kind: "questions",
              created: { ...existing, name: name.trim() || existing.name },
            });
            return;
          }
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
            const created = {
              personId: result.personId,
              token: result.token,
              name: name.trim(),
              contact: step.contact,
            };
            createdRef.current = created;
            setStep({ kind: "questions", created });
          })().catch((caught: unknown) => {
            setBusy(false);
            setError(caught instanceof Error ? caught.message : "Could not submit this referral.");
          });
        }}
      >
        <p className="text-xs tracking-wide text-muted">STEP 2 OF 4</p>
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
          <ResumePicker
            file={file}
            onChange={(picked) => {
              const problem = picked
                ? resumeFileError({
                    contentType: picked.type || "application/pdf",
                    size: picked.size,
                  })
                : null;
              setError(problem);
              setFile(problem ? null : picked);
            }}
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
            Continue
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
      <p className="text-xs tracking-wide text-muted">STEP 1 OF 4</p>
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

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Renders inside `Field`'s `<label>`, which opens the hidden file input on
 * click. The input stays focusable, so the visible button takes its focus ring.
 * The picked file lives in state; the input is cleared after each pick so
 * choosing the same file again still fires `change`.
 */
function ResumePicker({
  file,
  onChange,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <span className="flex min-h-8 items-center gap-3">
      <input
        type="file"
        accept="application/pdf"
        className="peer sr-only"
        onChange={(event) => {
          const picked = event.target.files?.[0] ?? null;
          event.target.value = "";
          if (picked) onChange(picked);
        }}
      />
      <span
        className={`${buttonClass("secondary")} cursor-pointer peer-focus-visible:shadow-[var(--focus-ring)]`}
      >
        {file ? "Replace" : "Choose PDF"}
      </span>
      {file ? (
        <>
          <span className="min-w-0 truncate text-sm text-ink" title={file.name}>
            {file.name}
          </span>
          <span className="shrink-0 text-xs text-muted tabular-nums">{fileSize(file.size)}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={(event) => {
              // Inside Field's <label>: never let this click reach the file input.
              event.preventDefault();
              onChange(null);
            }}
          >
            Remove
          </Button>
        </>
      ) : null}
    </span>
  );
}

export function ReferralSignupConnected() {
  const convex = useConvex();
  const router = useRouter();
  const generateUrl = useMutation(api.referral.generateResumeUploadUrl);
  const registerUpload = useMutation(api.referral.registerResumeUpload);
  const submitSignup = useMutation(api.referral.submitReferralSignup);
  const saveMemberAnswers = useMutation(api.referral.saveMemberReferralAnswers);
  const place = useMutation(api.comparisonStep.submitLadderPlacement);

  return (
    <ReferralSignup
      onExists={() => router.push("/members/referral/add")}
      saveAnswers={async (personId, answers) => {
        const result = await saveMemberAnswers({
          personId,
          answers: { ...answers, stakes: [...answers.stakes] },
        });
        if (result && "error" in result && result.error) return { error: result.error };
        return { ok: true };
      }}
      loadComparison={async (personId) => {
        const result = await convex.query(api.comparisonStep.getComparisonStep, { personId });
        if (!result.ok) return { error: result.error };
        return result.view;
      }}
      submitPlacement={async (personId, dimension, placement) => {
        const result = await place({
          personId,
          dimension,
          placement:
            placement.kind === "cant_place"
              ? { kind: "cant_place" }
              : { kind: "order", order: [...placement.order] },
        });
        if (result && "error" in result && result.error) return { error: result.error };
        return { ok: true };
      }}
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
  const preview = useRef<PreviewBundle | null>(null);
  return (
    <ReferralSignup
      onExists={() => router.push("/members/referral/add")}
      saveAnswers={async () => ({ ok: true })}
      loadComparison={async (personId, applicantName) => {
        const { startPreview } = await import("./previewLadder.ts");
        const started = startPreview(personId, applicantName);
        if ("error" in started) return started;
        preview.current = started;
        return started.view;
      }}
      submitPlacement={async (_personId, dimension, placement) => {
        const { placePreview } = await import("./previewLadder.ts");
        const bundle = preview.current;
        if (!bundle) return { error: "Start the comparison step first." };
        const result = placePreview(bundle, dimension, placement);
        if (!result.ok) return { error: result.error };
        preview.current = result.bundle;
        return { ok: true };
      }}
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
        return { status: "created", token: issued.token, personId: "p-preview" };
      }}
    />
  );
}
