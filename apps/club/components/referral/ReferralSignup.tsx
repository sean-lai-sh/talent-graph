"use client";

import { useConvex, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ReferralSignup } from "./ReferralSignupForm.tsx";

/** Signed-in member signup. Talks to Convex. The public demo does not import this module. */
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
