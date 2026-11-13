"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";

export type ActionState = { error?: string; ok?: string; link?: string; n?: number };
type Action = (prev: ActionState, data: FormData) => Promise<ActionState>;

const Pending = createContext(false);

/**
 * A form that runs a Server Action and shows its error, message or generated link in place.
 * It submits through onSubmit, so what the user typed stays in the fields when the action fails.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnOk,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnOk?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const shown = useRef<ActionState>(state);

  useEffect(() => {
    if (resetOnOk && state !== shown.current && state.ok) ref.current?.reset();
    shown.current = state;
  }, [state, resetOnOk]);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const data = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(data));
      }}
    >
      <Pending value={pending}>{children}</Pending>
      {state.error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {state.ok && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.ok}</p>}
      {state.link && <LinkBox link={state.link} />}
    </form>
  );
}

export function Submit({ children, className = "btn btn-commit", name, value }: { children: ReactNode; className?: string; name?: string; value?: string }) {
  const pending = useContext(Pending);
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? "Working…" : children}
    </button>
  );
}

function LinkBox({ link }: { link: string }) {
  return (
    <div className="mt-3 rounded-md border border-brand/40 bg-brand-soft p-3">
      <p className="text-sm font-semibold text-slate-800">Link for the supplier. Copy it now: it is shown only once.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input readOnly value={link} className="input font-mono text-sm" aria-label="Supplier link" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(link)}>
          Copy
        </button>
      </div>
    </div>
  );
}
