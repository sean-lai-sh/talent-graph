export type DirectoryMember = {
  id: string;
  name: string;
  email: string;
  linkedin?: string;
};

type DirectorySource = {
  id: string;
  name: string;
  status: string;
  email?: string;
  linkedin?: string;
};

const EMAIL_DOMAIN = "techatnyu.org";

/** Stable club email when a person row does not yet carry one. */
export function directoryEmail(name: string, email?: string): string {
  const given = email?.trim().toLowerCase();
  if (given) return given;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
  return `${slug || "member"}@${EMAIL_DOMAIN}`;
}

/** People marked member. Table fields only: name, LinkedIn, email. */
export function toDirectoryMembers(people: readonly DirectorySource[]): DirectoryMember[] {
  return people
    .filter((person) => person.status === "member")
    .map((person) => {
      const row: DirectoryMember = {
        id: person.id,
        name: person.name,
        email: directoryEmail(person.name, person.email),
      };
      if (person.linkedin?.trim()) row.linkedin = person.linkedin.trim();
      return row;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function contactHref(value: string): string {
  return value.startsWith("http") ? value : `https://${value}`;
}
