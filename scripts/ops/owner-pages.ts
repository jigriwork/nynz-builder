/** Read-only: which admin pages the saved owner session can open. */
import { ownerContext, whoAmI } from "./owner-browser";
const context = await ownerContext(true);
const who = await whoAmI(context);
const page = await context.newPage();
for (const path of ["/admin", "/admin/users", "/admin/waitlist"]) {
  await page.goto(`https://www.nynz.in${path}`, { waitUntil: "networkidle" });
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log(path, "->", new URL(page.url()).pathname, /404|hasn.t been built/.test(text) ? "404" : text.slice(0, 80));
}
console.log("signed in:", who.signedIn);
await context.close();
