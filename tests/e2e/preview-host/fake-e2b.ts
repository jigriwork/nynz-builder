/**
 * A stateful stand-in for the E2B control API and sandbox traffic, used to
 * drive the real preview host (preview-host/api/proxy.ts) locally. It keeps
 * each sandbox's exact running intervals, so billed time can be compared with
 * the time a sandbox actually ran.
 *
 * Behaviour modelled on E2B: connect resumes a paused sandbox, or extends a
 * running one to at least now + timeout; a running sandbox pauses when its
 * end time passes (onTimeout: pause); a killed sandbox returns 404.
 */
type Box = { runningSince: number | null; endAt: number; pausedAt: number | null; intervals: Array<[number, number]>; deleted: boolean; connects: number; resumes: number };

export class FakeE2B {
  readonly boxes = new Map<string, Box>();
  /** Every control-API call, in order: "connect <id> <timeout>", "info <id>", "kill <id>". */
  readonly calls: string[] = [];
  failNextConnect: number | null = null;

  private tick(id: string) {
    const box = this.boxes.get(id);
    if (box && box.runningSince !== null && Date.now() >= box.endAt) {
      box.intervals.push([box.runningSince, box.endAt]);
      box.pausedAt = box.endAt;
      box.runningSince = null;
    }
    return box;
  }

  create(id: string, timeoutSeconds: number, startedSecondsAgo = 0) {
    const start = Date.now() - startedSecondsAgo * 1000;
    this.boxes.set(id, { runningSince: start, endAt: start + timeoutSeconds * 1000, pausedAt: null, intervals: [], deleted: false, connects: 0, resumes: 0 });
  }

  connect(id: string, timeoutSeconds: number) {
    this.calls.push(`connect ${id} ${timeoutSeconds}`);
    const box = this.tick(id);
    if (this.failNextConnect) { const status = this.failNextConnect; this.failNextConnect = null; return { status }; }
    if (!box || box.deleted) return { status: 404 };
    box.connects += 1;
    const end = Date.now() + timeoutSeconds * 1000;
    if (box.runningSince === null) { box.runningSince = Date.now(); box.endAt = end; box.pausedAt = null; box.resumes += 1; }
    else box.endAt = Math.max(box.endAt, end);
    return { status: 200, body: { sandboxID: id, domain: "e2b.app", trafficAccessToken: `traffic-${id}` } };
  }

  info(id: string) {
    this.calls.push(`info ${id}`);
    const box = this.tick(id);
    if (!box || box.deleted) return { status: 404 };
    return { status: 200, body: box.runningSince !== null ? { sandboxID: id, state: "running", endAt: new Date(box.endAt).toISOString() } : { sandboxID: id, state: "paused", endAt: new Date(box.pausedAt!).toISOString() } };
  }

  kill(id: string) {
    this.calls.push(`kill ${id}`);
    const box = this.tick(id);
    if (!box || box.deleted) return false;
    if (box.runningSince !== null) box.intervals.push([box.runningSince, Date.now()]);
    box.runningSince = null; box.deleted = true;
    return true;
  }

  running(id: string) { const box = this.tick(id); return Boolean(box && box.runningSince !== null); }

  /** Seconds the sandbox has actually run. */
  ranSeconds(id: string) {
    const box = this.tick(id);
    if (!box) return 0;
    const done = box.intervals.reduce((sum, [a, b]) => sum + (b - a), 0);
    return (done + (box.runningSince !== null ? Date.now() - box.runningSince : 0)) / 1000;
  }

  /** Moves every recorded time into the past, as if `seconds` had elapsed. */
  shift(seconds: number) {
    const ms = seconds * 1000;
    for (const box of this.boxes.values()) {
      if (box.runningSince !== null) box.runningSince -= ms;
      box.endAt -= ms;
      if (box.pausedAt !== null) box.pausedAt -= ms;
      box.intervals = box.intervals.map(([a, b]) => [a - ms, b - ms]);
    }
  }

  /** Routes E2B traffic to this fake; everything else goes to the real network. */
  install() {
    const real = globalThis.fetch;
    const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "api.e2b.app") {
        const connect = url.pathname.match(/^\/v2\/sandboxes\/([^/]+)\/connect$/);
        if (connect && init?.method === "POST") { const r = this.connect(decodeURIComponent(connect[1]), JSON.parse(String(init.body)).timeout); return json(r.status, r.body); }
        const info = url.pathname.match(/^\/sandboxes\/([^/]+)$/);
        if (info) { const r = this.info(decodeURIComponent(info[1])); return json(r.status, r.body); }
        return json(404);
      }
      const traffic = url.hostname.match(/^5173-(.+)\.e2b\.app$/);
      if (traffic) {
        const id = traffic[1];
        const token = new Headers(init?.headers).get("e2b-traffic-access-token");
        if (token !== `traffic-${id}` || !this.running(id)) return new Response("sandbox not running", { status: 502 });
        return new Response(`<!doctype html><title>Fixture app</title><p>Served by ${id} at ${url.pathname}</p>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return real(input, init);
    }) as typeof fetch;
  }
}
