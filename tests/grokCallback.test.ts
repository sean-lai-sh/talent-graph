import { describe, expect, test } from "bun:test";
import {
  authorizeGrokCallback,
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
    expect(await checkGrokCallbackToken("master", "run-1", "post", "")).toBe(false);
    expect(await checkGrokCallbackToken("master", "run-1", "post", token.slice(0, 8))).toBe(false);
  });

  test("the route accepts only the token for its own purpose and run", async () => {
    const url = "https://x.convex.site/grok/company-research?runId=run-1";
    const post = await grokCallbackToken("master", "run-1", "post");
    const read = await grokCallbackToken("master", "run-1", "read");
    expect(await authorizeGrokCallback(url, post, "master", "post")).toEqual({
      ok: true,
      runId: "run-1",
    });
    expect(await authorizeGrokCallback(url, read, "master", "read")).toMatchObject({ ok: true });
    expect(await authorizeGrokCallback(url, post, "master", "read")).toMatchObject({ status: 401 });
    expect(await authorizeGrokCallback(url, read, "master", "post")).toMatchObject({ status: 401 });
    expect(
      await authorizeGrokCallback(url.replace("run-1", "run-2"), post, "master", "post"),
    ).toMatchObject({ status: 401 });
  });

  test("the route refuses a missing runId or an unset master key before any token check", async () => {
    const post = await grokCallbackToken("master", "run-1", "post");
    expect(
      await authorizeGrokCallback(
        "https://x.convex.site/grok/company-research",
        post,
        "master",
        "post",
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await authorizeGrokCallback(
        "https://x.convex.site/grok/company-research?runId=run-1",
        post,
        "",
        "post",
      ),
    ).toMatchObject({ status: 500 });
  });

  test("the callback URL carries the runId", () => {
    expect(grokCallbackUrl("https://x.convex.site", "a b")).toBe(
      "https://x.convex.site/grok/company-research?runId=a+b",
    );
  });
});
