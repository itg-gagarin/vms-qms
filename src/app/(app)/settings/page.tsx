import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm, Submit } from "@/components/ui/action-form";
import { Plus, Search } from "lucide-react";
import { ClickableRow } from "@/components/ui/clickable-row";
import { Modal } from "@/components/ui/modal";
import { ModalForm } from "@/components/ui/modal-form";
import { Avatar, EmptyState, PageHead, Section, Shell, StatePill, TableCard, Tabs } from "@/components/ui";
import * as adm from "@/modules/admin";
import * as numbering from "@/modules/ncf/numbering";
import { ROLES } from "@/platform/access";
import { API_SCOPES, listApiKeys } from "@/platform/api-keys";
import { recentSapBatches } from "@/modules/ncf/sap-feed";
import { requireUser } from "@/platform/auth";
import { hasRole, type Actor } from "@/platform/access";
import { fmtDate, wib } from "@/platform/util";
import {
  createApiKeyAction, createUserAction, extendCalendarAction, revokeApiKeyAction, saveCategoryAction, saveChainAction, saveNumberingAction, savePositionAction, saveUnitAction,
  saveWorkflowAction, setHolidayAction,
} from "./actions";

const TABS = [
  { key: "accounts", label: "Accounts & roles" },
  { key: "positions", label: "Positions" },
  { key: "chain", label: "Approval chain" },
  { key: "numbering", label: "Numbering" },
  { key: "workflow", label: "Reminders & targets" },
  { key: "categories", label: "Problem categories" },
  { key: "calendar", label: "Working calendar" },
  { key: "units", label: "Business units" },
  { key: "api", label: "API keys" },
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
      {tab === "accounts" && <Accounts user={user} term={sp.q ?? ""} />}
      {tab === "positions" && <Positions />}
      {tab === "chain" && <Chain />}
      {tab === "numbering" && <Numbering />}
      {tab === "workflow" && <Workflow />}
      {tab === "categories" && <Categories />}
      {tab === "calendar" && <Calendar year={Number(sp.year) || Number(wib(new Date()).date.slice(0, 4))} />}
      {tab === "units" && <Units />}
      {tab === "api" && <ApiKeys user={user} />}
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

/** Accounts as a table; each row opens the person's own page. New accounts are created in a dialog. */
async function Accounts({ user, term }: { user: Actor; term: string }) {
  const [all, positions] = await Promise.all([adm.listUsers(user), adm.listPositions(true)]);
  const roleLabel = Object.fromEntries(ROLES.map((r) => [r.role, r.label]));
  const t = term.trim().toLowerCase();
  const users = t ? all.filter((u) => `${u.name} ${u.email} ${u.position ?? ""}`.toLowerCase().includes(t)) : all;
  return (
    <TableCard
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <form className="relative min-w-0 flex-[1_1_240px] sm:max-w-sm" role="search">
            <Hidden name="tab" value="accounts" />
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
            <label htmlFor="uq" className="sr-only">Search accounts</label>
            <input id="uq" name="q" defaultValue={term} placeholder="Name, email or position" className="input h-9 pl-9 md:h-9" />
          </form>
          <span className="text-[12px] text-muted-foreground"><span className="num text-foreground">{all.filter((u) => u.active).length}</span> active · {all.length} total</span>
          <div className="ml-auto">
            <Modal label="New account" title="New account" icon={<Plus size={15} aria-hidden="true" />} buttonClassName="btn btn-commit"
              description="Roles and business units are given on the account page that opens next.">
              <ModalForm action={createUserAction} className="flex flex-col gap-4">
                <Field id="nu-name" label="Name"><input id="nu-name" name="name" required className="input" /></Field>
                <Field id="nu-pos" label="Position (printed under signatures)">
                  <select id="nu-pos" name="position" defaultValue="" className="input">
                    <option value="">No position</option>
                    {positions.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                </Field>
                <Field id="nu-email" label="Email (sign-in)"><input id="nu-email" name="email" type="email" required className="input" autoComplete="off" /></Field>
                <Field id="nu-pw" label="First password (8+ characters)"><input id="nu-pw" name="password" type="text" minLength={8} required className="input font-mono" autoComplete="off" /></Field>
                <div className="flex justify-end"><Submit className="btn btn-commit">Create account</Submit></div>
              </ModalForm>
            </Modal>
          </div>
        </div>
      }>
      {users.length === 0 && <EmptyState title="No account matches" />}
      {users.length > 0 && (
        <table className="table w-full">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col" className="max-md:hidden">Position</th>
              <th scope="col">Roles and business units</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <ClickableRow key={u.id} href={`/settings/users/${u.id}`}>
                <td>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={u.name} size={28} />
                    <div className="min-w-0">
                      <Link href={`/settings/users/${u.id}`} className="block font-medium">{u.name}</Link>
                      <div className="truncate text-[12px] text-muted-foreground">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="max-md:hidden">{u.position ?? <span className="text-muted-foreground">–</span>}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0 && <span className="text-[12px] text-status-amber">No role yet</span>}
                    {u.roles.map((r) => (
                      <span key={r.id} className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] text-foreground/80">
                        {roleLabel[r.role]}{r.bu ? ` · ${r.bu}` : ""}
                      </span>
                    ))}
                  </div>
                </td>
                <td>{u.active ? <StatePill tone="emerald">Active</StatePill> : <StatePill tone="slate">Inactive</StatePill>}</td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

// ---------- Positions ----------

async function Positions() {
  const list = await adm.listPositions();
  return (
    <Section flush title="Positions" description="The list behind the Position field. The position is printed under each signature; renaming one updates the accounts, not signatures already given.">
      <ul className="divide-y divide-border">
        {list.map((p) => (
          <li key={p.id} className="px-4 py-2.5">
            <ActionForm action={savePositionAction} className="flex flex-wrap items-center gap-3">
              <Hidden name="id" value={p.id} />
              <input name="name" defaultValue={p.name} aria-label="Position name" required className="input max-w-xs" />
              <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="active" defaultChecked={p.active} /> In the list</label>
              <span className="text-[12px] text-muted-foreground">{p.users} account{p.users === 1 ? "" : "s"}</span>
              <Submit className="btn">Save</Submit>
            </ActionForm>
          </li>
        ))}
      </ul>
      <ActionForm action={savePositionAction} resetOnOk className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
        <input name="name" required placeholder="New position, e.g. QC Supervisor" aria-label="New position" className="input max-w-xs" />
        <Submit className="btn btn-commit">Add position</Submit>
      </ActionForm>
    </Section>
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
                    <div className="pb-2.5 text-sm font-semibold text-muted-foreground">Step {i}</div>
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
              <p className="text-xs text-muted-foreground">Only people with the NCF Approver role for this unit are listed. Changes apply to NCFs submitted from now on.</p>
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
  const st = await numbering.numberingState();
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
          <Field id="next" label="Set the next number (optional)">
            <input id="next" name="next" type="number" min={1} placeholder={`next is ${st.next}`} className="input" />
          </Field>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-sm text-foreground/80">
          Parts: <code>{"{SEQ}"}</code> running number, <code>{"{SEQ:3}"}</code>/<code>{"{SEQ:4}"}</code> padded (007),{" "}
          <code>{"{ROMAN}"}</code> month in Roman (XI), <code>{"{MM}"}</code> month (11), <code>{"{YYYY}"}</code>/<code>{"{YY}"}</code> year,{" "}
          <code>{"{BU}"}</code> business-unit code. The paper register uses <code>{"{SEQ}/{ROMAN}/{YYYY}"}</code>, restarting every year.
          Numbering starts at 1 in each period. You can set the next number to any value, also lower: a number
          already on an NCF is skipped, so no number is ever used twice.
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
              <p className="mt-1 text-xs text-muted-foreground">{k.help}</p>
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
            <span className="text-xs text-muted-foreground">{c.used} NCF{c.used === 1 ? "" : "s"}</span>
            <Submit className="btn btn-commit">Save</Submit>
          </ActionForm>
        ))}
        <ActionForm action={saveCategoryAction} resetOnOk className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <input name="name" required placeholder="New category" aria-label="New category" className="input h-10 max-w-sm" />
          <Submit className="btn btn-commit">Add category</Submit>
        </ActionForm>
      </div>
    </Section>
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
            <p className="text-sm text-foreground/80">{year} is not in the calendar yet, so working days cannot be counted in it.</p>
            <Submit className="btn h-10">Add {year}</Submit>
          </ActionForm>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0">
              <div className="label">Days off in {year}</div>
              {cal.holidays.length === 0 && <p className="text-sm text-amber-800">No public holidays entered for {year}: response times count them as working days.</p>}
              <ul className="flex flex-col">
                {cal.holidays.map((h) => (
                  <li key={h.day}>
                    <ActionForm action={setHolidayAction} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-1.5 text-[13px] first:border-t-0">
                      <Hidden name="day" value={h.day} /><Hidden name="name" value={h.name ?? ""} /><Hidden name="holiday" value="0" />
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="num w-[82px] shrink-0">{fmtDate(h.day)}</span>
                        <span className="min-w-0">{(h.name ?? "").replace(/^Cuti bersama · /, "")}</span>
                        {h.kind === "NATIONAL" && <StatePill tone="red">Libur nasional</StatePill>}
                        {h.kind === "CUTI_BERSAMA" && <StatePill tone="amber">Cuti bersama</StatePill>}
                        {h.kind === "COMPANY" && <StatePill tone="indigo">Company</StatePill>}
                        {h.weekend && <span className="text-[12px] text-muted-foreground">weekend</span>}
                      </span>
                      {!h.weekend && <Submit className="btn h-7 px-2 text-xs md:h-7">Make working day</Submit>}
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </div>
            <ActionForm action={setHolidayAction} resetOnOk className="flex flex-col gap-3 self-start rounded-lg border border-border p-4">
              <div className="h2">Add a holiday</div>
              <p className="text-[12px] text-muted-foreground">Indonesian national holidays and cuti bersama for 2026 and 2027 are loaded from the SKB 3 Menteri. Add company days off here.</p>
              <Hidden name="holiday" value="1" />
              <Field id="hday" label="Date"><input id="hday" name="day" type="date" min={`${year}-01-01`} max={`${year}-12-31`} required className="input" /></Field>
              <Field id="hname" label="Holiday name"><input id="hname" name="name" required className="input" placeholder="e.g. Ulang tahun perusahaan" /></Field>
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
    <Section title="Business units" description="Each unit has its own QC, approvers and approval chain. The SAP branch (BPLId) routes receipts from the SAP feed to the unit; receipts of an unmapped branch go to the default unit.">
      <div className="flex flex-col gap-2">
        {units.map((b) => (
          <ActionForm key={b.id} action={saveUnitAction} className="flex flex-wrap items-center gap-3">
            <Hidden name="id" value={b.id} />
            <input name="code" defaultValue={b.code} aria-label="Code" className="input h-10 w-40 font-mono" />
            <input name="name" defaultValue={b.name} aria-label="Name" className="input h-10 max-w-sm" />
            <input name="sap_branch" type="number" min={0} defaultValue={b.sap_branch_id ?? ""} placeholder="SAP branch" aria-label="SAP branch (BPLId)" title="SAP branch (BPLId) whose receipts belong to this unit" className="input h-10 w-32 font-mono" />
            <span className="text-xs text-muted-foreground">{b.ncfs} NCF{b.ncfs === 1 ? "" : "s"}</span>
            <Submit className="btn btn-commit">Save</Submit>
          </ActionForm>
        ))}
        <ActionForm action={saveUnitAction} resetOnOk className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <input name="code" required placeholder="CODE" aria-label="New unit code" className="input h-10 w-40 font-mono" />
          <input name="name" required placeholder="Name" aria-label="New unit name" className="input h-10 max-w-sm" />
          <input name="sap_branch" type="number" min={0} placeholder="SAP branch" aria-label="New unit SAP branch (BPLId)" className="input h-10 w-32 font-mono" />
          <Submit className="btn btn-commit">Add unit</Submit>
        </ActionForm>
      </div>
    </Section>
  );
}

// ---------- API keys ----------

/** Keys for other Integra systems (the VMS) to read NCF rows and responsiveness. */
async function ApiKeys({ user }: { user: Actor }) {
  const [keys, batches] = await Promise.all([listApiKeys(user), recentSapBatches(user)]);
  const base = process.env.APP_URL ?? "";
  return (
    <>
      <Section flush title="API keys" description="Access for other Integra systems: Read keys for the VMS, Import keys for the SAP feed from n8n. A key does one of the two. It is shown once when it is made; only a hash is kept.">
        {keys.length === 0 ? <EmptyState title="No key yet">Make one for each system that reads NCF data, so each can be revoked on its own.</EmptyState> : (
          <table className="table w-full">
            <thead><tr><th scope="col">Name</th><th scope="col">Scope</th><th scope="col">Key starts</th><th scope="col">Made</th><th scope="col">Last used</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Revoke</span></th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium">{k.name}</td>
                  <td>{k.scope === "import" ? <StatePill tone="indigo">Import</StatePill> : <StatePill tone="slate">Read</StatePill>}</td>
                  <td className="num">vms_{k.prefix}_…</td>
                  <td className="num">{fmtDate(k.created_at)} <span className="font-sans text-muted-foreground">· {k.created_by}</span></td>
                  <td className="num">{k.last_used_at ? fmtDate(k.last_used_at) : <span className="font-sans text-muted-foreground">never</span>}</td>
                  <td>{k.revoked_at ? <StatePill tone="slate">Revoked</StatePill> : <StatePill tone="emerald">Active</StatePill>}</td>
                  <td className="text-right">
                    {!k.revoked_at && (
                      <ActionForm action={revokeApiKeyAction}>
                        <Hidden name="id" value={k.id} />
                        <Submit className="btn h-7 px-2.5 text-red-700 hover:bg-red-50 md:h-7">Revoke</Submit>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ActionForm action={createApiKeyAction} className="border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <input name="name" required minLength={2} placeholder="Used by, e.g. VMS reports or n8n SAP feed" aria-label="Key name" className="input max-w-xs" />
            <select name="scope" defaultValue="read" aria-label="What the key may do" className="input w-auto">
              {API_SCOPES.map((x) => <option key={x.scope} value={x.scope}>{x.label}: {x.hint}</option>)}
            </select>
            <Submit className="btn btn-commit">Make key</Submit>
          </div>
        </ActionForm>
      </Section>
      <Section flush title="SAP feed" description="n8n runs the MRReg + PO query in SAP and posts the rows here with an Import key. Setup: integrations/n8n/README.md.">
        <div className="px-4 py-3 sm:px-5">
          <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-[12px] leading-relaxed">{`POST ${base}/api/import/sap/mrreg
X-API-Key: vms_xxxxxxxx_…   (Import key)
{ "window": { "from": "2026-11-01", "to": "2026-11-26" }, "rows": [ { "No. MRReg": 260014520, "MRReg Line": 1, … } ] }`}</pre>
        </div>
        {batches.length === 0 ? <EmptyState title="Nothing received yet">The last batches from n8n show here, with what was added and what was skipped.</EmptyState> : (
          <table className="table w-full">
            <thead><tr><th scope="col">Received</th><th scope="col">Window</th><th scope="col" className="text-right">Rows</th><th scope="col" className="text-right">Receipts new / updated</th><th scope="col" className="text-right">Skipped</th><th scope="col">Unmapped branches</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="num">{fmtDate(b.received_at)} {wib(b.received_at).time}</td>
                  <td className="num">{b.window_from ? `${b.window_from} → ${b.window_to ?? ""}` : "–"}</td>
                  <td className="num text-right">{b.rows}</td>
                  <td className="num text-right">{b.mrregs_inserted} / {b.mrregs_updated}</td>
                  <td className="num text-right">{b.skipped ? <span className="text-status-red" title={b.first_skip ?? ""}>{b.skipped}</span> : 0}</td>
                  <td className="num">{b.unmapped || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="How the VMS reads the data">
        <div className="flex flex-col gap-3 text-[13px]">
          <p>Send the key in the <code>Authorization: Bearer</code> header (or <code>X-API-Key</code>). Dates are the day the NCF was raised (WIB). Drafts are not included.</p>
          <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-[12px] leading-relaxed">{`GET ${base}/api/v1/ncfs?from=2026-01-01&to=2026-12-31&status=CLOSED&supplier=VLP00412&bu=BU-DEMO&page=1&size=100
GET ${base}/api/v1/responsiveness?from=2026-01-01&to=2026-12-31&bu=BU-DEMO`}</pre>
          <p className="text-muted-foreground"><code>/ncfs</code> returns rows with items and every timestamp (raised, submitted, approved, sent, reply received, closed) and the working-day figures. <code>/responsiveness</code> returns the Reports page figures: summary, per supplier, per month, per status and per category.</p>
        </div>
      </Section>
    </>
  );
}
