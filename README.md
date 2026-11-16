# VMS · NCF (QMS 1) — MVP

Digital Non Conformity Form for Integra Group, built from the Functional Design and ERD of 11–12 Nov 2026
(*Functional Design – NCF Digitalization*, tabs "FD" and "ERD · QMS to VMS").

**Flow covered:** QC creates the NCF from an MRReg → fills items, status, problem, follow-up and evidence → signs and submits
(password re-entry, versioned and hashed) → QC Manager, Material WHS Manager and GM approve in order → Purchasing exports
the form (PDF with the same QR codes as the internal print, marked "Salinan untuk supplier"), emails it from their own mailbox and marks it sent (the response clock
starts) → the supplier fills in Part 2 and emails it back → Purchasing attaches the reply and marks it returned (the clock
stops) → reminders to Purchasing follow the window and maximum in Settings → Purchasing or PCH Div. Head checks the reply and
closes (no verification note) → two-page A4 print with a document QR and one signature QR per approver → QR verification pages → audit trail of
every step. There is no supplier-facing page. The only part of the system a supplier can reach is the read-only QR
verification page, which shows what is already printed on the form (number, version, items, who signed and when).

**Not in this MVP:** live SAP connection (MRRegs come from the SAP export via `npm run import:mrreg`), sending email from
the system (internal notifications are queued in `notification_outbox` for a future SMTP worker), supplier scoring,
"ask for more information", voiding after sending (no role owns it yet), SSO.

**Also:** SAP Goods Receipt lists only open receipts (no NCF yet, not cancelled in SAP; a flag kept by a trigger and a
partial index, migration 011). Supplier Master (`/suppliers`, Purchasing and PCH) keeps vendors, NCF contacts and each
supplier's reply times. Users who work in several Business Units pick one in the top bar; it narrows lists, receipts,
the outbox and reports. Saving the form as PDF proposes "No. Komplain_ddmmyyyy_Supplier - Integra Group".

**Round 4:** notifications in the top bar (the next approver, Purchasing, and QC on return, reject, reply and close);
collapsible sidebar holding the Business Unit and the account; Accounts as a table with a page per person, roles
given for one or several units at once, positions from a list; NCF numbers start at 1 (numbers already used are
skipped); Indonesian national holidays and cuti bersama 2026–2027 loaded by default (SKB 3 Menteri, setneg.go.id);
camera capture for evidence on phones; read-only API for the VMS (`/api/v1/ncfs`, `/api/v1/responsiveness`, keys in
Master Settings, API keys).

**Design:** the INTEC design system (github.com/itg-gagarin/intec-design-system): tokens in `src/app/globals.css`, fonts in
`src/app/layout.tsx`, shared pieces in `src/components/ui`. One green button per screen for the action that advances the
NCF; indigo for saving inside a card; pills only for states; Lucide icons; tables with a frozen header and 10/20/50 paging.

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript · PostgreSQL 15+ (plain SQL migrations, `pg`) · Tailwind CSS 4.
Cache Components is switched off on purpose: every page reads the session and live data.

## Run it locally

```bash
cp .env.example .env.local        # then edit the values
npm install
npm run db:migrate                # applies db/migrations/*.sql
npm run db:seed                   # demo users, approval chain, demo receipts, calendar, settings
npm run import:mrreg -- mrreg2026.xlsx   # optional: real MRRegs from the SAP export
npm run dev                       # http://localhost:3000
```

Demo logins (password `demo1234`): `qc`, `qcm`, `whs`, `gm`, `pur`, `pch`, `audit`, `admin` — all `@demo.local`.

Reminder job, once a day (cron or Windows Task Scheduler):

```bash
curl -X POST -H "x-job-secret: $JOB_SECRET" https://<app>/api/jobs/reminders
```

## Tests

```bash
npm test                    # 38 tests against a real PostgreSQL test database (TEST_DATABASE_URL)
python3 tests/e2e_browser.py   # whole flow in Chrome, every role, with screenshots (app running on :3000)
npm run typecheck && npx eslint src scripts tests
```

`npm test` rebuilds the test database from the migrations and seed every run.

## Layout

The code is layered so the NCF can be joined by further QMS modules, and so the VMS (a separate platform) reads QMS data
only through the API. Full picture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); adding a module:
[docs/MODULES.md](docs/MODULES.md); running it: [docs/HANDOVER.md](docs/HANDOVER.md); owner decisions:
[docs/DECISIONS.md](docs/DECISIONS.md).

| Path | What |
| --- | --- |
| `db/migrations/` | Plain SQL, applied in order. `001_schema.sql` is the 33-table ERD, unchanged; later files only add |
| `src/platform/` | Shared by every module: database, login, roles (`access.ts`), audit, signature, calendar, settings, Business Units, notifications, API keys, files |
| `src/modules/ncf/` | QMS 1, the NCF: workflow, worklists, receipts, numbering, Purchasing outbox, reminders, reports, QR verification, API data |
| `src/modules/suppliers/` | Supplier Master: suppliers, NCF contacts, reply figures |
| `src/modules/admin/` | Master Settings: accounts and roles, positions, Business Units and approval chains, workflow settings, calendar |
| `src/components/ui/` | Design-system pieces: buttons, tables, forms (`ActionForm`), modals, charts |
| `src/components/shell/` | Sidebar, top bar, floating phone bar |
| `src/components/ncf/` | NCF document, print form, stepper, audit trail, evidence picker |
| `src/app/(app)/` | Internal screens (login required); Server Actions stay thin and call a module |
| `src/app/v/` | QR verification pages (public, read-only) |
| `src/app/api/v1/` | Read-only API for the VMS (API key) |
| `scripts/` | Migrate, seed, SAP MRReg import, demo data |
| `tests/` | `*.test.mts` against a real PostgreSQL; `e2e_browser.py` drives the whole flow in Chrome |

Rules live in `src/modules`, not in the screens: every function checks the role and the NCF status itself. ESLint
enforces the layers (`eslint.config.mjs`).

## Known gaps to close before go-live

1. **SAP export:** no Business Unit column (all imported MRRegs go to `DEFAULT_BU_CODE`), no line number (lines are numbered by
   row order, so a re-import must keep the same order), no unit, PO date, price or requested date. Excel damaged ~200 SJ numbers
   into dates (shown as `?YYYY-MM-DD`, "check SJ").
2. **Compliance:** approval with password re-entry as electronic signature (UU ITE Pasal 11) still needs sign-off.
3. **Owner decisions:** No. Komplain format (continues the paper register, `NNN/ROMAN/YYYY`), void owner, Hold flow,
   PPIC and archive recipients, public holidays in `calendar_day`, retention.
4. **Production:** SMTP worker for `notification_outbox`, SSO, object storage for evidence, monthly partitions for
   `audit_log` and `qr_scan`, HTTPS.
