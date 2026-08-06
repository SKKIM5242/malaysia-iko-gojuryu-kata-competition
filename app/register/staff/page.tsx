import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { StaffForm } from "@/components/CommunityForms";
import { getTelegramLink } from "@/lib/telegram";
import { getAllCompetitions } from "@/lib/admin-data";

export const dynamic = "force-dynamic";

export const metadata = { title: "Participant Support registration" };

export default async function RegisterStaffPage() {
  const competitions = await getAllCompetitions();
  const telegramLink = await getTelegramLink("staff");
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">
          Participant Support Registration
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Apply to join the organising or support team. Applications are reviewed and approved by
          the organizer before any access is granted.
        </p>
        <div className="mt-8">
          <StaffForm telegramLink={telegramLink} competitions={competitions} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
