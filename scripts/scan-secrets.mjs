#!/usr/bin/env node
// Secret scanner for git-tracked files. Exits 1 with file:line for every hit.
// Usage: pnpm secrets:scan            (scans `git ls-files`)
//        node scripts/scan-secrets.mjs <file...>   (scan explicit files; used to self-check rules)
// No dependencies on purpose: it runs in CI before anything else is trusted.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const SELF = 'scripts/scan-secrets.mjs';
const MAX_BYTES = 2 * 1024 * 1024;
// Lockfile integrity hashes and generated migration snapshots are high-entropy by nature.
const SKIP = [/^pnpm-lock\.yaml$/, /^drizzle\/meta\//, /(^|\/)node_modules\//];
// Generic entropy rule is noisy in fixtures and prose; the specific patterns still run there.
const NO_GENERIC = [/^tests\//, /\.md$/, /\.test\.ts$/];

const PLACEHOLDER = /^(|x+|\*+|changeme|change-me.*|password|pass|secret|postgres|example.*|placeholder|dummy|fake|test.*|your[-_a-z]*|redacted|null|undefined)$/i;

/** Known-format rules: any match is a hit unless the captured secret is a placeholder. */
const RULES = [
  { name: 'private key block', re: /-{5}BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-{5}/ },
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'AWS secret access key', re: /aws_?secret_?access_?key["'\s:=]+([A-Za-z0-9/+=]{40})\b/i, group: 1 },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9_]{16,}\b/ },
  { name: 'Upstash REST token', re: /UPSTASH_REDIS_REST_TOKEN\s*[=:]\s*["']?([A-Za-z0-9_\-=]{20,})/, group: 1 },
  { name: 'Vercel Blob token', re: /\bvercel_blob_rw_[A-Za-z0-9]{10,}_[A-Za-z0-9]{20,}\b/ },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'Stripe live key', re: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'Sentry DSN with key', re: /https:\/\/[0-9a-f]{32}@[a-z0-9.-]*sentry\.io\/\d+/ },
  {
    // postgres://user:password@host — hits unless the password is a placeholder or the host is local.
    name: 'Postgres URL with password',
    re: /postgres(?:ql)?:\/\/[^:\s/@'"]+:([^@\s'"]+)@([^/\s:'"?]+)/,
    group: 1,
    allow: (m) => /^(localhost|127\.0\.0\.1|postgres|db|\[?::1\]?)$/.test(m[2] ?? '') || /^\$\{?|^<|\*\*\*/.test(m[1] ?? ''),
  },
];

// Generic: SECRET/TOKEN/KEY/PASSWORD assigned a long, high-entropy literal.
const GENERIC = /\b([A-Z0-9_]*(?:SECRET|TOKEN|API_?KEY|PASSWORD|PASSWD|PRIVATE_KEY)[A-Z0-9_]*)\b\s*[:=]\s*["'`]?([A-Za-z0-9+/=_\-.]{24,})["'`]?/i;

function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function mask(s) {
  return s.length <= 8 ? '***' : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`;
}

function isEnvFile(path) {
  const name = basename(path);
  return /^\.env(\..+)?$/.test(name) && !/\.(example|sample|template)$/.test(name);
}

function scanText(path, text, hits) {
  const generic = !NO_GENERIC.some((r) => r.test(path));
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/secrets-scan:\s*allow/.test(line)) return;
    for (const rule of RULES) {
      const m = line.match(rule.re);
      if (!m) continue;
      const secret = rule.group ? (m[rule.group] ?? '') : m[0];
      if (rule.group && PLACEHOLDER.test(secret)) continue;
      if (rule.allow?.(m)) continue;
      hits.push(`${path}:${i + 1}: ${rule.name}: ${mask(secret)}`);
    }
    if (!generic) return;
    const g = line.match(GENERIC);
    if (!g) return;
    const value = g[2] ?? '';
    if (PLACEHOLDER.test(value) || /^(process\.env|getEnv|env\.|import|require)/.test(value)) return;
    if (/^[a-z]+(?:[-_.][a-z0-9]+)+$/.test(value)) return; // kebab/snake identifiers, not secrets
    if (entropy(value) >= 4.2) hits.push(`${path}:${i + 1}: high-entropy value for ${g[1]}: ${mask(value)}`);
  });
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

const explicit = process.argv.slice(2);
const files = explicit.length > 0 ? explicit : trackedFiles();
const hits = [];

for (const raw of files) {
  const path = raw.replace(/\\/g, '/');
  if (explicit.length === 0 && (path === SELF || SKIP.some((r) => r.test(path)))) continue;
  if (isEnvFile(path)) {
    hits.push(`${path}:1: tracked .env file (must be gitignored)`);
    continue;
  }
  let st;
  try {
    st = statSync(raw);
  } catch {
    continue; // deleted in the working tree but still in the index
  }
  if (!st.isFile() || st.size > MAX_BYTES) continue;
  const buf = readFileSync(raw);
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  scanText(path, buf.toString('utf8'), hits);
}

if (hits.length > 0) {
  console.error(`secrets:scan found ${hits.length} potential secret(s):`);
  for (const h of hits) console.error(`  ${h}`);
  console.error('Remove the secret (and rotate it), or mark a known-safe line with "secrets-scan: allow".');
  process.exit(1);
}
console.log(`secrets:scan ok (${files.length} files)`);
