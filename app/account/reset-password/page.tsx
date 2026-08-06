import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-10">
        <ResetPasswordForm />
      </main>
      <SiteFooter />
    </>
  );
}
