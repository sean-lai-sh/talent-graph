"use client";

import { contactHref, type DirectoryMember } from "../../lib/memberDirectory.ts";
import { EmptyState } from "../ui/EmptyState.tsx";

/** Simple directory table: name, LinkedIn, email. */
export function MemberList({
  members,
  loading = false,
}: {
  members: DirectoryMember[];
  loading?: boolean;
}) {
  return (
    <div className="member-directory">
      {loading ? <p className="text-sm text-muted">Loading members…</p> : null}
      {!loading && members.length === 0 ? (
        <EmptyState title="No members yet.">Admitted people will list here.</EmptyState>
      ) : null}
      {!loading && members.length > 0 ? (
        <table className="member-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">LinkedIn</th>
              <th scope="col">Email</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <th scope="row">{member.name}</th>
                <td>
                  {member.linkedin ? (
                    <a href={contactHref(member.linkedin)} target="_blank" rel="noreferrer">
                      LinkedIn
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <a href={`mailto:${member.email}`}>{member.email}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
