import { SiteFooter, SiteHeader } from "@/components/ui";
import { StaffForm } from "@/components/CommunityForms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin / Organizer / Customer Support registration" };

export default function RegisterStaffPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">
          Admin / Organizer / Customer Support registration
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Apply to join the organising or support team. Applications are reviewed and approved by
          the organiser before any access is granted.
        </p>
        <div className="mt-8">
          <StaffForm />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
