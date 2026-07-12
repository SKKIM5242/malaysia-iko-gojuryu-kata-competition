import { SiteFooter, SiteHeader } from "@/components/ui";
import { RefereeForm } from "@/components/CommunityForms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Referee / Judge registration" };

export default function RegisterRefereePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Referee / Judge registration</h1>
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            <strong>Fee: USD 100 deposit</strong>, or <strong>USD 0 with an invitation code</strong>{" "}
            (by invitation only).
          </p>
          <p className="mt-1">
            <strong>Note:</strong> the USD 100 is a <strong>deposit for participants</strong>. For
            non-participants the USD 100 will be <strong>forfeited</strong>. The deposit is returned —
            together with your referee/judge reward — to the bank account you provide below.
          </p>
        </div>
        <div className="mt-8">
          <RefereeForm />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
