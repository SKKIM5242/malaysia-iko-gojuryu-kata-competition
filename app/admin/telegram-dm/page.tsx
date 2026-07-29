import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { AdminShell } from "@/components/admin";
import { SetupNotice, EmptyState } from "@/components/ui";
import { sendAdminTelegramDirectMessage } from "@/app/actions/admin";
import FilterableTable from "@/components/FilterableTable";

export const dynamic = "force-dynamic";

const RETURN_TO = "/admin/telegram-dm";

/** Same "staff-tier" access as the rest of /admin — Admin, Organizer,
 * Support, and Referee/Judge can all send a direct Telegram message here,
 * matching who the organizer asked to be able to. */
const SENDER_ROLES = ["admin", "organizer", "staff", "customer_support", "referee"];

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  organizer: "Organizer",
  staff: "Admin / Organizer (legacy)",
  customer_support: "Participant Support",
  referee: "Referee / Judge",
  participant: "Participant",
  school: "School / Dojo",
  sensei: "Sensei",
  audience: "Audience",
};

export default async function AdminTelegramDm({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Telegram DM" active="/admin/telegram-dm">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const canSend = SENDER_ROLES.includes(myProfile?.role ?? "");

  if (!canSend) {
    return (
      <AdminShell title="Telegram DM" active="/admin/telegram-dm">
        <p className="text-sm text-neutral-500">You don&apos;t have access to this page.</p>
      </AdminShell>
    );
  }

  const { data: recipients } = await supabase
    .from("profiles")
    .select("user_id, full_name, email, role")
    .not("telegram_chat_id", "is", null)
    .order("full_name");

  const cellInput = "w-full rounded-md border border-neutral-300 px-2 py-1 text-xs";

  return (
    <AdminShell title="Telegram DM" active="/admin/telegram-dm" flash={{ ok: params.ok, error: params.error }}>
      <p className="mb-2 text-sm text-neutral-500">
        Send a direct Telegram message to anyone who has connected Telegram to their account —
        available to Referee/Judge, Participant Support, Organizer, and Admin.
      </p>
      <p className="mb-6 text-xs text-neutral-400">
        Only people who have actually pressed &quot;Connect Telegram&quot; on their own Account page
        show up here — today that&apos;s just Referees (anytime) and Participants (once they&apos;ve
        submitted a recording). Everyone else has no way to connect yet, so there&apos;s nothing to
        DM them with — see the Telegram Link Reference table on the Content page for the full
        breakdown.
      </p>

      {(recipients ?? []).length === 0 ? (
        <EmptyState>
          Nobody has connected Telegram yet. Once a Referee or Participant presses &quot;Connect
          Telegram&quot; on their Account page, they&apos;ll show up here.
        </EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="telegram-dm-recipients"
          stickyColumns={1}
          columns={[
            { key: "name", label: "Name", width: 200 },
            { key: "email", label: "Email", width: 220 },
            { key: "role", label: "Role", width: 150 },
            { key: "message", label: "Message", width: 340, wrap: true },
            { key: "actions", label: "Actions", width: 110 },
          ]}
          rows={(recipients ?? []).map((r) => {
            const formId = `dm-${r.user_id}`;
            const name = (r.full_name as string | null) || "(no name on file)";
            return {
              id: r.user_id as string,
              name,
              email: (r.email as string | null) ?? "—",
              role: ROLE_LABEL[r.role as string] ?? (r.role as string) ?? "—",
              message: (
                <form id={formId} action={sendAdminTelegramDirectMessage}>
                  <input type="hidden" name="user_id" value={r.user_id as string} />
                  <input type="hidden" name="return_to" value={RETURN_TO} />
                  <textarea
                    form={formId}
                    name="message"
                    required
                    rows={2}
                    placeholder={`Message to ${name}...`}
                    className={cellInput}
                  />
                </form>
              ),
              actions: (
                <button
                  form={formId}
                  type="submit"
                  className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700"
                >
                  Send
                </button>
              ),
            };
          })}
        />
      )}
    </AdminShell>
  );
}
