# Adding a QMS module

The NCF (`src/modules/ncf`) is the pattern to copy. A new quality module (for example customer complaints, internal
audit findings or CAPA tracking) gets the same shape so the next developer finds things in the same places.

## Checklist

1. **Migration.** Add `db/migrations/0NN_<module>.sql` with the new tables. Reuse `business_unit`, `app_user`,
   `audit_log`, `notification_outbox`, `setting` and `calendar_day`; do not copy them. Never edit an applied migration.
2. **Roles.** If the module needs a new role, add it to `Role` and `ROLES` in `src/platform/access.ts` (with `scoped`
   true when it applies per Business Unit), and replace the `user_role.role` check constraint (defined in
   `001_schema.sql`) in your migration with one that lists the new role. Decide the role's centre button on phones (`primaryRole` order in `access.ts`, `centre` in `src/app/(app)/layout.tsx`).
3. **Module folder.** `src/modules/<module>/`:
   - `labels.ts`: statuses and names shared with client components. No database imports.
   - one file per area of rules (records, workflow, reports, …). Each exported function takes the `Actor` first,
     checks the role with `requireRole`, checks the record's state, runs in `tx(...)`, and writes `audit_log`.
   - `index.ts`: re-exports what screens and other modules may use. Other modules import only this file.
4. **Lint.** Add the module name to `MODULES` in `eslint.config.mjs` so the layer rules apply to it.
5. **Screens.** `src/app/(app)/<module>/`: `page.tsx` files guarded with `requireRole` (or a visibility check), and
   `actions.ts` with Server Actions that read the form, call the module, and return `ActionState` or redirect. Forms go
   through `ActionForm`/`ModalForm`. Use the shadcn components in `src/components/ui` (add new ones with `npx shadcn@latest add`): one advancing action per screen, `btn-commit` for saves.
6. **Menu.** Add a group or items to `menu` in `src/app/(app)/layout.tsx` with the same role list the pages check.
   Add the route to the redirect allowlist in `src/app/(app)/bu-actions.ts` if the Business Unit switch should return
   to it.
7. **Home.** If the module gives a role work to do, add a tile or card to `src/app/(app)/home/page.tsx`.
8. **Notifications.** Queue messages with `enqueue` (`src/platform/outbox.ts`) inside the same transaction.
9. **API.** If the VMS or another system needs the data, add a read-only route under `src/app/api/v1/` that uses
   `respond()` (API key, no caching) and a data function in the module. The API never writes.
10. **Tests.** `tests/<module>.test.mts` against the real test database (see `tests/helpers.mts`), and a pass through
    the new flow in `tests/e2e_browser.py`.
11. **Docs.** A line in README's layout table, and any owner decision in [DECISIONS.md](DECISIONS.md).

## What belongs in `src/platform`

Something goes in `platform` only when two or more modules need it and it holds no module's rules: sessions and
roles, audit, the e-signature check, the working-day calendar, dated settings, Business Units, the notification queue,
API keys, file storage. A module never reaches into another module's tables to change them; it calls that module's
exported function.

## The VMS boundary

The VMS (supplier scoring, vendor master, supplier portal if the owner ever decides on one) is a separate platform.
It reads QMS data through `/api/v1` with an API key created in Master Settings → API keys. It does not share this
database, and the QMS does not call the VMS. If the QMS later needs vendor data from the VMS, add a read-only client
in `src/platform` behind an interface so modules do not depend on the VMS directly.
