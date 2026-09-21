"use client";

import { type FormEvent, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Field } from "../ui/Field.tsx";
import { Textarea } from "../ui/Input.tsx";

export type ForumPost = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

/** Feed: write a note, it lands on top. No threads. */
export function Forum({
  posts,
  busy = false,
  loading = false,
  onPost,
}: {
  posts: ForumPost[];
  busy?: boolean;
  loading?: boolean;
  onPost: (body: string) => void;
}) {
  const [body, setBody] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = body.trim();
    if (!next || busy) return;
    onPost(next);
    setBody("");
  };

  return (
    <div className="forum">
      <form className="forum-compose" onSubmit={submit}>
        <Field label="New post">
          <Textarea
            name="body"
            rows={4}
            value={body}
            placeholder="Write something…"
            disabled={busy}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button type="submit" variant="primary" disabled={busy || body.trim().length === 0}>
            {busy ? "Posting…" : "Post"}
          </Button>
        </div>
      </form>
      {loading ? <p className="mt-6 text-sm text-muted">Loading posts…</p> : null}
      {!loading && posts.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Nothing here yet.">Post the first note.</EmptyState>
        </div>
      ) : null}
      <ol className="forum-list">
        {posts.map((post) => (
          <li key={post.id} className="forum-post">
            <div className="forum-post-meta">
              <span className="font-medium text-ink">{post.authorName}</span>
              <time dateTime={post.createdAt} className="text-muted">
                {formatPostedAt(post.createdAt)}
              </time>
            </div>
            <p className="forum-post-body">{post.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function formatPostedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
