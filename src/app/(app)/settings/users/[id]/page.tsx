import { KeyRound, Pencil, Plus, ShieldCheck } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm, Submit } from "@/components/ui/action-form";
import { Modal } from "@/components/ui/modal";
import { ModalForm } from "@/components/ui/modal-form";
import { Avatar, Banner, EmptyState, PageHead, Section, Shell, StatePill } from "@/components/ui";
import * as adm from "@/modules/admin";
import { ROLES } from "@/platform/access";
import { requireUser } from "@/platform/auth";
import { hasRole } from "@/platform/access";
import { AppError, fmtDate } from "@/platform/util";
import { addRolesAction, removeRoleAction, resetPasswordAction, setActiveAction, updateRoleAction, updateUserAction } from "../../actions";

function Field({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

/** One account: details, password, status, and its roles per business unit. */
export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const me = await requireUser();
  if (!hasRole(me, "SUPER_ADMIN")) redirect("/ncf");
  const { id } = await params;
  const { msg } = await searchParams;
  let u;
  try {
    u = await adm.getUser(me, Number(id));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const [positions, units] = await Promise.all([adm.listPositions(true), adm.listUnits()]);
  const roleLabel = Object.fromEntries(ROLES.map((r) => [r.role, r.label]));
  const posOptions = u.position && !positions.some((p) => p.name === u.position) ? [{ id: 0, name: u.position }, ...positions] : positions;

  return (
    <Shell>
      <PageHead
        title={<span className="flex items-center gap-3"><Avatar name={u.name} size={34} />{u.name}</span>}
        crumbs={[{ label: "Administration" }, { label: "Master Settings", href: "/settings" }, { label: "Accounts & roles", href: "/settings?tab=accounts" }, { label: u.name }]}
        sub={<>{u.position ?? "No position"} · {u.email} · since <span className="num">{fmtDate(u.created_at)}</span></>}>
        {u.active ? <StatePill tone="emerald">Active</StatePill> : <StatePill tone="slate">Inactive</StatePill>}
        <ActionForm action={setActiveAction}>
          <input type="hidden" name="id" value={u.id} />
          <input type="hidden" name="active" value={u.active ? "0" : "1"} />
          <Submit className={u.active ? "btn border-red-200 text-red-700 hover:bg-red-50" : "btn"}>{u.active ? "Deactivate" : "Activate"}</Submit>
        </ActionForm>
      </PageHead>
      {msg === "created" && <Banner kind="ok">Account created. Add the person&apos;s roles and business units below, then give them their first password.</Banner>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section flush title="Roles and business units" description="What the person may do, and in which units. QC and approvers work in the units given here; other roles cover all units."
          actions={
            <Modal label="Add role" title="Add role" icon={<Plus size={15} aria-hidden="true" />} buttonClassName="btn btn-commit h-8 md:h-8"
              description="Tick one or more business units for QC and approvers.">
              <ModalForm action={addRolesAction} className="flex flex-col gap-4">
                <input type="hidden" name="id" value={u.id} />
                <Field id="ar-role" label="Role">
                  <select id="ar-role" name="role" required defaultValue="" className="input">
                    <option value="" disabled>Choose a role…</option>
                    {ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}{r.scoped ? "" : " (all units)"}</option>)}
                  </select>
                </Field>
                <fieldset>
                  <legend className="label">Business units</legend>
                  <div className="flex flex-col gap-1.5 rounded-sm border border-hairline p-3">
                    <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="bu" value="all" className="size-4" /> All units, now and future</label>
                    {units.map((b) => (
                      <label key={b.id} className="flex items-center gap-2 text-[13px]">
                        <input type="checkbox" name="bu" value={b.id} className="size-4" defaultChecked={units.length === 1} />
                        <span className="num text-muted">{b.code}</span> {b.name}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-[12px] text-muted">Used for QC Inspector and NCF Approver; the other roles always cover all units.</p>
                </fieldset>
                <Field id="ar-until" label="Until (optional)" hint="Ends the role on this date, e.g. for an external auditor.">
                  <input id="ar-until" name="valid_to" type="date" className="input" />
                </Field>
                <div className="flex justify-end"><Submit className="btn btn-commit">Add role</Submit></div>
              </ModalForm>
            </Modal>
          }>
          {u.roles.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No role yet">Without a role the person can sign in but sees nothing. Add one.</EmptyState>
          ) : (
            <table className="table w-full">
              <thead><tr><th scope="col">Role</th><th scope="col">Business unit</th><th scope="col">Until</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {u.roles.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{roleLabel[r.role]}</td>
                    <td>{r.bu ? <><span className="num">{r.bu}</span> <span className="text-muted">· {units.find((b) => b.id === r.bu_id)?.name}</span></> : <span className="text-muted">All units</span>}</td>
                    <td className="num">{r.valid_to ? fmtDate(r.valid_to) : <span className="font-sans text-muted">–</span>}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <Modal label="Edit" title={`Edit role: ${roleLabel[r.role]}`} icon={<Pencil size={14} aria-hidden="true" />} buttonClassName="btn h-7 px-2.5 md:h-7"
                          description={adm.ROLE_SCOPED[r.role] ? "Where this role applies and until when." : "This role covers all units; set until when it applies."}>
                          <ModalForm action={updateRoleAction} className="flex flex-col gap-4">
                            <input type="hidden" name="role_id" value={r.id} />
                            {adm.ROLE_SCOPED[r.role] && (
                              <Field id={`er-bu-${r.id}`} label="Business unit">
                                <select id={`er-bu-${r.id}`} name="bu" defaultValue={r.bu_id ? String(r.bu_id) : "all"} className="input">
                                  <option value="all">All units, now and future</option>
                                  {units.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                                </select>
                              </Field>
                            )}
                            <Field id={`er-until-${r.id}`} label="Until (optional)" hint="Leave empty for no end date.">
                              <input id={`er-until-${r.id}`} name="valid_to" type="date" defaultValue={r.valid_to ? String(r.valid_to).slice(0, 10) : ""} className="input" />
                            </Field>
                            <div className="flex justify-end"><Submit className="btn btn-commit">Save role</Submit></div>
                          </ModalForm>
                        </Modal>
                        <ActionForm action={removeRoleAction}>
                          <input type="hidden" name="role_id" value={r.id} />
                          <Submit className="btn h-7 px-2.5 text-red-700 hover:bg-red-50 md:h-7">Remove</Submit>
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <div className="flex flex-col gap-4">
          <Section title="Details">
            <ActionForm action={updateUserAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={u.id} />
              <Field id="ed-name" label="Name"><input id="ed-name" name="name" defaultValue={u.name} required className="input" /></Field>
              <Field id="ed-pos" label="Position" hint="Printed under the person's signatures. The list is kept in Positions.">
                <select id="ed-pos" name="position" defaultValue={u.position ?? ""} className="input">
                  <option value="">No position</option>
                  {posOptions.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
              <Field id="ed-email" label="Email (sign-in)"><input id="ed-email" name="email" type="email" defaultValue={u.email} required className="input" /></Field>
              <div><Submit className="btn btn-commit">Save details</Submit></div>
            </ActionForm>
          </Section>
          <Section title="Password">
            <ActionForm action={resetPasswordAction} resetOnOk className="flex flex-col gap-3">
              <input type="hidden" name="id" value={u.id} />
              <Field id="ed-pw" label="New password (8+ characters)"><input id="ed-pw" name="password" type="text" minLength={8} required className="input font-mono" autoComplete="off" /></Field>
              <div><Submit className="btn"><KeyRound size={15} aria-hidden="true" /> Set password</Submit></div>
            </ActionForm>
          </Section>
          <p className="text-[12px] text-muted">Accounts are deactivated, never deleted: their signatures and records stay attributed to them.</p>
        </div>
      </div>
    </Shell>
  );
}
