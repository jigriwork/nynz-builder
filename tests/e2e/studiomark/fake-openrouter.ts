/**
 * Scripted stand-in for the OpenRouter chat completions API, for the local
 * StudioMark recovery proof only. It answers planning, file, edit and
 * coverage requests from the fixture, records every request, and can be told
 * to cut off any request that includes a given file (as production did on
 * 2026-11-04), to slow down, or to report a higher cost.
 */
import { createServer } from "node:http";
import { EDIT_MANIFEST, MANIFEST, SMALL_MANIFEST, SMALL_SCREENS, fileContent } from "./fixture";
import { classesFromStylesRequest, heuristicCss } from "../../fixtures/heuristic-css";

export type Control = { cutOff: string[]; delayMs: number; costUsd: number; compileErrorOnce: boolean; coverageUnclear: boolean; app: "studiomark" | "small" };
export type Logged = { n: number; at: number; schema: string; paths: string[]; group: string[]; maxTokens: number; truncated: boolean; id: string; brief: boolean; body: string };

/** The questions the planner returns for a short, open brief such as "Build an orders app for my boutique." */
export const VAGUE_CLARIFY = {
  needed: true,
  questions: [
    { id: "data", question: "Should orders be kept only in this browser, or shared between your devices and staff?", why: "Sharing needs a database and sign-in, which changes how the whole app is built.", options: ["Only this browser", "Shared between devices"], recommended: "Only this browser" },
    { id: "people", question: "Will more than one person use it, with different permissions?", why: "Owner and staff roles add sign-in and permission checks to every screen.", options: ["Just me", "Owner and staff roles"], recommended: "Just me" },
  ],
  assumptions: ["Orders are kept only in this browser, with no sign-in or shared database", "One person uses it, so there are no roles or permissions"],
};

export function startFakeOpenRouter(port: number) {
  const control: Control = { cutOff: [], delayMs: 0, costUsd: 0.02, compileErrorOnce: false, coverageUnclear: false, app: "studiomark" };
  const log: Logged[] = [];
  let n = 0;
  const runId = Date.now().toString(36);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (req.url === "/__control" && req.method === "POST") { Object.assign(control, JSON.parse(raw)); res.end(JSON.stringify(control)); return; }
    if (req.url === "/__log") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(log)); return; }
    if (req.url !== "/api/v1/chat/completions") { res.statusCode = 404; res.end(); return; }
    const body = JSON.parse(raw);
    const schema: string = body.response_format?.json_schema?.name || "";
    const user: string = body.messages?.[1]?.content || "";
    // Provider ids are globally unique; the ledger refuses to charge one twice.
    const id = `gen-fixture-${runId}-${++n}`;
    const paths = (user.split("GENERATE THESE FILES NOW:\n")[1]?.split("\n\n")[0] || "").split("\n").map((line) => line.split(":")[0]).filter(Boolean);
    const group = (user.match(/EDIT ONLY THESE FILES IN THIS STEP: (.+?)\. Make every/)?.[1] || "").split(", ").filter(Boolean);
    let value: unknown;
    let truncated = false;
    let cutPath: string | null = null;
    if (schema === "nynz_manifest") {
      const base = /TASK MODE: edit/.test(user) ? EDIT_MANIFEST : control.app === "small" ? SMALL_MANIFEST : MANIFEST;
      // Like the planner rules: ask only for a short, open brief, never once decisions are final.
      const brief = user.split("PRODUCT BRIEF:\n")[1]?.split("\n\nEXISTING FILES:")[0] || "";
      const vague = !/DECISIONS ARE FINAL/.test(user) && brief.trim().length < 160 && !/decide yourself|FRONTEND ONLY/i.test(brief);
      value = { ...base, clarify: vague ? VAGUE_CLARIFY : { needed: false, questions: [], assumptions: [] } };
    }
    else if (schema === "nynz_coverage") value = { steps: (user.split("APPROVED PLAN STEPS:\n")[1]?.split("\n\n")[0] || "").split("\n").filter(Boolean).map((line, index) => ({ step: line.replace(/^\d+\.\s*/, ""), status: control.coverageUnclear && index === 0 ? "unclear" : "built", evidence: "src/App.tsx", note: control.coverageUnclear && index === 0 ? "toggle wiring not shown" : "" })) };
    else if (schema === "nynz_styles") value = { files: [{ path: "src/index.css", content: heuristicCss(classesFromStylesRequest(user)) }] };
    else if (schema === "nynz_edit") {
      const repair = /Fix these production compiler errors/.test(user);
      const edits = group.map((path) => {
        if (path === "src/App.tsx" && repair) return { path, search: "/* NYNZ_FIXTURE_COMPILE_ERROR */ ", replace: "" };
        if (path === "src/App.tsx") return { path, search: '<header className="topbar"><strong>StudioMark</strong>', replace: `<header className="topbar">${control.compileErrorOnce ? "/* NYNZ_FIXTURE_COMPILE_ERROR */ " : ""}<strong>StudioMark</strong><button type="button" className="theme-toggle" aria-label="Toggle dark theme">Dark theme</button>` };
        if (path === "src/index.css") return { path, search: ".meta{color:#6b6280}", replace: ".meta{color:#6b6280}.theme-toggle{margin-left:auto}.dark{background:#111;color:#eee}" };
        return { path, search: "</h1>", replace: "</h1>" };
      });
      if (control.compileErrorOnce && !repair) control.compileErrorOnce = false;
      value = { plan: EDIT_MANIFEST.plan, message: EDIT_MANIFEST.message, edits };
    } else {
      const files = paths.map((path) => ({ path, content: fileContent(path, control.app === "small" ? SMALL_SCREENS : undefined) }));
      value = { files };
      cutPath = paths.find((path) => control.cutOff.includes(path)) || null;
      truncated = Boolean(cutPath);
    }
    let content = JSON.stringify(value);
    if (truncated) {
      const marker = `{"path":"${cutPath}"`;
      content = content.slice(0, Math.max(10, content.indexOf(marker) + marker.length + 40));
    }
    log.push({ n, at: Date.now(), schema, paths, group, maxTokens: body.max_tokens, truncated, id, brief: /ORIGINAL PRODUCT BRIEF/.test(user), body: raw });
    if (control.delayMs) await new Promise((resolve) => setTimeout(resolve, control.delayMs));
    if (res.destroyed || !res.socket || res.socket.destroyed) return;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id, model: "anthropic/claude-sonnet-5.5", choices: [{ finish_reason: truncated ? "length" : "stop", message: { content } }], usage: { prompt_tokens: 4000, completion_tokens: truncated ? body.max_tokens : 3000, cost: control.costUsd } }));
  });
  return new Promise<{ control: Control; log: Logged[]; close: () => void }>((resolve) => server.listen(port, "127.0.0.1", () => resolve({ control, log, close: () => server.close() })));
}
