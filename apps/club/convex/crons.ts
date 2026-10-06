import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Evidence-only snapshots (SEA-81): schedule the standard check for every
// candidate whose next snapshot is due.
crons.daily("evidence snapshots", { hourUTC: 9, minuteUTC: 0 }, internal.evidence.daily, {});

export default crons;
