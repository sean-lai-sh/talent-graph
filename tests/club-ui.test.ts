import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const PRIMITIVES = [
  "Avatar",
  "Badge",
  "Button",
  "EmptyState",
  "Field",
  "Input",
  "Kbd",
  "Mark",
  "Num",
  "Popover",
  "Section",
  "Segmented",
  "Select",
  "Sheet",
  "Textarea",
] as const;

describe("SEA-25 shared Club UI", () => {
  test("README documents each export and the token names", () => {
    const readme = read("apps/club/components/ui/README.md");
    const barrel = read("apps/club/components/ui/index.ts");
    for (const name of PRIMITIVES) {
      expect(readme).toContain(name);
      expect(barrel).toContain(name);
    }
    expect(readme).toContain("ButtonVariant");
    expect(readme).toContain("ButtonSize");
    expect(readme).toContain("inputClass");
    for (const token of ["canvas", "surface", "line", "ink", "accent", "danger"]) {
      expect(readme).toContain(`\`${token}`);
    }
    expect(readme).toContain("globals.css");
    expect(readme).toContain(".admit");
    expect(readme).toContain(".panel-search");
  });

  test("example forms use Input, Textarea, and Select instead of inputClass", () => {
    const add = read("apps/club/components/forms/AddPersonForm.tsx");
    const request = read("apps/club/components/forms/RequestFeedbackForm.tsx");
    const record = read("apps/club/components/forms/RecordFeedbackForm.tsx");
    expect(add).toContain("<Input");
    expect(add).not.toContain("inputClass");
    expect(request).toContain("<Textarea");
    expect(request).not.toContain("inputClass");
    expect(record).toContain("<Select");
    expect(record).toContain("<Textarea");
    expect(record).not.toContain("inputClass");
  });

  test("login card uses Button, Field, and Input instead of one-off field chrome", () => {
    const card = read("apps/club/app/login/LoginCard.tsx");
    const shell = read("apps/club/app/club/ClubShell.tsx");
    const persisted = read("apps/club/app/club/PersistedClub.tsx");
    expect(card).toContain("<Field");
    expect(card).toContain("<Input");
    expect(card).toContain("<Button");
    expect(card).not.toContain("rounded border border-line bg-canvas");
    expect(card).not.toContain("bg-ink px-3 py-1.5 text-sm text-canvas");
    expect(shell).toContain("<Button");
    expect(shell).not.toContain("<Field");
    expect(persisted).toContain("<Button");
    expect(persisted).not.toContain("rounded-md border border-line px-3 py-1.5");
  });
});
