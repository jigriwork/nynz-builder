import Link from "next/link";
import { informationLinks } from "@/lib/public-information";

export function InformationLinks({ className="" }: { className?:string }) {
  return <nav aria-label="Policies and contact" className={`flex flex-wrap gap-x-5 gap-y-3 text-[13px] text-[#c9d2de] ${className}`}>{informationLinks.map(([href,label])=><Link key={href} href={href} className="rounded-sm transition hover:text-[#c7ff4a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c7ff4a]">{label}</Link>)}</nav>;
}
