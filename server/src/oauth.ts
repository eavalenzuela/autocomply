// SSO via OAuth/OIDC (P3). GitHub + Google. Secrets come from env (the operator
// pastes them into server/.env; they never appear in code or logs). On callback
// we resolve the IdP email to a local user — linking an existing account or
// JIT-provisioning a new one at least-privilege (viewer). IdP-group→role mapping
// and SCIM directory sync would extend this; MFA is delegated to the IdP.
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "./db/index";
import * as s from "./db/schema";
import { createSession, setSessionCookie, type Role } from "./auth";

const BASE_URL = process.env.OAUTH_BASE_URL ?? "http://localhost:5173";
const JIT_ROLE: Role = (process.env.SSO_DEFAULT_ROLE as Role) ?? "viewer";

interface Provider {
  id: "github" | "google";
  authUrl: string;
  tokenUrl: string;
  scope: string;
  clientId?: string;
  clientSecret?: string;
  fetchIdentity: (accessToken: string) => Promise<{ email: string; name: string } | null>;
}

const PROVIDERS: Record<string, Provider> = {
  github: {
    id: "github",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    async fetchIdentity(token) {
      const h = { Authorization: `Bearer ${token}`, "User-Agent": "autocomply", Accept: "application/vnd.github+json" };
      const user: any = await (await fetch("https://api.github.com/user", { headers: h })).json();
      const emails: any = await (await fetch("https://api.github.com/user/emails", { headers: h })).json();
      const primary = Array.isArray(emails) ? emails.find((e: any) => e.primary && e.verified) ?? emails.find((e: any) => e.verified) : null;
      const email = primary?.email ?? user?.email;
      if (!email) return null;
      return { email, name: user?.name || user?.login || email };
    },
  },
  google: {
    id: "google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    async fetchIdentity(token) {
      const info: any = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } })).json();
      if (!info?.email) return null;
      return { email: info.email, name: info.name || info.email };
    },
  },
};

export function configuredProviders(): string[] {
  return Object.values(PROVIDERS)
    .filter((p) => p.clientId && p.clientSecret)
    .map((p) => p.id);
}

function redirectUri(id: string) {
  return `${BASE_URL}/api/auth/${id}/callback`;
}

export function registerOAuth(app: FastifyInstance) {
  app.get("/api/auth/providers", async () => ({ providers: configuredProviders() }));

  app.get<{ Params: { provider: string } }>("/api/auth/:provider", async (req, reply) => {
    const p = PROVIDERS[req.params.provider];
    if (!p || !p.clientId || !p.clientSecret) return reply.code(404).send({ error: "provider not configured" });
    const state = randomBytes(16).toString("hex");
    (reply as any).setCookie(`oauth_state_${p.id}`, state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
    const url = new URL(p.authUrl);
    url.searchParams.set("client_id", p.clientId);
    url.searchParams.set("redirect_uri", redirectUri(p.id));
    url.searchParams.set("scope", p.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    return reply.redirect(url.toString());
  });

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>("/api/auth/:provider/callback", async (req, reply) => {
    const p = PROVIDERS[req.params.provider];
    if (!p || !p.clientId || !p.clientSecret) return reply.code(404).send({ error: "provider not configured" });
    const { code, state } = req.query;
    const expected = (req as any).cookies?.[`oauth_state_${p.id}`];
    if (!code || !state || state !== expected) return reply.code(400).send({ error: "invalid oauth state" });

    // exchange code → access token
    const tokenRes = await fetch(p.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: p.clientId,
        client_secret: p.clientSecret,
        code,
        redirect_uri: redirectUri(p.id),
        grant_type: "authorization_code",
      }),
    });
    const tokenJson: any = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) return reply.code(401).send({ error: "token exchange failed" });

    const identity = await p.fetchIdentity(accessToken);
    if (!identity) return reply.code(401).send({ error: "could not resolve a verified email from the IdP" });

    // link existing or JIT-provision (least privilege)
    let user = (await db.select().from(s.users).where(eq(s.users.email, identity.email)).limit(1))[0];
    if (!user) {
      [user] = await db.insert(s.users).values({ email: identity.email, name: identity.name, role: JIT_ROLE, authProvider: p.id }).returning();
      await db.insert(s.auditLog).values({ actorId: user.id, action: "sso-provision", targetType: "user", targetId: identity.email, payload: { provider: p.id, role: JIT_ROLE } });
    }
    if (user.expiresAt && user.expiresAt.getTime() < Date.now()) return reply.code(403).send({ error: "account expired" });

    const token = await createSession(user.id);
    setSessionCookie(reply, token);
    await db.insert(s.auditLog).values({ actorId: user.id, action: "login-sso", targetType: "user", targetId: user.email, payload: { provider: p.id } });
    (reply as any).clearCookie(`oauth_state_${p.id}`, { path: "/" });
    return reply.redirect(BASE_URL + "/");
  });
}
