import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm, Submit } from "@/components/action-form";
import { PageHead, Section, Shell, Tabs } from "@/components/ui";
import * as adm from "@/lib/admin";
import { requireUser } from "@/lib/auth";
import { hasRole, type Actor } from "@/lib/core";
import { fmtDate, wib } from "@/lib/util";
import {
  addRoleAction, createUserAction, extendCalendarAction, removeRoleAction, resetPasswordAction, saveCategoryAction, saveChainAction,
  saveContactAction, saveNumberingAction, saveUnitAction, saveWorkflowAction, setActiveAction, setHolidayAction, updateUserAction,
} from "./actions";

const TABS = [
  { key: "accounts", label: "Accounts & roles" },
  { key: "chain", label: "Approval chain" },
  { key: "numbering", label: "Numbering" },
  { key: "workflow", label: "Reminders & targets" },
  { key: "categories", label: "Problem categories" },
  { key: "suppliers", label: "Supplier contacts" },
  { key: "calendar", label: "Working calendar" },
  { key: "units", label: "Business units" },
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  if (!hasRole(user, "SUPER_ADMIN")) redirect("/ncf");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "accounts";
  return (
    <Shell>
      <PageHead title="Master Settings" crumbs={[{ label: "Administration" }, { label: "Master Settings" }]} sub="Every change here is written to the audit log with who made it and the old and new value." />
      <Tabs label="Settings" items={TABS.map((t) => ({ href: `/settings?tab=${t.key}`, label: t.label, active: t.key === tab }))} />
      {tab === "accounts" && <Accounts user={user} />}
      {tab === "chain" && <Chain />}
      {tab === "numbering" && <Numbering />}
      {tab === "workflow" && <Workflow />}
      {tab === "categories" && <Categories />}
      {tab === "suppliers" && <Suppliers term={sp.q ?? ""} />}
      {tab === "calendar" && <Calendar year={Number(sp.year) || Number(wib(new Date()).date.slice(0, 4))} />}
      {tab === "units" && <Units />}
    </Shell>
  );
}

function Hidden({ name, value }: { name: string; value: string | number }) {
  return <input type="hidden" name={name} value={value} />;
}

function Field({ id, label, children, className = "" }: { id: string; label: string; children: ReactNode; className?: string }) {
  return <div className={className}><label htmlFor={id} className="label">{label}</label>{children}</div>;
}

// ---------- Accounts ----------

