/**
 * Resume PDF → claim lines (SEA-81).
 *
 * `preprocessJobClaims` reads resume form: a job header (`Title at Org
 * (dates)`, see `parseHeader`) followed by bullet lines (`isBullet`). The PDF's
 * own text is used as is when it already reads that way. Only when no job
 * header parses does a Jev pass label each line (title, organization, dates,
 * bullet, other) so the lines can be rebuilt into that form. The raw text is
 * always kept next to the result.
 */

import {
  choice,
  type Questions,
  type SystemOneRequest,
  type SystemOneResult,
} from "@typesafe-ai/sdk";
import { extractText, getDocumentProxy } from "unpdf";
import {
  isBullet,
  type JobClaimLine,
  parseHeader,
} from "../../../../src/longitudinal/claimPreprocess.ts";

/** Bullet glyphs PDFs use that `isBullet` does not read; they become `- `. */
const BULLET_GLYPHS = /^\s*[●◦▪▫■□○◆◇►▸‣⁃–—·∙]\s*/u;

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** The text's non-empty lines, with bullet glyphs written as `- `. No model involved. */
export function rawResumeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .map((line) => (BULLET_GLYPHS.test(line) ? `- ${line.replace(BULLET_GLYPHS, "")}` : line));
}

/** True when at least one line is a job header `parseHeader` reads. */
export function parsesAsResume(lines: readonly string[]): boolean {
  return lines.some((line) => !isBullet(line) && parseHeader(line) !== null);
}

/**
 * The claim lines Jev scores: job headers and bullets. Any other line (a name,
 * a section heading, a skills list) is blanked rather than dropped, because a
 * blank line ends the open job, so bullets after a "Projects" heading are not
 * read as the previous job's.
 */
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

/** The client surface the labelling pass calls. `createJevClient()` satisfies it. */
export interface ResumeLineClient {
  systemOne<Q extends Questions>(
    request: SystemOneRequest<Q>,
  ): { withResponse(): Promise<{ data: SystemOneResult<Q> }> };
}

const LABEL_BATCH = 40;

/** One Jev request per batch of lines: a choice question per line. */
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

/**
 * Rebuild labelled lines into resume form. A job header is emitted once its
 * title and organization are both known and a bullet follows; a header that
 * `parseHeader` would not read is left out, so its bullets stay free lines.
 */
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
    if (role === "other") {
      return;
    }
    if (headerOpen) {
      // A new job starts; the blank line closes the previous one.
      out.push("");
      headerOpen = false;
      reset();
    }
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
