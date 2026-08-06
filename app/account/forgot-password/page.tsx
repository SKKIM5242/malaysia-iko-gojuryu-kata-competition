import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-10">
        <ForgotPasswordForm />
      </main>
      <SiteFooter />
    </>
  );
}
