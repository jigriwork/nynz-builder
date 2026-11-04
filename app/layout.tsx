import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { SITE_URL } from "@/lib/site";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const geistSans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-geist-sans", weight: "100 900" });
const geistMono = localFont({ src: "./fonts/GeistMonoVF.woff", variable: "--font-geist-mono", weight: "100 900" });
const robotoMono = Roboto_Mono({ subsets: ["latin"], variable: "--font-roboto-mono" });

const DESCRIPTION = "Describe a web app, approve the plan, and NYNZ builds real React source you can preview, edit and export.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "NYNZ: build real web apps from a brief", template: "%s · NYNZ" },
  description: DESCRIPTION,
  applicationName: "NYNZ",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "NYNZ", url: "/", title: "NYNZ: build real web apps from a brief", description: DESCRIPTION, locale: "en_IN" },
  twitter: { card: "summary_large_image", title: "NYNZ: build real web apps from a brief", description: DESCRIPTION },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = { themeColor: "#070b12", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${geistSans.variable} ${geistMono.variable} ${robotoMono.variable} font-sans`}>{children}</body>
    </html>
  );
}
