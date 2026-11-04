import { pageMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = pageMetadata({ title: "Sign in", description: "Sign in to NYNZ or create an account to start building your app.", path: "/login" });
export default function LoginLayout({ children }: { children: React.ReactNode }) { return children; }
