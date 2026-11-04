import { AuthShell } from "@/components/auth/auth-shell";

export const metadata = { title: "Account suspended", robots: { index: false } };
export default function SuspendedPage() {
  return <AuthShell eyebrow="Account" title="This account is suspended" back={{ href: "/", label: "NYNZ home" }}>
    <p className="text-sm leading-6 text-white/65">Access to projects, previews and builds is paused for this account. Your files are kept. If you think this is a mistake, contact NYNZ support from the email address on the account.</p>
  </AuthShell>;
}
