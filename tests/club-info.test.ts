import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHIPS_CONTACT, CHIPS_INFO_COPY } from "../apps/club/lib/chipsInfo.ts";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("chips /info", () => {
  test("landing underlines info and does not host Login", () => {
    const home = read("apps/club/app/page.tsx");
    const landing = read("apps/club/components/landing/LandingPage.tsx");
    expect(home).toContain("LandingPage");
    expect(landing).toContain('href="/info"');
    expect(landing).toContain("info-underline");
    expect(landing).toMatch(/>\s*info\s*</);
    expect(landing).not.toContain('href="/login"');
    expect(landing).not.toContain("Sign in");
    expect(landing).not.toContain("Login");
    expect(landing).not.toContain("Create account");
  });

  test("/info keeps the chip, copy, Login, and contact with no timer", () => {
    const page = read("apps/club/app/info/page.tsx");
    const info = read("apps/club/components/landing/InfoPage.tsx");
    const copy = read("apps/club/lib/chipsInfo.ts");
    expect(page).toContain("InfoPage");
    expect(page).not.toContain("loadClub()");
    expect(page).not.toContain("ClubBoard");
    expect(info).toContain("ChipViewer");
    expect(info).toContain("CHIPS_INFO_COPY");
    expect(info).toContain("CHIPS_CONTACT");
    expect(info).toContain('href="/login"');
    expect(info).toMatch(/>\s*Login\s*</);
    expect(info).toContain("mailto:");
    expect(info).toMatch(/>\s*contact\s*</);
    expect(info).toContain('href="/"');
    expect(info).toMatch(/>\s*home\s*</);
    expect(info).toContain("info-home");
    expect(info.indexOf("Login")).toBeLessThan(info.indexOf("info-copy"));
    expect(info.indexOf("contact")).toBeLessThan(info.indexOf("info-copy"));
    expect(info.indexOf("info-copy")).toBeLessThan(info.indexOf("info-home"));
    expect(copy).toContain(CHIPS_INFO_COPY);
    expect(copy).toContain(CHIPS_CONTACT);
    expect(info).not.toContain("Create account");
    expect(info).not.toContain("signUp");
    expect(CHIPS_CONTACT).toBe("chips@techatnyu.org");
  });

  test("/info corner stays thrive-small and the Next N is parked opposite", () => {
    const css = read("apps/club/app/landing.css");
    const config = read("apps/club/next.config.ts");
    expect(css).toMatch(/\.info-corner[\s\S]*left:\s*max\(24px/);
    expect(css).toMatch(/\.info-corner[\s\S]*bottom:\s*max\(24px/);
    expect(css).toMatch(/\.info-home \{[\s\S]*text-decoration:\s*underline/);
    expect(css).toMatch(/\.info-corner[\s\S]*pointer-events:\s*auto/);
    expect(config).toContain('position: "bottom-right"');
  });

  test("/info stays off the Convex persist path and has no middleware", () => {
    const page = read("apps/club/app/info/page.tsx");
    expect(page).not.toContain("auth-server");
    expect(page).not.toContain("isAuthenticated");
    expect(page).not.toContain("Authenticated");
    expect(page).not.toContain("PersistedClub");
    expect(page).not.toContain("@convex-dev/better-auth");
    expect(existsSync(join(root, "apps/club/middleware.ts"))).toBe(false);
  });
});
