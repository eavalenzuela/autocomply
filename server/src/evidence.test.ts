// The SSRF guard is the security-critical half of evidence ingress: it decides
// whether a caller-supplied URL can make this server talk to its own network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress, hashContent, captureInline, MAX_EVIDENCE_BYTES } from "./evidence";

test("isBlockedAddress: refuses loopback, private, link-local and reserved", () => {
  for (const ip of [
    "127.0.0.1", "127.9.9.9", "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.255", "192.168.1.1", "0.0.0.0",
    "169.254.169.254", // cloud metadata — the one that matters most
    "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1",
    "::ffff:169.254.169.254", // v4-mapped metadata address
    "::ffff:10.0.0.1",
    "not-an-ip", "",
  ]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
  }
});

test("isBlockedAddress: allows ordinary public addresses", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.32.0.1", "172.15.0.1", "2606:4700::1111"]) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
  }
});

test("hashContent: is sha256 over the actual bytes, and differs per content", () => {
  const a = hashContent(Buffer.from("policy v1"));
  const b = hashContent(Buffer.from("policy v2"));
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  // Recomputable from the same bytes — the property the old fake hash lacked.
  assert.equal(a, hashContent(Buffer.from("policy v1")));
});

test("captureInline: records true byte length and refuses oversized content", () => {
  const cap = captureInline("hello");
  assert.equal(cap.bytes, 5);
  assert.equal(cap.sourceUrl, null);
  assert.throws(() => captureInline("x".repeat(MAX_EVIDENCE_BYTES + 1)), /exceeds/);
});
