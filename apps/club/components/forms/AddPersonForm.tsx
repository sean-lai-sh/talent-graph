"use client";

import { useState } from "react";
import type { AddPersonInput } from "../../lib/types.ts";
import { Button } from "../ui/Button.tsx";
import { Field, inputClass } from "../ui/Field.tsx";

export function AddPersonForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: AddPersonInput) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [resume, setResume] = useState("");
  const [affiliation, setAffiliation] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !phone.trim()) return;
        onSubmit({ name, phone, linkedin, resume, affiliation });
        setName("");
        setPhone("");
        setLinkedin("");
        setResume("");
        setAffiliation("");
      }}
    >
      <p className="text-sm font-medium">Add a person</p>
      <p className="text-[11px] text-muted">
        Name and phone are required; phone is the identifier that merges duplicate referrals.
        Referrals themselves arrive from the member referral page.
      </p>
      <Field label="Name">
        <input
          required
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Phone">
        <input
          required
          className={inputClass}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <Field label="LinkedIn">
        <input
          className={inputClass}
          value={linkedin}
          onChange={(e) => setLinkedin(e.target.value)}
        />
      </Field>
      <Field label="Resume">
        <input className={inputClass} value={resume} onChange={(e) => setResume(e.target.value)} />
      </Field>
      <Field label="Affiliation" hint="Context only. Never influences a number.">
        <input
          className={inputClass}
          value={affiliation}
          onChange={(e) => setAffiliation(e.target.value)}
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          Add
        </Button>
      </div>
    </form>
  );
}
