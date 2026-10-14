import {
  choice,
  type Questions,
  type SystemOneRequest,
  type SystemOneResult,
} from "@typesafe-ai/sdk";
import {
  isBullet,
  type JobClaimLine,
  parseHeader,
} from "../../../../src/longitudinal/claimPreprocess.ts";

const BULLET_GLYPHS = /^\s*[●◦▪▫■□○◆◇►▸‣⁃–—·∙]\s*/u;

export function rawResumeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .map((line) => (BULLET_GLYPHS.test(line) ? `- ${line.replace(BULLET_GLYPHS, "")}` : line));
}

// Every run of bullets must sit directly under a parseable header. One parseable
// job is not enough: a mixed-format resume would hang its other jobs' bullets on it.
export function parsesAsResume(lines: readonly string[]): boolean {
  let headers = 0;
  let previous: string | null = null;
  for (const line of lines) {
    if (isBullet(line)) {
      if (previous === null) return false;
      continue;
    }
    previous = parseHeader(line) === null ? null : line;
    if (previous !== null) headers += 1;
  }
  return headers > 0;
}

export function claimLines(lines: readonly string[], publishedAt: string): JobClaimLine[] {
  return lines.map((line, index) => ({
    id: `L${index}`,
    statement: isBullet(line) || parseHeader(line) !== null ? line : "",
    publishedAt,
  }));
}

export const LINE_ROLES = {
  job_title: "A job or position title alone, such as 'Software Engineer Intern'.",
  organization: "A company, lab, school or organization name alone, possibly with a location.",
  dates: "A date or date range alone, such as 'Jun 2024 - Aug 2024'.",
  title_and_dates: "A job title followed or preceded by its date range on the same line.",
  organization_and_dates: "An organization name with its date range on the same line.",
  bullet: "A sentence describing work done or a result, usually under a job.",
  other: "Anything else: a name, contact details, a section heading, skills, coursework.",
} as const;

export type LineRole = keyof typeof LINE_ROLES;

export interface ResumeLineClient {
  systemOne<Q extends Questions>(
    request: SystemOneRequest<Q>,
  ): { withResponse(): Promise<{ data: SystemOneResult<Q> }> };
}

const LABEL_BATCH = 40;

export async function labelResumeLines(
  lines: readonly string[],
  client: ResumeLineClient,
): Promise<LineRole[]> {
  const roles: LineRole[] = [];
  for (let start = 0; start < lines.length; start += LABEL_BATCH) {
    const batch = lines.slice(start, start + LABEL_BATCH);
    const questions: Record<string, ReturnType<typeof choice<typeof LINE_ROLES>>> = {};
    batch.forEach((_line, offset) => {
      questions[`line_${offset}`] = choice(
        `What is line ${offset} of the resume excerpt in the state?`,
        LINE_ROLES,
      );
    });
    const { data } = await client
      .systemOne({
        state: { lines: batch.map((line, offset) => `${offset}: ${line}`) },
        questions,
      })
      .withResponse();
    batch.forEach((_line, offset) => {
      const answer = data.answers[`line_${offset}`] as { choice?: string } | undefined;
      const role = answer?.choice;
      roles.push(role !== undefined && role in LINE_ROLES ? (role as LineRole) : "other");
    });
  }
  return roles;
}

const MONTH = String.raw`(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}`;
const POINT = String.raw`(?:${MONTH}|\d{1,2}\/\d{4}|\d{4})`;
const RANGE = new RegExp(
  String.raw`${POINT}\s*(?:–|—|-|to)\s*(?:${POINT}|Present|Current)|${POINT}`,
  "i",
);

function splitDates(text: string): { rest: string; dates: string | null } {
  const match = RANGE.exec(text);
  if (!match) return { rest: text, dates: null };
  const rest = (text.slice(0, match.index) + text.slice(match.index + match[0].length))
    .replace(/[\s|,·•–—-]+$/u, "")
    .replace(/^[\s|,·•–—-]+/u, "")
    .trim();
  return { rest, dates: match[0].replace(/\s*(–|—|to)\s*/i, " - ").trim() };
}

export function rebuildResumeLines(lines: readonly string[], roles: readonly LineRole[]): string[] {
  const out: string[] = [];
  let pending: { title: string | null; org: string | null; dates: string | null } = {
    title: null,
    org: null,
    dates: null,
  };
  let headerOpen = false;
  const reset = () => {
    pending = { title: null, org: null, dates: null };
  };
  lines.forEach((line, index) => {
    const role = roles[index] ?? "other";
    if (role === "bullet") {
      if (!headerOpen && pending.title && pending.org) {
        const header = pending.dates
          ? `${pending.title} at ${pending.org} (${pending.dates})`
          : `${pending.title} at ${pending.org}`;
        if (parseHeader(header) !== null) {
          out.push(header);
          headerOpen = true;
        }
        reset();
      }
      out.push(`- ${line.replace(/^\s*[-*•]\s*/, "")}`);
      return;
    }
    if (headerOpen) {
      out.push("");
      headerOpen = false;
      reset();
    }
    if (role === "other") return;
    if (role === "job_title") pending.title = line;
    else if (role === "organization") pending.org = line;
    else if (role === "dates") pending.dates = splitDates(line).dates ?? line;
    else {
      const { rest, dates } = splitDates(line);
      if (role === "title_and_dates") pending.title = rest;
      else pending.org = rest;
      if (dates) pending.dates = dates;
    }
  });
  return out;
}
