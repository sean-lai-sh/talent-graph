import type { ProjectConfig } from "./parse.ts";

export function renderConfigModule(config: ProjectConfig): string {
  return `// Generated from config.yml by scripts/gen-config.ts. Do not edit by hand.
// After editing config.yml, run \`bun run config:gen\`; \`bun run check:config-gen\` fails in CI if this file is stale.
import { deepFreeze } from "../models/freeze.ts";
import type { ProjectConfig } from "./parse.ts";

export const PROJECT_CONFIG: ProjectConfig = deepFreeze<ProjectConfig>(${JSON.stringify(config, null, 2)});
`;
}
