import { getOpenCompetitions, getSchools, schemaReady } from "@/lib/data";
import { SetupNotice, SiteFooter, SiteHeader } from "@/components/ui";
import { SenseiForm } from "@/components/DirectoryForms";
import { getTelegramLink } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export const metadata = { title: "Register Sensei / Coach" };

export default async function RegisterSenseiPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string }>;
}) {
  const { by } = await searchParams;
  const ready = await schemaReady();
  const schools = ready ? await getSchools() : [];
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
        <h1 className="text-2xl font-bold tracking-tight">
          {by === "self" ? "Sensei / Coach Self-Registration" : "Sensei / Coach Registration"}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {by === "student"
            ? "Register your sensei / coach so you can select them when registering as a participant."
            : "Register the sensei / coach so participants can select them during registration."}
        </p>
        <div className="mt-8">
          {ready ? (
            <SenseiForm schools={schools} defaultBy={by} telegramLink={getTelegramLink("school")} tiers={tiers} />
          ) : (
            <SetupNotice />
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
