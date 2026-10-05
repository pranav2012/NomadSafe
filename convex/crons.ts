import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly("refresh globe clouds", { minuteUTC: 7 }, internal.weather.refreshGlobeClouds, {});
crons.daily("prune weather cache", { hourUTC: 3, minuteUTC: 30 }, internal.weather.pruneCache, {});

export default crons;
