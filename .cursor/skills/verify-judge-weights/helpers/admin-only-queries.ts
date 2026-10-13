/**
 * Public Convex queries a member must not receive.
 *
 * A query is admin-only when its `module:name` ref is listed here, or when
 * the export is annotated `verify-judge-weights: admin-only`. Anything else
 * has to be visibly member-facing. If it is not, the run fails and names it.
 *
 * Documented in SKILL.md.
 */
export const ADMIN_ONLY_QUERIES = ["club:getBoard", "club:getOrganization"] as const;
