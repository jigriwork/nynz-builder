import { describe, expect, it } from "vitest";
import { completeApplicationIdentity } from "../../lib/platform/identity";

describe("generated application identity", () => {
  it("replaces generic starter identity with the actual product and completes metadata", () => {
    const source = [{ path: "package.json", content: '{"name":"react-ts-vite"}' }, { path: "index.html", content: '<html><head><title>Vite + React</title></head><body></body></html>' }, { path: "src/App.tsx", content: "export default function App(){return <h1>Tipwise</h1>}" }];
    const files = completeApplicationIdentity(source, "A tip calculator");
    expect(files[0].content).toContain('"name": "tipwise"');
    expect(files[1].content).toContain("<title>Tipwise</title>");
    expect(files[1].content).toContain('name="description"');
    expect(files[1].content).toContain('rel="icon"');
    expect(source[0].content).toBe('{"name":"react-ts-vite"}');
  });
  it("preserves a specific customer title, package and icon", () => {
    const html = '<html><head><title>LUMÉRA</title><meta name="description" content="Salon bookings"/><link rel="icon" href="/logo.svg"/></head></html>';
    const files = completeApplicationIdentity([{ path: "package.json", content: '{"name":"lumera"}' }, { path: "index.html", content: html }], "Salon");
    expect(files[1].content).toBe(html);
    expect(JSON.parse(files[0].content).name).toBe("lumera");
  });
  it("rejects inherited platform badges before promotion", () => {
    expect(() => completeApplicationIdentity([{ path: "package.json", content: "{}" }, { path: "index.html", content: "<footer>Powered by Lovable</footer>" }], "App")).toThrow(/inherited platform branding/);
  });
});
