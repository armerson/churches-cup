import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="text-sm text-zinc-500">Enter the email address you used to create your account.</p>
      <ForgotPasswordForm />
      <Link href="/sign-in" className="text-sm underline">Back to sign in</Link>
    </main>
  );
}
