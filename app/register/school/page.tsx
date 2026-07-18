import { getOpenCompetitions, schemaReady } from "@/lib/data";
import { SetupNotice, SiteFooter, SiteHeader } from "@/components/ui";
import { SchoolForm } from "@/components/DirectoryForms";
import { getTelegramLink } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export const metadata = { title: "Register School / Dojo" };

export default async function RegisterSchoolPage() {
  const ready = await schemaReady();
  const tiers = ready
    ? (await getOpenCompetitions()).map((c) => ({
        id: c.id,
        name: c.name,
        fee: Number(c.registration_fee_usd ?? 0),
      }))
    : [];
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">School / Dojo Registration</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Register your school or dojo so your sensei and participants can select it during
          registration. The one-time registration fee follows your competition tier — USD 10 /
          USD 100 / USD 200.
        </p>
        <div className="mt-8">
          {ready ? <SchoolForm telegramLink={getTelegramLink("school")} tiers={tiers} /> : <SetupNotice />}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
