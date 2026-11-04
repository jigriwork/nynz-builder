import { AuthShell } from "@/components/auth/auth-shell";
import { NewPasswordForm } from "@/components/auth/new-password-form";

export const metadata = { title: "Choose a new password", robots: { index: false } };
export default function ResetPasswordPage() {
  return <AuthShell eyebrow="Account recovery" title="Choose a new password"><NewPasswordForm next="/dashboard" intro="Choose a new password for your NYNZ account. Other devices stay signed in until their sessions refresh; sign out everywhere from Account security if you think someone else had access." /></AuthShell>;
}
