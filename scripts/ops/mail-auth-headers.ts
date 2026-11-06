/** Read-only: sender-authentication headers of the newest email in a test inbox (no body, no links). */
import { readFileSync } from "node:fs";
const st = JSON.parse(readFileSync(`${process.env.STATE}`, "utf8"));
const inbox = st.inviteInbox || st.inbox;
const API = "https://api.mail.tm";
const token = (await (await fetch(`${API}/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(inbox) })).json()).token;
const list = await (await fetch(`${API}/messages`, { headers: { authorization: `Bearer ${token}` } })).json();
const m = list["hydra:member"][0];
const src = await (await fetch(`${API}/sources/${m.id}`, { headers: { authorization: `Bearer ${token}` } })).json().catch(() => null);
const raw: string = src?.data || "";
const head = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
const pick = (name: string) => head.split(/\r?\n/).filter((l) => l.toLowerCase().startsWith(name.toLowerCase() + ":")).map((l) => l.slice(0, 220));
console.log(`subject: ${m.subject}`);
for (const h of ["From", "Return-Path", "Authentication-Results", "Received-SPF", "ARC-Authentication-Results"]) for (const l of pick(h)) console.log(l);
const dkim = pick("DKIM-Signature").map((l) => (l.match(/\bd=([^;\s]+)/) || [])[1]);
console.log(`DKIM-Signature domains: ${dkim.join(", ") || "none"}`);
