import { runReminders } from "@/lib/supplier";

// Called once a day by a scheduler (cron, Windows Task Scheduler) with the job secret.
export async function POST(req: Request) {
  const secret = process.env.JOB_SECRET;
  if (!secret || req.headers.get("x-job-secret") !== secret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const sent = await runReminders();
  return Response.json({ sent });
}