async function Accounts({ user }: { user: Actor }) {
  const [users, units] = await Promise.all([adm.listUsers(user), adm.listUnits()]);
  const roleLabel = Object.fromEntries(adm.ROLES.map((r) => [r.role, r.label]));
  return (
    <>
      <Section title="New account">
        <ActionForm action={createUserAction} resetOnOk className="grid gap-3 md:grid-cols-4">
          <Field id="nu-name" label="Name"><input id="nu-name" name="name" required className="input" /></Field>
          <Field id="nu-pos" label="Position (printed under signatures)"><input id="nu-pos" name="position" className="input" placeholder="QC Manager" /></Field>
          <Field id="nu-email" label="Email (sign-in)"><input id="nu-email" name="email" type="email" required className="input" /></Field>
          <Field id="nu-pw" label="First password (8+ characters)"><input id="nu-pw" name="password" type="text" minLength={8} required className="input font-mono" autoComplete="off" /></Field>
          <div className="md:col-span-4"><Submit>Create account</Submit> <span className="ml-2 text-xs text-slate-500">Add roles after creating it.</span></div>
        </ActionForm>
      </Section>

      <Section flush title="Accounts" aside={`${users.filter((u) => u.active).length} active · ${users.length} total`}>
        <ul className="flex flex-col">
          {users.map((u) => (
            <li key={u.id} className={`border-t border-hairline px-4 py-3 first:border-t-0 sm:px-5 ${u.active ? "" : "bg-slate-50 text-slate-500"}`}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold text-slate-900">{u.name}</span>
                    <span className="text-sm"> · {u.position ?? "no position"} · {u.email}</span>
                    {!u.active && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-semibold">Inactive</span>}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {u.roles.length === 0 && <span className="text-xs text-amber-800">No role: cannot do anything yet</span>}
                    {u.roles.map((r) => (
                      <span key={r.id} className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
                        {roleLabel[r.role]}{r.bu ? ` · ${r.bu}` : ""}{r.valid_to ? ` · until ${fmtDate(r.valid_to)}` : ""}
                      </span>
                    ))}
                  </span>
                </summary>
                <div className="mt-4 grid gap-5 lg:grid-cols-3">
                  <ActionForm action={updateUserAction} className="flex flex-col gap-3">
                    <Hidden name="id" value={u.id} />
                    <Field id={`n${u.id}`} label="Name"><input id={`n${u.id}`} name="name" defaultValue={u.name} className="input" /></Field>
                    <Field id={`p${u.id}`} label="Position"><input id={`p${u.id}`} name="position" defaultValue={u.position ?? ""} className="input" /></Field>
                    <Field id={`e${u.id}`} label="Email"><input id={`e${u.id}`} name="email" type="email" defaultValue={u.email} className="input" /></Field>
                    <div><Submit className="btn btn-commit">Save details</Submit></div>
                  </ActionForm>
                  <div className="flex flex-col gap-3">
                    <div className="label mb-0">Roles</div>
                    {u.roles.map((r) => (
                      <ActionForm key={r.id} action={removeRoleAction} className="flex items-center justify-between gap-2 text-sm">
                        <Hidden name="role_id" value={r.id} />
                        <span>{roleLabel[r.role]} · {r.bu ?? "all units"}{r.valid_to ? ` · until ${fmtDate(r.valid_to)}` : ""}</span>
                        <Submit className="btn btn-danger h-8 px-2 text-xs">Remove</Submit>
                      </ActionForm>
                    ))}
                    <ActionForm action={addRoleAction} className="grid grid-cols-2 gap-2">
                      <Hidden name="id" value={u.id} />
                      <select name="role" aria-label="Role" className="input h-10" required defaultValue="">
                        <option value="" disabled>Role…</option>
                        {adm.ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
                      </select>
                      <select name="bu_id" aria-label="Business unit" className="input h-10" defaultValue="">
                        <option value="">All units</option>
                        {units.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                      </select>
                      <input name="valid_to" type="date" aria-label="Until (optional)" className="input h-10" />
                      <Submit className="btn btn-commit">Add role</Submit>
                      <p className="col-span-2 text-xs text-slate-500">Unit applies to QC and approvers; other roles cover all units. &ldquo;Until&rdquo; ends the role, e.g. for an external auditor.</p>
                    </ActionForm>
                  </div>
                  <div className="flex flex-col gap-3">
                    <ActionForm action={resetPasswordAction} resetOnOk className="flex flex-col gap-2">
                      <Hidden name="id" value={u.id} />
                      <Field id={`pw${u.id}`} label="New password"><input id={`pw${u.id}`} name="password" type="text" minLength={8} required className="input font-mono" autoComplete="off" /></Field>
                      <div><Submit className="btn btn-commit">Set password</Submit></div>
                    </ActionForm>
                    {u.id !== user.id && (
                      <ActionForm action={setActiveAction}>
                        <Hidden name="id" value={u.id} />
                        <Hidden name="active" value={u.active ? "0" : "1"} />
                        <Submit className={u.active ? "btn btn-danger h-10" : "btn h-10"}>{u.active ? "Deactivate account" : "Activate account"}</Submit>
                      </ActionForm>
                    )}
                    <p className="text-xs text-slate-500">Accounts are deactivated, never deleted: their signatures and records stay attributed to them.</p>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

// ---------- Approval chain ----------

async function Chain() {
  const [units, chains] = await Promise.all([adm.listUnits(), adm.approvalChains()]);
  const options = Object.fromEntries(await Promise.all(units.map(async (b) => [b.id, await adm.approverOptions(b.id)] as const)));
  return (
    <>
      {units.map((b) => {
        const steps = chains.filter((c) => c.bu_id === b.id);
        return (
          <Section key={b.id} title={`${b.code} · ${b.name}`} aside="QC Inspector signs first (step 0), then steps 1 to 3 in order">
            <ActionForm action={saveChainAction} className="flex flex-col gap-3">
              <Hidden name="bu_id" value={b.id} />
              {[1, 2, 3].map((i) => {
                const st = steps.find((x) => x.step_no === i);
                return (
                  <div key={i} className="grid items-end gap-3 md:grid-cols-[60px_1fr_1fr]">
                    <div className="pb-2.5 text-sm font-semibold text-muted">Step {i}</div>
                    <Field id={`t${b.id}${i}`} label="Title on the form"><input id={`t${b.id}${i}`} name={`title_${i}`} defaultValue={st?.approver_title ?? ""} className="input" placeholder={["QC Manager", "Material WHS Manager", "GM"][i - 1]} /></Field>
                    <Field id={`a${b.id}${i}`} label="Approver">
                      <select id={`a${b.id}${i}`} name={`approver_${i}`} defaultValue={st?.approver_id ?? ""} className="input">
                        <option value="">{i === 1 ? "Choose…" : "No step"}</option>
                        {options[b.id].map((u) => <option key={u.id} value={u.id}>{u.name}{u.position ? ` · ${u.position}` : ""}</option>)}
                      </select>
                    </Field>
                  </div>
                );
              })}
              <p className="text-xs text-slate-500">Only people with the NCF Approver role for this unit are listed. Changes apply to NCFs submitted from now on.</p>
              <div><Submit>Save chain</Submit></div>
            </ActionForm>
          </Section>
        );
      })}
    </>
  );
}

// ---------- Numbering ----------

async function Numbering() {
  const st = await adm.numberingState();
  return (
    <Section title="NCF number (No. Komplain)" aside={`Next: ${st.preview}`}>
      <ActionForm action={saveNumberingAction} className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field id="format" label="Format"><input id="format" name="format" defaultValue={st.format} required className="input font-mono" /></Field>
          <Field id="reset" label="Counter restarts">
            <select id="reset" name="reset" defaultValue={st.reset} className="input">
              <option value="yearly">Every year</option>
              <option value="monthly">Every month</option>
              <option value="never">Never</option>
            </select>
          </Field>
          <Field id="next" label={`Next running number (now ${st.last + 1})`}>
            <input id="next" name="next" type="number" min={st.last + 1} placeholder={String(st.last + 1)} className="input" />
          </Field>
        </div>
        <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
          Parts: <code>{"{SEQ}"}</code> running number, <code>{"{SEQ:3}"}</code>/<code>{"{SEQ:4}"}</code> padded (007),{" "}
          <code>{"{ROMAN}"}</code> month in Roman (XI), <code>{"{MM}"}</code> month (11), <code>{"{YYYY}"}</code>/<code>{"{YY}"}</code> year,{" "}
          <code>{"{BU}"}</code> business-unit code. The paper register uses <code>{"{SEQ}/{ROMAN}/{YYYY}"}</code>, restarting every year.
          A number never repeats: the next number can only move forward.
        </div>
        <div><Submit>Save numbering</Submit></div>
      </ActionForm>
    </Section>
  );
}

// ---------- Reminders and targets ----------

async function Workflow() {
  const values = await adm.workflowSettings();
  return (
    <Section title="Supplier reminders, links and targets">
      <ActionForm action={saveWorkflowAction} className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          {adm.WORKFLOW_KEYS.map((k) => (
            <Field key={k.key} id={k.key} label={k.label}>
              <input id={k.key} name={k.key} type="number" min={k.min} max={k.max} defaultValue={values[k.key]} required className="input max-w-[200px]" />
              <p className="mt-1 text-xs text-slate-500">{k.help}</p>
            </Field>
          ))}
        </div>
        <div><Submit>Save</Submit></div>
      </ActionForm>
    </Section>
  );
}

// ---------- Problem categories ----------

async function Categories() {
  const cats = await adm.listCategories();
  return (
    <Section title="Problem categories" aside="Inactive categories stay on old NCFs but cannot be chosen">
      <div className="flex flex-col gap-2">
        {cats.map((c) => (
          <ActionForm key={c.id} action={saveCategoryAction} className="flex flex-wrap items-center gap-3">
            <Hidden name="id" value={c.id} />
            <input name="name" defaultValue={c.name} aria-label="Category name" className="input h-10 max-w-sm" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={c.active} /> Active</label>
            <span className="text-xs text-slate-500">{c.used} NCF{c.used === 1 ? "" : "s"}</span>
            <Submit className="btn btn-commit">Save</Submit>
          </ActionForm>
        ))}
        <ActionForm action={saveCategoryAction} resetOnOk className="mt-3 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
          <input name="name" required placeholder="New category" aria-label="New category" className="input h-10 max-w-sm" />
          <Submit className="btn btn-commit">Add category</Submit>
        </ActionForm>
      </div>
    </Section>
  );
}

// ---------- Supplier contacts ----------

async function Suppliers({ term }: { term: string }) {
  const rows = await adm.listSuppliers(term);
  return (
    <>
      <form className="card flex flex-wrap items-end gap-3 p-4" role="search">
        <Hidden name="tab" value="suppliers" />
        <Field id="sq" label="Search supplier" className="min-w-[260px] flex-1"><input id="sq" name="q" defaultValue={term} className="input h-10" placeholder="Name or vendor code" /></Field>
        <button className="btn h-10">Search</button>
        <p className="w-full text-xs text-slate-500">Suppliers come from SAP. Contacts are kept here: they appear in the Supplier Outbox, and those marked NCF get NCF emails once sending from the system starts.</p>
      </form>
      {rows.map((sup) => (
        <Section key={sup.id} title={sup.name} aside={sup.code}>
          <div className="flex flex-col gap-2">
            {sup.contacts.map((c) => (
              <ActionForm key={c.id} action={saveContactAction} className="grid items-center gap-2 md:grid-cols-[1fr_1fr_160px_auto_auto_auto]">
                <Hidden name="id" value={c.id} /><Hidden name="supplier_id" value={sup.id} />
                <input name="name" defaultValue={c.name} aria-label="Contact name" className="input h-10" />
                <input name="email" type="email" defaultValue={c.email ?? ""} aria-label="Email" placeholder="email" className="input h-10" />
                <input name="phone" defaultValue={c.phone ?? ""} aria-label="Phone" placeholder="phone / WhatsApp" className="input h-10" />
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="ncf" defaultChecked={c.ncf} /> NCF</label>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={c.active} /> Active</label>
                <Submit className="btn btn-commit">Save</Submit>
              </ActionForm>
            ))}
            <ActionForm action={saveContactAction} resetOnOk className="grid items-center gap-2 border-t border-hairline pt-3 md:grid-cols-[1fr_1fr_160px_auto_auto]">
              <Hidden name="supplier_id" value={sup.id} />
              <input name="name" required placeholder="New contact name" aria-label="New contact name" className="input h-10" />
              <input name="email" type="email" placeholder="email" aria-label="New contact email" className="input h-10" />
              <input name="phone" placeholder="phone / WhatsApp" aria-label="New contact phone" className="input h-10" />
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="ncf" defaultChecked /> NCF</label>
              <Submit className="btn btn-commit">Add contact</Submit>
            </ActionForm>
          </div>
        </Section>
      ))}
      {rows.length === 0 && <p className="text-muted">No supplier found.</p>}
    </>
  );
}

// ---------- Working calendar ----------

async function Calendar({ year }: { year: number }) {
  const cal = await adm.calendarYear(year);
  return (
    <>
      <Section title={`Working calendar ${year}`} aside={`${cal.days} days loaded · weekends never count`}>
        <div className="mb-4 flex gap-3 text-sm">
          <Link href={`/settings?tab=calendar&year=${year - 1}`}>← {year - 1}</Link>
          <Link href={`/settings?tab=calendar&year=${year + 1}`}>{year + 1} →</Link>
        </div>
        {cal.days === 0 ? (
          <ActionForm action={extendCalendarAction} className="flex items-center gap-3">
            <Hidden name="year" value={year} />
            <p className="text-sm text-slate-700">{year} is not in the calendar yet, so working days cannot be counted in it.</p>
            <Submit className="btn h-10">Add {year}</Submit>
          </ActionForm>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="label">Holidays (not working days)</div>
              {cal.holidays.length === 0 && <p className="text-sm text-amber-800">No public holidays entered for {year}: response times count them as working days.</p>}
              <ul className="flex flex-col">
                {cal.holidays.map((h) => (
                  <li key={h.day}>
                    <ActionForm action={setHolidayAction} className="flex items-center justify-between gap-2 border-t border-hairline py-1.5 text-sm first:border-t-0">
                      <Hidden name="day" value={h.day} /><Hidden name="name" value={h.name ?? ""} /><Hidden name="holiday" value="0" />
                      <span><span className="font-medium tabular-nums">{fmtDate(h.day)}</span> · {h.name}</span>
                      <Submit className="btn h-8 px-2 text-xs">Make working day</Submit>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </div>
            <ActionForm action={setHolidayAction} resetOnOk className="flex flex-col gap-3">
              <Hidden name="holiday" value="1" />
              <Field id="hday" label="Date"><input id="hday" name="day" type="date" min={`${year}-01-01`} max={`${year}-12-31`} required className="input" /></Field>
              <Field id="hname" label="Holiday name"><input id="hname" name="name" required className="input" placeholder="e.g. Hari Raya Idul Fitri, cuti bersama" /></Field>
              <div><Submit>Add holiday</Submit></div>
            </ActionForm>
          </div>
        )}
      </Section>
    </>
  );
}

// ---------- Business units ----------

async function Units() {
  const units = await adm.listUnits();
  return (
    <Section title="Business units" aside="Each unit has its own QC, approvers and approval chain">
      <div className="flex flex-col gap-2">
        {units.map((b) => (
          <ActionForm key={b.id} action={saveUnitAction} className="flex flex-wrap items-center gap-3">
            <Hidden name="id" value={b.id} />
            <input name="code" defaultValue={b.code} aria-label="Code" className="input h-10 w-40 font-mono" />
            <input name="name" defaultValue={b.name} aria-label="Name" className="input h-10 max-w-sm" />
            <span className="text-xs text-slate-500">{b.ncfs} NCF{b.ncfs === 1 ? "" : "s"}</span>
            <Submit className="btn btn-commit">Save</Submit>
          </ActionForm>
        ))}
        <ActionForm action={saveUnitAction} resetOnOk className="mt-3 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
          <input name="code" required placeholder="CODE" aria-label="New unit code" className="input h-10 w-40 font-mono" />
          <input name="name" required placeholder="Name" aria-label="New unit name" className="input h-10 max-w-sm" />
          <Submit className="btn btn-commit">Add unit</Submit>
        </ActionForm>
      </div>
    </Section>
  );
}
