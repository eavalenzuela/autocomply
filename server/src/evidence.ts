// Evidence capture: fetch (or accept) content, hash the real bytes, snapshot it.
//
// This is the ingress the product never had. Two things it must get right:
//
//   1. The hash is over content that was genuinely retrieved. The hash this
//      codebase shipped was sha256(`${code}:${dim}:v1`) — a checksum of the
//      control's own name, which would satisfy an auditor's glance and prove
//      nothing. A hash that cannot be recomputed from bytes we hold is worse
//      than no hash, because it invites belief.
//
//   2. Fetching a caller-supplied URL from the server is SSRF. This service can
//      reach a Postgres on a private network and, in most deployments, a cloud
//      metadata endpoint. The guard below is deny-by-default on address, not on
//      hostname, and is re-checked after redirects.
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Hard cap on a captured document. Large enough for policies, small enough to store inline. */
export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export class EvidenceFetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "bad-url"
      | "blocked-address"
      | "too-large"
      | "timeout"
      | "unreachable"
      | "bad-status",
  ) {
    super(message);
  }
}

/** True for addresses no evidence source should ever live at. */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 0) return true; // not an address we can reason about — refuse

  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local — cloud metadata lives here
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 192 && b === 0) return true; // protocol assignments
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  const lower = ip.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) — judge the embedded v4 address.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("ff")) return true; // multicast
  return false;
}

/** Resolve a URL's host and refuse it if it points anywhere internal. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EvidenceFetchError("not a valid URL", "bad-url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EvidenceFetchError("only http and https sources can be captured", "bad-url");
  }
  // Check the ADDRESS, not the name: a hostname allowlist is defeated by DNS
  // that resolves to 169.254.169.254.
  let addrs;
  try {
    addrs = await lookup(url.hostname, { all: true });
  } catch {
    throw new EvidenceFetchError(`cannot resolve ${url.hostname}`, "unreachable");
  }
  for (const a of addrs) {
    if (isBlockedAddress(a.address)) {
      throw new EvidenceFetchError(
        `${url.hostname} resolves to a private or reserved address (${a.address})`,
        "blocked-address",
      );
    }
  }
  return url;
}

export interface Capture {
  content: string;
  contentHash: string;
  bytes: number;
  contentType: string | null;
  sourceUrl: string | null;
}

/** sha256 over the exact bytes we hold, labelled so the algorithm is legible. */
export function hashContent(buf: Buffer): string {
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}

/** Capture content the caller supplied directly (paste / upload). */
export function captureInline(content: string, contentType?: string): Capture {
  const buf = Buffer.from(content, "utf8");
  if (buf.byteLength > MAX_EVIDENCE_BYTES) {
    throw new EvidenceFetchError(`content exceeds ${MAX_EVIDENCE_BYTES} bytes`, "too-large");
  }
  return {
    content,
    contentHash: hashContent(buf),
    bytes: buf.byteLength,
    contentType: contentType ?? null,
    sourceUrl: null,
  };
}

/** Fetch a public URL and capture what actually came back. */
export async function captureUrl(raw: string): Promise<Capture> {
  let target = await assertPublicUrl(raw);

  for (let hop = 0; ; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(target, { redirect: "manual", signal: ctrl.signal });
    } catch (e: any) {
      throw new EvidenceFetchError(
        e?.name === "AbortError" ? "source timed out" : `could not reach source: ${e?.message ?? e}`,
        e?.name === "AbortError" ? "timeout" : "unreachable",
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new EvidenceFetchError(`redirect without a location (${res.status})`, "bad-status");
      if (hop >= MAX_REDIRECTS) throw new EvidenceFetchError("too many redirects", "bad-status");
      // Re-validate every hop: an open redirect to 169.254.169.254 is the
      // classic way past a check that only looked at the first URL.
      target = await assertPublicUrl(new URL(loc, target).toString());
      continue;
    }
    if (!res.ok) throw new EvidenceFetchError(`source returned ${res.status}`, "bad-status");

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_EVIDENCE_BYTES) {
      throw new EvidenceFetchError(`source is ${declared} bytes, over the ${MAX_EVIDENCE_BYTES} limit`, "too-large");
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // Declared length is a claim; the body is the fact.
    if (buf.byteLength > MAX_EVIDENCE_BYTES) {
      throw new EvidenceFetchError(`source body exceeds ${MAX_EVIDENCE_BYTES} bytes`, "too-large");
    }
    return {
      content: buf.toString("utf8"),
      contentHash: hashContent(buf),
      bytes: buf.byteLength,
      contentType: res.headers.get("content-type"),
      sourceUrl: target.toString(),
    };
  }
}
