export type DirectoryMember = {
  id: string;
  name: string;
  affiliation?: string;
  phone?: string;
  linkedin?: string;
};

type DirectorySource = {
  id: string;
  name: string;
  status: string;
  affiliation?: string;
  phone?: string;
  linkedin?: string;
};

/** People marked member, with contact fields only. Candidates stay off this list. */
export function toDirectoryMembers(people: readonly DirectorySource[]): DirectoryMember[] {
  return people
    .filter((person) => person.status === "member")
    .map((person) => {
      const row: DirectoryMember = { id: person.id, name: person.name };
      if (person.affiliation?.trim()) row.affiliation = person.affiliation.trim();
      if (person.phone?.trim()) row.phone = person.phone.trim();
      if (person.linkedin?.trim()) row.linkedin = person.linkedin.trim();
      return row;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function contactHref(value: string): string {
  return value.startsWith("http") ? value : `https://${value}`;
}
