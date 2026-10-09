import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly("refresh globe clouds", { minuteUTC: 7 }, internal.weather.refreshGlobeClouds, {});
crons.daily("prune weather cache", { hourUTC: 3, minuteUTC: 30 }, internal.weather.pruneCache, {});
crons.daily("prune exchange rates", { hourUTC: 3, minuteUTC: 45 }, internal.rates.pruneRates, {});
crons.hourly("prune expired plan grants", { minuteUTC: 17 }, internal.billing.pruneExpiredGrants, {});

export default crons;
