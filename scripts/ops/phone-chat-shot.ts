/** Read-only: the builder's Chat tab on a phone for one project, previews blocked. PROJECT=<id> OUT=<file> */
import { ownerContext } from "./owner-browser";
const context = await ownerContext(true, { width: 390, height: 844 });
await context.route(/\.preview\.nynz\.in|\/preview-session/, (route) => route.abort());
const page = await context.newPage();
await page.goto(`https://www.nynz.in/projects/${process.env.PROJECT}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Chat" }).first().click().catch(() => undefined);
await page.waitForTimeout(1500);
await page.getByTestId("build-timeline").first().scrollIntoViewIfNeeded().catch(() => undefined);
await page.screenshot({ path: process.env.OUT! });
console.log((await page.getByTestId("build-timeline").first().innerText()).replace(/\s+/g, " "));
await context.close();
