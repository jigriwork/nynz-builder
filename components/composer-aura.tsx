/**
 * Motion behind a composer: thin outlines shaped like the composer ripple
 * outward from behind it and fade, one after another, like a launch pulse.
 * Transform and opacity only, clipped so nothing widens the page, paused while
 * someone types, and hidden with reduced motion. Place inside a relative
 * wrapper, before the composer, so the composer sits on top.
 */
const RINGS = ["border-[#c7ff4a]/45", "border-[#8cc4ee]/40", "border-[#c7ff4a]/35", "border-[#f4f1e8]/25"];

export function ComposerAura({ radius = "rounded-[26px]" }: { radius?: string }) {
  return <div aria-hidden className="nynz-ripples pointer-events-none absolute -inset-x-5 -inset-y-24 overflow-hidden sm:-inset-x-28 sm:-inset-y-28">
    {RINGS.map((tone, index) => <span key={index} className={`nynz-ripple absolute inset-x-5 inset-y-24 border sm:inset-x-28 sm:inset-y-28 ${radius} ${tone}`} style={{ animationDelay: `${index * 1.15}s` }} />)}
  </div>;
}
