import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily("evidence snapshots", { hourUTC: 9, minuteUTC: 0 }, internal.evidence.daily, {});

export default crons;
