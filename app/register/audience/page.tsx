import { SiteFooter, SiteHeader } from "@/components/ui";
import { AudienceForm } from "@/components/CommunityForms";
import { getTelegramLink } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export const metadata = { title: "Audience / Spectator registration" };

export default function RegisterAudiencePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">
          Audience / Onlooker / Visitor / Spectator registration
        </h1>
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>USD 10 per sign-in</strong>, or <strong>USD 0 with an invitation code</strong>{" "}
          (by invitation only). The organiser confirms your payment and shares viewing access.
        </div>
        <div className="mt-8">
          <AudienceForm telegramLink={getTelegramLink("audience")} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
