/**
 * A static "first page" impression of a generated app, drawn from its own
 * title, heading and colours (public.my_project_cards). It never wakes a
 * sandbox, so it costs nothing and never shows a preview error.
 */
export type ProjectCard = { title: string | null; heading: string | null; background: string | null; colors: string[] | null };

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4));
  return .2126 * r + .7152 * g + .0722 * b;
}
const distance = (a: string, b: string) => [1, 3, 5].reduce((sum, i) => sum + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);

const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" } as Record<string, string>)[e]);

export function AppPoster({ card, name }: { card: ProjectCard; name: string }) {
  const background = card.background || "#f6f4ef";
  const dark = luminance(background) < .35;
  const ink = dark ? "#f4f1e8" : "#14181f";
  const palette = (card.colors || []).filter((c) => distance(c, background) > 90 && luminance(c) > .03 && luminance(c) < .9);
  const primary = palette[0] || (dark ? "#c7ff4a" : "#1f3d2f");
  const secondary = palette[1] || primary;
  const title = decode(card.title || name).split(/\s+[|—–-]\s+/)[0];
  const heading = decode(card.heading || name);
  return <div aria-hidden className="absolute inset-0 overflow-hidden" style={{ background }}>
    <div className="absolute inset-x-0 top-0 flex h-7 items-center gap-1.5 px-3" style={{ background: dark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.05)" }}>
      <i className="h-1.5 w-1.5 rounded-full" style={{ background: ink, opacity: .25 }} /><i className="h-1.5 w-1.5 rounded-full" style={{ background: ink, opacity: .15 }} />
    </div>
    <div className="absolute inset-x-0 bottom-0 top-7 px-4 pt-3 transition-transform duration-500 group-hover:-translate-y-1" style={{ color: ink }}>
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: primary }} />
        <span className="truncate text-[10px] font-semibold tracking-tight">{title}</span>
        <span className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[8px] font-semibold" style={{ background: primary, color: luminance(primary) > .45 ? "#14181f" : "#ffffff" }}>Open</span>
      </div>
      <p className="mt-3 line-clamp-2 text-[17px] font-semibold leading-[1.1] tracking-[-.02em]">{heading}</p>
      <span className="mt-2 block h-1 w-10 rounded-full" style={{ background: primary }} />
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {[primary, secondary, ink].map((c, i) => <span key={i} className="h-9 rounded-md" style={{ background: c, opacity: i === 2 ? .08 : i === 1 ? .35 : .9 }} />)}
      </div>
    </div>
  </div>;
}
