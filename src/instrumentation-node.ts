// Background jobs on the Node.js server. Each minute, a job that is due runs under a lease (src/platform/jobs.ts), so
// several servers or a restart never run it twice at once.
import { pullSapMrreg, SAP_PULL_JOB, sapPullConfigured, sapPullDue } from "@/modules/ncf/sap-feed";
import { lastRun, withLease } from "@/platform/jobs";

declare global {
  var __vmsJobs: NodeJS.Timeout | undefined;
}

async function tick() {
  if (!sapPullConfigured()) return;
  try {
    if (!sapPullDue(new Date(), await lastRun(SAP_PULL_JOB))) return;
    await withLease(SAP_PULL_JOB, 15, async () => {
      const r = await pullSapMrreg(null);
      console.log(`[jobs] SAP pull: ${r.rows} rows, ${r.mrregsInserted} new / ${r.mrregsUpdated} updated receipts, ${r.skipped} skipped`);
    });
  } catch (e) {
    console.error("[jobs] SAP pull failed:", (e as Error).message);
  }
}

// Off in tests and when the feed is not configured; SAP_FEED_SCHEDULE=off turns the schedule off on a server.
if (!globalThis.__vmsJobs && process.env.NODE_ENV === "production" && process.env.SAP_FEED_SCHEDULE !== "off") {
  globalThis.__vmsJobs = setInterval(() => void tick(), 60_000);
  globalThis.__vmsJobs.unref();
}
