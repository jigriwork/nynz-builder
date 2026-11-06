/** Read-only: Hostinger subscriptions (names, status, renewal) via the official API; token from the macOS Keychain. */
import { execFileSync } from "node:child_process";
const token = execFileSync("security", ["find-generic-password", "-s", "nynz-hostinger-api", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const get = async (path: string) => { const r = await fetch(`https://developers.hostinger.com${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }); return { status: r.status, body: r.ok ? await r.json() : (await r.text()).slice(0, 160) }; };
const subs = await get("/api/billing/v1/subscriptions");
console.log("subscriptions", subs.status, JSON.stringify(Array.isArray(subs.body) ? subs.body.map((s: any) => ({ name: s.name, status: s.status, expires_at: s.expires_at, renewal: s.is_auto_renewed })) : subs.body));
