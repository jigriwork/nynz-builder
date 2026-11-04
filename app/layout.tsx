import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { SITE_URL } from "@/lib/site";
import { SHARE_TITLE, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/seo";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const geistSans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-geist-sans", weight: "100 900" });
const geistMono = localFont({ src: "./fonts/GeistMonoVF.woff", variable: "--font-geist-mono", weight: "100 900" });
const robotoMono = Roboto_Mono({ subsets: ["latin"], variable: "--font-roboto-mono" });


export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: "%s · NYNZ" },
  description: SITE_DESCRIPTION,
  applicationName: "NYNZ",
  appleWebApp: { capable: true, title: "NYNZ", statusBarStyle: "black-translucent" },
  alternates: { canonical: "/" },
  keywords: ["AI app builder", "build web apps with AI", "no-code app builder", "React app generator", "app builder India", "NYNZ"],
  openGraph: { type: "website", siteName: "NYNZ", url: "/", title: SHARE_TITLE, description: SITE_DESCRIPTION, locale: "en_IN" },
  twitter: { card: "summary_large_image", title: SHARE_TITLE, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  formatDetection: { telephone: false, email: false, address: false },
};

const JSON_LD = JSON.stringify([
  { "@context": "https://schema.org", "@type": "Organization", name: "NYNZ", url: SITE_URL, logo: `${SITE_URL}/brand/app-icon-512.png` },
  { "@context": "https://schema.org", "@type": "WebSite", name: "NYNZ", url: SITE_URL },
]).replace(/</g, "\\u003c");

export const viewport: Viewport = { themeColor: "#070b12", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${geistSans.variable} ${geistMono.variable} ${robotoMono.variable} font-sans`}>{children}<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} /></body>
    </html>
  );
}
