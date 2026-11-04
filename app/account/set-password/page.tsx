import { AuthShell } from "@/components/auth/auth-shell";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { safeNext } from "@/lib/http/safe-next";

export const metadata = { title: "Activate your account", robots: { index: false } };
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const next = safeNext((await searchParams).then);
  return <AuthShell eyebrow="Account activation" title="Choose your password"><NewPasswordForm next={next} intro="Your email address is verified. Choose a password to finish activating your NYNZ account." /></AuthShell>;
}
