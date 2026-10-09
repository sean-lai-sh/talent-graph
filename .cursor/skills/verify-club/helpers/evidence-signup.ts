// Local-backend only: sign in as the seeded referrer ada.quill@example.test, upload a
// generated resume PDF, and refer a new candidate with it. Prints the new person id.
//   bun evidence-signup.ts <candidate contact> <pdf out path>
// Needs NEXT_PUBLIC_CONVEX_URL, NEXT_PUBLIC_CONVEX_SITE_URL (both loopback), SITE_URL (the
// local deployment's SITE_URL, sent as Origin) and SEED_DEV_PASSWORD. Never prints the password.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const { ConvexHttpClient } = await import(
  join(import.meta.dir, "../../../../apps/club/node_modules/convex/dist/esm/browser/index.js")
);

const cloud = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
const origin = process.env.SITE_URL ?? "http://127.0.0.1:43173";
for (const url of [cloud, site]) {
  const host = URL.canParse(url) ? new URL(url).hostname : "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`evidence-signup refuses a non-local Convex URL (${url || "unset"})`);
  }
}
const password = process.env.SEED_DEV_PASSWORD;
if (!password) throw new Error("Set SEED_DEV_PASSWORD.");
const [, , contact, pdfOut] = process.argv;
if (!contact || !pdfOut) throw new Error("usage: evidence-signup.ts <contact> <pdf out path>");

// Every bullet run sits under a dated header, so this resume parses without the labelling pass.
const RESUME = [
  "Software Engineer Intern at Acme Corp (Jun 2024 - Aug 2024)",
  "- Built an ambitious payment pipeline serving 10,000 daily users",
  "- Cut latency in the checkout service by 40 percent",
  "Research Assistant at Lab Z (Jan 2024 - Mar 2024)",
  "- Designed an ambitious experiment on protein folding",
];

function pdf(lines: string[]): Uint8Array {
  const pdfString = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((line) => `(${pdfString(line)}) Tj T*`);
  const stream = ["BT", "/F1 11 Tf", "14 TL", "50 750 Td", ...text, "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const signIn = await fetch(`${site}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ email: "ada.quill@example.test", password }),
});
if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status}`);
const cookie = signIn.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const tokenResponse = await fetch(`${site}/api/auth/convex/token`, {
  headers: { Cookie: cookie, Origin: origin },
});
if (!tokenResponse.ok) throw new Error(`convex token failed: ${tokenResponse.status}`);
const { token } = (await tokenResponse.json()) as { token: string };

const client = new ConvexHttpClient(cloud);
client.setAuth(token);
const upload = await client.mutation("referral:generateResumeUploadUrl", {});
if (!upload.url) throw new Error(`upload url: ${upload.error}`);
const bytes = pdf(RESUME);
writeFileSync(pdfOut, bytes);
const posted = await fetch(upload.url, {
  method: "POST",
  headers: { "Content-Type": "application/pdf" },
  body: bytes,
});
const { storageId } = (await posted.json()) as { storageId: string };
const registered = await client.mutation("referral:registerResumeUpload", { storageId });
if (!registered.ok) throw new Error(`register upload: ${registered.error}`);
const result = await client.mutation("referral:submitReferralSignup", {
  contact,
  name: "Proof Candidate",
  resumeStorageId: storageId,
});
if (result.status !== "created") throw new Error(`signup: ${JSON.stringify(result)}`);
console.log(result.personId);
