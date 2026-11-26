import { Bell } from "lucide-react";
import { markAllReadAction, openNoteAction } from "@/app/(app)/shell-actions";
import { EmptyState, PageHead, Shell } from "@/components/ui";
import { requireUser } from "@/platform/auth";
import { inbox } from "@/platform/notifications";
import { fmtDateTime } from "@/platform/util";

/** All of the person's notifications (the phone bar's Alerts, and "All notifications" on Home). */
export default async function NotificationsPage() {
  const user = await requireUser();
  const { items, unread } = await inbox(user, 100);
  return (
    <Shell>
      <PageHead title="Notifications" crumbs={[{ label: "Workspace" }, { label: "Notifications" }]}
        sub={unread ? `${unread} unread` : "All read"}>
        {unread > 0 && <form action={markAllReadAction}><button className="btn">Mark all as read</button></form>}
      </PageHead>
      <section className="card overflow-hidden p-0">
        {items.length === 0 ? <EmptyState icon={Bell} title="Nothing yet">You will see here when an NCF needs you.</EmptyState> : (
          <ul className="divide-y divide-border">
            {items.map((n) => (
              <li key={n.id}>
                <form action={openNoteAction}>
                  <input type="hidden" name="id" value={n.id} />
                  <button className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/50 ${n.read ? "" : "bg-tint/40"}`}>
                    <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-muted" : "bg-primary"}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] ${n.read ? "text-foreground/80" : "font-semibold text-foreground"}`}>{n.title}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="num">{fmtDateTime(n.at)}</span>
                        {n.todo === true && <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 font-medium text-amber-800">To do</span>}
                        {n.todo === false && <span>Done</span>}
                      </span>
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
