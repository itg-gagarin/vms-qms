import { ActionForm, Submit } from "@/components/action-form";
import { loginAction } from "./actions";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm">
        <p className="text-[13px] font-bold tracking-wide text-slate-600">INTEGRA GROUP</p>
        <h1 className="mt-1 text-2xl font-bold">Vendor Management System</h1>
        <p className="mt-1 text-sm text-slate-600">Non Conformity Form (QMS)</p>
        <ActionForm action={loginAction} className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required className="input" />
          </div>
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
          </div>
          <Submit>Sign in</Submit>
        </ActionForm>
        <p className="mt-6 text-xs text-slate-600">
          Demo accounts: qc, qcm, whs, gm, pur, pch, audit, admin @demo.local · password demo1234
        </p>
      </div>
    </main>
  );
}
