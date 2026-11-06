/** Read-only: redirect targets (no tokens) of the test inbox's emails. */
import { readFileSync } from "node:fs";
const st = JSON.parse(readFileSync(`${process.env.LIVE_DIR}/state.json`, "utf8"));
const API = "https://api.mail.tm";
const token = (await (await fetch(`${API}/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(st.inbox) })).json()).token;
const list = await (await fetch(`${API}/messages`, { headers: { authorization: `Bearer ${token}` } })).json();
for (const m of list["hydra:member"]) {
  const msg = await (await fetch(`${API}/messages/${m.id}`, { headers: { authorization: `Bearer ${token}` } })).json();
  const body = [msg.html?.join?.("") || "", msg.text || ""].join("\n").replace(/&amp;/g, "&");
  const link = (body.match(/https:\/\/[^\s"'<>]+(?:verify|confirm|callback)[^\s"'<>]*/) || [""])[0];
  const u = new URL(link);
  console.log(msg.subject, "| link host:", u.host + u.pathname, "| type:", u.searchParams.get("type"), "| redirect_to:", u.searchParams.get("redirect_to"));
}
