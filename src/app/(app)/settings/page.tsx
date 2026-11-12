import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { Section, Shell } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { readSettings, SETTING_KEYS } from "@/lib/verify";
import { saveSettingsAction } from "./actions";

export default async function SettingsPage() {
  const user = await requireUser();
  if (!hasRole(user, "SUPER_ADMIN")) redirect("/ncf");
  const values = await readSettings();
  return (
    <Shell>
      <h1 className="text-3xl font-bold">Settings</h1>
      <Section title="Supplier reminders and links">
        <ActionForm action={saveSettingsAction} className="flex flex-col gap-4">
          {SETTING_KEYS.map((s) => (
            <div key={s.key} className="max-w-sm">
              <label htmlFor={s.key} className="label">{s.label}</label>
              <input id={s.key} name={s.key} type="number" min={s.min} max={s.max} defaultValue={values[s.key]} required className="input" />
            </div>
          ))}
          <p className="text-sm text-slate-600">
            A reminder goes out each time the window passes without a CAPA, up to the maximum. Purchasing is always notified; the supplier
            only when it has an email contact. Every change is logged.
          </p>
          <div><Submit>Save settings</Submit></div>
        </ActionForm>
      </Section>
    </Shell>
  );
}
