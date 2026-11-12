import { redirect } from "next/navigation";
import { Banner, Shell } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { fmtDateTime } from "@/lib/util";
import { outbox } from "@/lib/verify";

export default async function OutboxPage() {
  const user = await requireUser();
  if (!hasRole(user, ["SUPER_ADMIN", "PURCHASING", "PCH_DIV_HEAD"])) redirect("/ncf");
  const rows = await outbox();
  return (
    <Shell>
      <h1 className="text-3xl font-bold">Email outbox</h1>
      <Banner kind="info">
        SMTP is not connected in this MVP. Every email the system would send is queued here with its full text, so the flow can be tested.
      </Banner>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <details key={r.id} className="card p-4">
            <summary className="flex cursor-pointer flex-wrap justify-between gap-2">
              <span className="font-semibold">{r.payload.subject}</span>
              <span className="text-sm text-slate-600">{r.event} · to {r.recipient} · {fmtDateTime(r.created)} · {r.status}</span>
            </summary>
            <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{r.payload.body}</pre>
          </details>
        ))}
        {rows.length === 0 && <p className="text-slate-600">No emails yet.</p>}
      </div>
    </Shell>
  );
}
