"use client";

import { contactHref, type DirectoryMember } from "../../lib/memberDirectory.ts";
import { EmptyState } from "../ui/EmptyState.tsx";

/** Club directory: a member and the contacts on file. */
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
        <EmptyState title="No members yet.">
          Admitted people will list here with contacts.
        </EmptyState>
      ) : null}
      <ol className="member-directory-list">
        {members.map((member) => (
          <li key={member.id} className="member-card">
            <div className="member-card-name">{member.name}</div>
            {member.affiliation ? (
              <p className="member-card-affiliation">{member.affiliation}</p>
            ) : null}
            <ul className="member-card-contacts">
              {member.phone ? (
                <li>
                  <a href={`tel:${member.phone}`}>{member.phone}</a>
                </li>
              ) : null}
              {member.linkedin ? (
                <li>
                  <a href={contactHref(member.linkedin)} target="_blank" rel="noreferrer">
                    LinkedIn
                  </a>
                </li>
              ) : null}
              {!member.phone && !member.linkedin ? <li>No contact on file.</li> : null}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
