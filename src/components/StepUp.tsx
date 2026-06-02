// Step-up re-auth modal (P3 hardening). Sensitive actions — attest, approve an
// exception, export an evidence package — require a fresh password re-verify.
// The API layer (api.ts) registers `prompt` here; on a step_up_required
// challenge it shows this modal, returns the password, and retries the action.
import { useEffect, useRef, useState } from "react";
import { setStepUpPrompt } from "../api";

export function StepUpGate() {
  // When a step-up is pending, holds the resolver for the in-flight prompt.
  const [pending, setPending] = useState<{ resolve: (v: string | null) => void } | null>(null);
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStepUpPrompt(() => new Promise<string | null>((resolve) => setPending({ resolve })));
    return () => setStepUpPrompt(null);
  }, []);

  useEffect(() => {
    if (pending) inputRef.current?.focus();
  }, [pending]);

  if (!pending) return null;

  function settle(value: string | null) {
    pending?.resolve(value);
    setPending(null);
    setPassword("");
  }

  return (
    <div className="stepup-backdrop" onClick={() => settle(null)}>
      <div className="stepup-card" onClick={(e) => e.stopPropagation()}>
        <div className="stepup-title">Confirm it's you</div>
        <div className="stepup-sub">This action requires re-entering your password.</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password) settle(password);
          }}
        >
          <input
            ref={inputRef}
            className="login-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === "Escape") settle(null);
            }}
          />
          <div className="stepup-actions">
            <button type="button" className="btn ghost" onClick={() => settle(null)}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!password}>
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
