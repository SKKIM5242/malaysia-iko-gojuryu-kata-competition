import { schemaReady } from "@/lib/data";
import { AdminShell } from "@/components/admin";
import { EmptyState, SetupNotice, TelegramFullAccessLinks } from "@/components/ui";
import { getAllTelegramLinks } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export default async function AdminTelegramLinks() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Telegram Links" active="/admin/telegram">
        <SetupNotice />
      </AdminShell>
    );
  }

  const links = getAllTelegramLinks();

  return (
    <AdminShell title="Telegram Links" active="/admin/telegram">
      <p className="mb-6 text-sm text-neutral-500">
        Every registration category&apos;s dedicated Telegram group in one place. Admin/Organizer,
        Referee/Judge, and Participant Support accounts get full access here since they moderate or judge
        across the whole competition — participants only see their own category&apos;s group, from their{" "}
        <code className="rounded bg-neutral-100 px-1">/account</code> page.
      </p>
      {links.length === 0 ? (
        <EmptyState>
          No Telegram groups configured yet — set the <code className="rounded bg-neutral-100 px-1">TELEGRAM_GROUP_*</code>{" "}
          environment variables in Vercel to enable them.
        </EmptyState>
      ) : (
        <TelegramFullAccessLinks links={links} />
      )}
    </AdminShell>
  );
}
