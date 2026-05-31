// Login screen (P3). Local-account auth; quick-login buttons make the RBAC
// roles easy to demo. SSO buttons would sit alongside these later.
import { useEffect, useState } from "react";
import { login, fetchAuthProviders, type CurrentUser } from "../api";

const PROVIDER_LABEL: Record<string, string> = { github: "Continue with GitHub", google: "Continue with Google" };

const QUICK = [
  { email: "admin@autocomply.local", label: "Admin" },
  { email: "cm@autocomply.local", label: "Compliance Mgr" },
  { email: "owner@autocomply.local", label: "Control Owner" },
  { email: "auditor@autocomply.local", label: "Auditor" },
  { email: "viewer@autocomply.local", label: "Viewer" },
];

export function LoginPage({ onLogin }: { onLogin: (u: CurrentUser) => void }) {
  const [email, setEmail] = useState("admin@autocomply.local");
  const [password, setPassword] = useState("autocomply");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => {
    fetchAuthProviders().then(setProviders);
  }, []);

  async function submit(asEmail?: string) {
    setBusy(true);
    setErr(null);
    try {
      const u = await login(asEmail ?? email, password);
      onLogin(u);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand" style={{ marginBottom: 4 }}>
          <span className="brand-mark" />
          <span className="brand-name">autocomply<span> / control center</span></span>
        </div>
        <div className="login-sub">Sign in to continue</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="login-label">Email</label>
          <input className="login-input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          <label className="login-label">Password</label>
          <input className="login-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          {err && <div className="login-err">{err}</div>}
          <button className="btn primary login-btn" disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {providers.length > 0 && (
          <>
            <div className="login-divider">single sign-on</div>
            <div className="login-sso">
              {providers.map((p) => (
                <a key={p} className="btn login-sso-btn" href={`/api/auth/${p}`}>
                  {PROVIDER_LABEL[p] ?? `Continue with ${p}`}
                </a>
              ))}
            </div>
          </>
        )}
        <div className="login-divider">demo quick-login</div>
        <div className="login-quick">
          {QUICK.map((q) => (
            <button key={q.email} className="btn" disabled={busy} onClick={() => submit(q.email)}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="login-note">All demo accounts use password <code>autocomply</code>. Auditor is time-boxed.</div>
      </div>
    </div>
  );
}
