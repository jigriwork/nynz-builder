/**
 * Hostinger DNS helper (official API, https://developers.hostinger.com).
 * The API token is read from the macOS Keychain inside this process and is
 * never printed, logged or written to disk:
 *   security add-generic-password -a "$USER" -s nynz-hostinger-api -w
 * (macOS then prompts for the token without echoing it.)
 *
 *   tsx scripts/ops/hostinger-dns.ts check              # token works? (no zone output)
 *   tsx scripts/ops/hostinger-dns.ts backup <file>      # save the full current zone (mode 600)
 *   tsx scripts/ops/hostinger-dns.ts plan <records.json>    # show which of the records are new / conflicting
 *   tsx scripts/ops/hostinger-dns.ts apply <records.json>   # validate, then add ONLY these records (overwrite=false)
 *   tsx scripts/ops/hostinger-dns.ts show <name>        # current records for one name
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DOMAIN = process.env.NYNZ_DNS_DOMAIN || "nynz.in";
type RRset = { name: string; type: string; ttl?: number; records: Array<{ content: string; is_disabled?: boolean }> };

function token() {
  try { return execFileSync("security", ["find-generic-password", "-s", "nynz-hostinger-api", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { throw new Error("No Hostinger token in the macOS Keychain (service nynz-hostinger-api)."); }
}
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://developers.hostinger.com${path}`, { method, headers: { authorization: `Bearer ${token()}`, "content-type": "application/json", accept: "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Hostinger ${method} ${path} failed: HTTP ${response.status} ${text.slice(0, 300).replace(/Bearer\s+\S+/g, "Bearer [redacted]")}`);
  return (text ? JSON.parse(text) : null) as T;
}
const zone = () => api<RRset[]>("GET", `/api/dns/v1/zones/${DOMAIN}`);
const norm = (v: string) => v.trim().toLowerCase().replace(/\.$/, "");

async function main() {
  const [mode, arg] = process.argv.slice(2);
  if (mode === "check") { const z = await zone(); console.log(`token ok; ${DOMAIN} has ${z.length} record sets`); return; }
  if (mode === "backup") {
    const z = await zone();
    writeFileSync(arg, JSON.stringify({ domain: DOMAIN, savedAt: new Date().toISOString(), zone: z }, null, 2), { mode: 0o600 });
    const summary = z.reduce<Record<string, number>>((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {});
    console.log(`saved ${z.length} record sets to ${arg}: ${JSON.stringify(summary)}`);
    return;
  }
  if (mode === "show") { const z = await zone(); console.log(JSON.stringify(z.filter((r) => norm(r.name) === norm(arg)), null, 1)); return; }
  const wanted = JSON.parse(readFileSync(arg, "utf8")) as RRset[];
  const z = await zone();
  const plan = wanted.map((w) => {
    const sameName = z.filter((r) => norm(r.name) === norm(w.name));
    const exact = sameName.find((r) => r.type === w.type && w.records.every((x) => r.records.some((y) => norm(y.content) === norm(x.content))));
    const conflict = sameName.filter((r) => r.type !== w.type || !exact);
    return { ...w, status: exact ? "present" : conflict.length ? "conflict" : "new", conflict: conflict.map((r) => `${r.type} ${r.records.map((x) => x.content).join(",")}`) };
  });
  for (const p of plan) console.log(`${p.status.padEnd(8)} ${p.type.padEnd(5)} ${p.name} -> ${p.records.map((r) => r.content).join(", ")}${p.conflict.length ? `  (existing: ${p.conflict.join("; ")})` : ""}`);
  if (mode === "plan") return;
  if (mode !== "apply") throw new Error("unknown mode");
  if (plan.some((p) => p.status === "conflict")) throw new Error("Refusing to apply: a wanted name already has other records. Resolve manually.");
  const toAdd = plan.filter((p) => p.status === "new").map(({ name, type, ttl, records }) => ({ name, type, ttl: ttl || 300, records }));
  if (!toAdd.length) { console.log("nothing to add"); return; }
  await api("POST", `/api/dns/v1/zones/${DOMAIN}/validate`, { overwrite: false, zone: toAdd });
  console.log("validated by Hostinger");
  await api("PUT", `/api/dns/v1/zones/${DOMAIN}`, { overwrite: false, zone: toAdd });
  const after = await zone();
  const untouched = z.every((r) => after.some((a) => norm(a.name) === norm(r.name) && a.type === r.type && r.records.every((x) => a.records.some((y) => norm(y.content) === norm(x.content)))));
  console.log(`applied ${toAdd.length} record set(s); all ${z.length} previous record sets still present: ${untouched}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
