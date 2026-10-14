import { UNKNOWN_VALUE } from "../../lib/copy.ts";
import { exampleDirectory } from "../../lib/exampleDemo.ts";
import { contactHref } from "../../lib/memberDirectory.ts";

/** Fixture directory for `/demo`. Phone is the fictional number. No score. */
export function DemoMemberList() {
  const members = exampleDirectory();
  return (
    <div className="member-directory">
      <table className="member-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">LinkedIn</th>
            <th scope="col">Email</th>
            <th scope="col">Phone</th>
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
                  UNKNOWN_VALUE
                )}
              </td>
              <td>
                <a href={`mailto:${member.email}`}>{member.email}</a>
              </td>
              <td>{member.phone?.trim() ? member.phone : UNKNOWN_VALUE}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
