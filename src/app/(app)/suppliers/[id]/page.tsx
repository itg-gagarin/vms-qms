import { Pencil, Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Submit } from "@/components/action-form";
import { ClickableRow } from "@/components/clickable-row";
import { Modal } from "@/components/modal";
import { ModalForm } from "@/components/modal-form";
import { EmptyState, PageHead, Section, Shell, StatePill, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { getSupplier, SUPPLIER_ROLES } from "@/lib/suppliers";
import { AppError, fmtDate } from "@/lib/util";
import { renameSupplierAction, saveContactAction } from "../actions";

type Contact = Awaited<ReturnType<typeof getSupplier>>["contacts"][number];

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, SUPPLIER_ROLES)) redirect("/ncf");
  const { id } = await params;
  let s;
  try {
    s = await getSupplier(user, Number(id));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const st = s.stats;
  const tiles: [string, string, string?][] = [
    ["NCFs", String(st.ncfs), "submitted, not void"],
    ["Replied", String(st.replied)],
    ["Waiting now", String(st.waiting), st.waiting ? "sent, no reply yet" : undefined],
    ["Average reply", st.avg_wd === null ? "–" : `${st.avg_wd} wd`, "working days"],
    ["Slowest reply", st.max_wd === null ? "–" : `${st.max_wd} wd`],
    ["Goods receipts", st.receipts.toLocaleString("id-ID"), "from SAP"],
  ];

  return (
    <Shell>
      <PageHead title={s.name} crumbs={[{ label: "Purchasing" }, { label: "Supplier Master", href: "/suppliers" }, { label: s.code }]}
        sub={<><span className="num">{s.code}</span> · SAP vendor</>}>
        <StatePill tone={s.status === "BLOCKED" || s.status === "REMOVED" ? "red" : s.status === "WARNED" ? "amber" : "emerald"}>
          {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
        </StatePill>
        <Modal label="Rename" title="Rename supplier" icon={<Pencil size={15} aria-hidden="true" />}
          description="The vendor code stays: it is the key SAP uses.">
          <ModalForm action={renameSupplierAction} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={s.id} />
            <div>
              <label htmlFor="rename" className="label">Supplier name</label>
              <input id="rename" name="name" required minLength={2} defaultValue={s.name} className="input" />
            </div>
            <div className="flex justify-end"><Submit className="btn btn-commit">Save name</Submit></div>
          </ModalForm>
        </Modal>
      </PageHead>

      <section aria-label="Responsiveness" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([k, v, sub]) => (
          <div key={k} className="rounded-md border border-hairline border-t-[3px] border-t-advance bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{k}</div>
            <div className="num mt-1 text-[22px] font-semibold leading-none text-ink">{v}</div>
            {sub && <div className="mt-1 text-[12px] text-muted">{sub}</div>}
          </div>
        ))}
      </section>

      <Section flush title="Contacts" description="NCF recipients are the people Purchasing emails the exported form to."
        actions={
          <Modal label="Add contact" title="Add contact" icon={<Plus size={16} aria-hidden="true" />} buttonClassName="btn btn-commit h-9 md:h-9"
            description={`For ${s.name}. Give an email, a phone number, or both.`}>
            <ContactForm supplierId={s.id} />
          </Modal>
        }>
        {s.contacts.length === 0 ? (
          <EmptyState icon={UserRound} title="No contact yet">Add the person who should receive NCFs, so Purchasing knows where to send the form.</EmptyState>
        ) : (
          <table className="table w-full">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col" className="max-sm:hidden">Phone / WhatsApp</th>
                <th scope="col" className="max-sm:hidden">Receives NCFs</th>
                <th scope="col"><span className="sr-only">Edit</span></th>
              </tr>
            </thead>
            <tbody>
              {s.contacts.map((c) => (
                <tr key={c.id} className={c.active ? "" : "text-muted"}>
                  <td className="font-medium">{c.name}{!c.active && <span className="ml-2 text-[12px] font-normal">(inactive)</span>}</td>
                  <td className="max-w-[240px] truncate">{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "–"}</td>
                  <td className="num max-sm:hidden">{c.phone ?? "–"}</td>
                  <td className="max-sm:hidden">{c.ncf ? "Yes" : "No"}</td>
                  <td className="text-right">
                    <Modal label={<span className="sr-only">Edit {c.name}</span>} title="Edit contact" icon={<Pencil size={15} aria-hidden="true" />}
                      buttonClassName="btn h-8 px-2.5 md:h-8">
                      <ContactForm supplierId={s.id} contact={c} />
                    </Modal>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section flush title="NCF history" description="NCFs raised on this supplier, newest first (the stages your department works with).">
        {s.ncfs.length === 0 ? (
          <EmptyState title="No NCF yet" />
        ) : (
          <table className="table w-full">
            <thead>
              <tr>
                <th scope="col">No. Komplain</th>
                <th scope="col">Status</th>
                <th scope="col" className="max-sm:hidden">No. PO</th>
                <th scope="col" className="max-sm:hidden">Raised</th>
                <th scope="col" className="max-sm:hidden">Sent</th>
                <th scope="col" className="text-right">Reply</th>
              </tr>
            </thead>
            <tbody>
              {s.ncfs.map((n) => (
                <ClickableRow key={n.id} href={`/ncf/${n.id}`}>
                  <td><Link href={`/ncf/${n.id}`} className="num font-semibold">{n.ncf_no}</Link></td>
                  <td><StatusBadge status={n.status} /></td>
                  <td className="num max-sm:hidden">{n.po_no ?? "–"}</td>
                  <td className="num max-sm:hidden">{fmtDate(n.created_at)}</td>
                  <td className="num max-sm:hidden">{n.sent_at ? fmtDate(n.sent_at) : "–"}</td>
                  <td className="num text-right">{n.response_working_days === null ? "–" : `${n.response_working_days} wd`}</td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </Shell>
  );
}

/** Add a contact, or edit one (with its Active switch). */
function ContactForm({ supplierId, contact }: { supplierId: number; contact?: Contact }) {
  const k = contact ? `c${contact.id}` : "new";
  return (
    <ModalForm action={saveContactAction} className="flex flex-col gap-4">
      <input type="hidden" name="supplier_id" value={supplierId} />
      {contact && <input type="hidden" name="contact_id" value={contact.id} />}
      {contact && <input type="hidden" name="has_active" value="1" />}
      <div>
        <label htmlFor={`${k}-name`} className="label">Name</label>
        <input id={`${k}-name`} name="name" required defaultValue={contact?.name} className="input" placeholder="e.g. Hendra (QA Manager)" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${k}-email`} className="label">Email</label>
          <input id={`${k}-email`} name="email" type="email" defaultValue={contact?.email ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor={`${k}-phone`} className="label">Phone / WhatsApp</label>
          <input id={`${k}-phone`} name="phone" defaultValue={contact?.phone ?? ""} className="input num" inputMode="tel" />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
        <label className="flex items-center gap-2"><input type="checkbox" name="ncf" defaultChecked={contact ? contact.ncf : true} className="size-4" /> Receives NCFs</label>
        {contact && <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={contact.active} className="size-4" /> Active</label>}
      </div>
      <div className="flex justify-end"><Submit className="btn btn-commit">{contact ? "Save contact" : "Add contact"}</Submit></div>
    </ModalForm>
  );
}
