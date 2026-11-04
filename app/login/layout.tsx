import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in", description: "Sign in to NYNZ or create an account to start building.", alternates: { canonical: "/login" } };
export default function LoginLayout({ children }: { children: React.ReactNode }) { return children; }
