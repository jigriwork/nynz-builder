import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NynzBrand } from "@/components/nynz-brand";
import { InformationLinks } from "@/components/information-links";
import { informationDocuments, contactAddresses } from "@/lib/public-information";

export function informationMetadata(slug:string):Metadata{
  const doc=informationDocuments[slug];if(!doc)notFound();
  return {title:doc.title,description:doc.description,alternates:{canonical:`/${slug}`},openGraph:{title:`${doc.title} · NYNZ`,description:doc.description,url:`/${slug}`},twitter:{title:`${doc.title} · NYNZ`,description:doc.description}};
}
export function InformationPage({slug}:{slug:string}){
  const doc=informationDocuments[slug];if(!doc)notFound();
  return <div className="nynz-dark min-h-screen bg-[#070b12] text-[#f4f1e8]">
    <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[#c7ff4a] focus:p-3 focus:text-[#071019]">Skip to content</a>
    <header className="mx-auto flex h-20 max-w-[1180px] items-center justify-between border-b border-white/[.08] px-5 md:px-8"><Link href="/" aria-label="NYNZ home"><NynzBrand className="h-7"/></Link><div className="flex items-center gap-5 text-sm"><Link href="/legal" className="text-white/60 hover:text-white">Policies</Link><Link href="/login" className="rounded-lg bg-[#c7ff4a] px-4 py-2 font-medium text-[#071019]">Sign in</Link></div></header>
    <main id="content" className="mx-auto max-w-[1180px] px-5 py-12 md:px-8 md:py-16">
      <div className="max-w-3xl"><p className="text-[11px] font-medium uppercase tracking-[.18em] text-[#c7ff4a]">NYNZ · {slug==="contact"?"Get in touch":"Policies & trust"}</p><h1 className="mt-4 text-4xl font-medium tracking-[-.05em] sm:text-6xl">{doc.title}</h1><p className="mt-5 text-base leading-7 text-white/60">{doc.description}</p>{slug!=="contact"&&<p className="mt-4 text-xs text-white/45">Effective and last updated: 4 November 2026</p>}</div>
      <div className="mt-12 grid min-w-0 gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        <aside><nav aria-label="On this page" className="flex flex-wrap gap-2 lg:sticky lg:top-8 lg:flex-col">{doc.sections.map((section,i)=><a key={section.title} href={`#section-${i+1}`} className="rounded-lg border border-white/[.08] px-3 py-2 text-xs leading-5 text-white/60 hover:border-[#c7ff4a]/40 hover:text-[#c7ff4a]">{section.title}</a>)}</nav></aside>
        <article className="min-w-0 max-w-3xl space-y-9">
          {slug==="contact"&&<div className="grid min-w-0 gap-3 sm:grid-cols-2">{contactAddresses.map(address=><a key={address.email} href={`mailto:${address.email}`} className="group min-w-0 rounded-2xl border border-white/[.1] bg-white/[.025] p-5 transition hover:border-[#c7ff4a]/45"><h2 className="text-base font-medium">{address.title}</h2><p className="mt-2 break-all text-sm text-[#c7ff4a]">{address.email} ↗</p><p className="mt-3 text-sm leading-6 text-white/55">{address.description}</p></a>)}</div>}
          {doc.sections.map((section,i)=><section key={section.title} id={`section-${i+1}`} className="scroll-mt-8"><h2 className="text-xl font-medium tracking-[-.025em]">{section.title}</h2>{section.paragraphs.map(paragraph=><p key={paragraph} className="mt-3 break-words text-[15px] leading-7 text-white/65">{paragraph}</p>)}</section>)}
          <div className="rounded-2xl border border-[#c7ff4a]/20 bg-[#c7ff4a]/[.035] p-5"><h2 className="font-medium">Need help?</h2><p className="mt-2 text-sm leading-6 text-white/60">Write to <a href={`mailto:${slug==="refund-policy"?"billing":"support"}@nynz.in`} className="text-[#c7ff4a] underline-offset-4 hover:underline">{slug==="refund-policy"?"billing":"support"}@nynz.in</a>, or visit our <Link href="/contact" className="text-[#c7ff4a] underline-offset-4 hover:underline">contact directory</Link>.</p></div>
        </article>
      </div>
    </main>
    <footer className="mx-auto max-w-[1180px] border-t border-white/[.08] px-5 py-8 md:px-8"><InformationLinks/><p className="mt-6 text-xs text-white/35">© {new Date().getUTCFullYear()} NYNZ</p></footer>
  </div>;
}
