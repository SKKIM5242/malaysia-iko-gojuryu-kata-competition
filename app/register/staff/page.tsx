import { SiteFooter, SiteHeader } from "@/components/ui";
import { StaffForm } from "@/components/CommunityForms";
import { getTelegramLink } from "@/lib/telegram";
import { getAllCompetitions } from "@/lib/admin-data";

export const dynamic = "force-dynamic";

export const metadata = { title: "Organizer / Participant Support registration" };

export default async function RegisterStaffPage() {
  const competitions = await getAllCompetitions();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">
          Organizer / Participant Support Registration
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Apply to join the organising or support team. Applications are reviewed and approved by
          the organizer before any access is granted.
        </p>
        <div className="mt-8">
          <StaffForm telegramLink={getTelegramLink("staff")} competitions={competitions} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
