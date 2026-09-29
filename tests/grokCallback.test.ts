import { describe, expect, test } from "bun:test";
import {
  checkGrokCallbackToken,
  grokCallbackToken,
  grokCallbackUrl,
} from "../apps/club/lib/longitudinal/grokCallback.ts";

describe("Grok callback tokens", () => {
  test("a run's post token is accepted for that run only", async () => {
    const token = await grokCallbackToken("master", "run-1", "post");
    expect(await checkGrokCallbackToken("master", "run-1", "post", token)).toBe(true);
    expect(await checkGrokCallbackToken("master", "run-2", "post", token)).toBe(false);
    expect(await checkGrokCallbackToken("other", "run-1", "post", token)).toBe(false);
  });

  test("a post token cannot read and a read token cannot post", async () => {
    const post = await grokCallbackToken("master", "run-1", "post");
    const read = await grokCallbackToken("master", "run-1", "read");
    expect(await checkGrokCallbackToken("master", "run-1", "read", post)).toBe(false);
    expect(await checkGrokCallbackToken("master", "run-1", "post", read)).toBe(false);
  });

  test("a missing token or master key is rejected", async () => {
    const token = await grokCallbackToken("master", "run-1", "post");
    expect(await checkGrokCallbackToken("", "run-1", "post", token)).toBe(false);
    expect(await checkGrokCallbackToken("master", "run-1", "post", null)).toBe(false);
  });

  test("the callback URL carries the runId", () => {
    expect(grokCallbackUrl("https://x.convex.site", "a b")).toBe(
      "https://x.convex.site/grok/company-research?runId=a+b",
    );
  });
});
