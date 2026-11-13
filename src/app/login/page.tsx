import { ActionForm, Submit } from "@/components/action-form";
import { loginAction } from "./actions";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm">
        <p className="flex items-center gap-2 text-[13px] font-bold tracking-wide text-muted"><span className="h-4 w-1.5 rounded-xs bg-advance" aria-hidden="true" />INTEGRA GROUP</p>
        <h1 className="mt-1 text-2xl font-bold">Vendor Management System</h1>
        <p className="mt-1 text-sm text-muted">Non Conformity Form (QMS)</p>
        <ActionForm action={loginAction} className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required className="input" />
          </div>
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
          </div>
          <Submit className="btn btn-advance w-full">Sign in</Submit>
        </ActionForm>
        {/* Only on a developer machine: a public server must not advertise who can sign in. */}
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-6 text-xs text-muted">Demo accounts: qc, qcm, whs, gm, pur, pch, audit, admin @demo.local · password demo1234</p>
        )}
      </div>
    </main>
  );
}
