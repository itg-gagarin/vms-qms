# Architecture

This repository is the **QMS** (Quality Management System) of Integra Group. Its first module is QMS 1, the digital
Non Conformity Form (NCF). Further quality modules join it as siblings. The **VMS** (Vendor Management System) is a
separate platform with its own code and database; it reads QMS data only through the read-only API (`/api/v1`).

```
            ┌───────────────────────────── QMS (this repository) ─────────────────────────────┐
 Browser ──▶│ src/app            screens, Server Actions, route handlers (thin)               │
 (staff)    │   │                                                                             │
            │   ▼                                                                             │
            │ src/components     design-system UI, app shell, NCF document and print form     │
            │   │                                                                             │
            │   ▼                                                                             │
            │ src/modules        business rules, one folder per module                        │
            │   ncf/ · suppliers/ · admin/ · (next QMS module)                                │
            │   │                                                                             │
            │   ▼                                                                             │
            │ src/platform       shared: db, auth, roles, audit, signature, calendar,         │
            │                    settings, business units, notifications, API keys, files     │
            │   │                                                                             │
            └───┼─────────────────────────────────────────────────────────────────────────────┘
                ▼
            PostgreSQL 16 (plain SQL migrations in db/migrations)

 Supplier ──▶ /v/... QR verification pages (public, read-only, only what is printed on the form)
 VMS ───────▶ /api/v1/ncfs, /api/v1/responsiveness (API key, read-only)
 SAP ───────▶ MRReg xlsx export → scripts/import-mrreg.ts (no live connection yet)
```

## Layers

| Layer | May import | Holds |
| --- | --- | --- |
| `src/app` | everything below | Pages, layouts, Server Actions, route handlers. Read the form, call a module, redirect. No SQL, no rules. |
| `src/components` | modules' client-safe files (`labels.ts`), platform types | UI only. `ui/` is the INTEC design system, `shell/` the frame, `ncf/` the NCF document pieces. |
| `src/modules/<m>` | `src/platform`, other modules **through their `index.ts`** | Business rules. Every exported function checks the caller's role and the record's state itself. |
| `src/platform` | nothing above it | What every module needs: database, session, roles, audit, e-signature, working-day calendar, dated settings, Business Units, notification queue, API keys, file storage. |

ESLint enforces these rules (`eslint.config.mjs`, `no-restricted-imports`). A new module must be added to the
`MODULES` list there.

## Request flow (example: approving an NCF)

1. `src/app/(app)/ncf/[id]/page.tsx` renders the NCF and the "Your decision" panel for the named approver.
2. The signing dialog posts to `decideAction` (`src/app/(app)/ncf/actions.ts`).
3. The action loads the session user (`platform/auth`) and calls `ncf.decide(...)` in `modules/ncf/workflow.ts`.
4. `decide` opens a transaction, checks that this person is the approver of the pending step, re-checks the password
   (`platform/signature`), stores the approval with the version hash, writes `audit_log` (`platform/audit`), queues the
   next notification (`platform/outbox`), and commits.
5. The action redirects to the next NCF waiting for the same approver, or back to this one with a message.

## Cross-cutting rules

- **Roles:** `hasRole`, `requireRole`, `roleScopes` and `buScope` in `platform/access.ts`. Super Admin counts as every
  role there. Signatures are not roles: a step names one person, and only that person signs.
- **Audit:** every state change writes `audit_log` in the same transaction (`audit`, `auditChange`).
- **Electronic signature:** submitting and approving re-check the password, are versioned and hashed. Do not weaken it.
- **Visibility:** each department sees only its NCF stages (`STATUSES_BY_ROLE`, `modules/ncf/visibility.ts`).
- **Business Units:** a person's roles are scoped per unit; the unit picked in the sidebar narrows lists
  (`platform/business-units.ts`).
- **Time:** stored in UTC, shown in WIB (UTC+7). Supplier response time counts working days from `calendar_day`.
- **Notifications:** queued in `notification_outbox` with the change. They show in the top bar today; an SMTP worker can
  send the same rows later.

## Data

`db/migrations/001_schema.sql` is the 33-table ERD and stays unchanged. Every later change is a new numbered file
(`002`–`012` so far). `scripts/migrate.ts` applies the files not yet applied, in order. Main tables:

| Area | Tables |
| --- | --- |
| People and access | `app_user`, `user_role`, `job_position`, `business_unit`, `api_key` |
| SAP receipts | `supplier`, `supplier_contact`, `item`, `mrreg`, `mrreg_line`, `purchase_order`, `po_line` |
| NCF | `ncf`, `ncf_item`, `ncf_version`, `ncf_approval`, `evidence`, `file_object`, `supplier_request` (sending to the supplier and the response clock), `capa_response` (the supplier's reply as received) |
| Configuration | `approval_chain_step`, `setting`, `calendar_day`, `problem_category`, `doc_counter` |
| Records | `audit_log`, `notification_outbox`, `reminder`, `qr_scan`, `print_log` |
| ERD tables not used by the QMS | `supplier_score`, `score_run`, `score_evidence`, `parameter_set`, `period` (supplier scoring, for the VMS side), `access_token` (supplier links, unused since 007) |

## Deployment

One Docker image (`Dockerfile`). At start-up it runs migrations and seed, which skip what is already done, then
`next start`. `.deployment-id` is written during the build so open tabs reload after a deploy instead of failing with
"Failed to find Server Action". Details: [HANDOVER.md](HANDOVER.md).
