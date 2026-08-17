import type { ReactNode } from "react";
import TelegramBotUsernameField from "@/components/TelegramBotUsernameField";

/**
 * The Telegram BOT record — deliberately a sibling of the Telegram GROUPS
 * table above it on the same page, because the two are constantly confused
 * and they work in completely different ways:
 *
 *  - a GROUP link is something a person clicks to join a shared room;
 *  - the BOT is a one-to-one channel that only exists after that specific
 *    person presses "Connect Telegram" on their own account page, which is
 *    what hands us their private chat id.
 *
 * Nothing here is editable, and that is on purpose: the bot's identity comes
 * from environment variables (TELEGRAM_BOT_TOKEN above all, which is a
 * secret and must never be rendered into a page), so the honest thing to
 * show is the live wiring — what is set, what the resulting link is, who is
 * actually connected — plus the exact steps to change it.
 */

function StatusChip({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
        (ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")
      }
    >
      {ok ? "✅" : "❌"} {children}
    </span>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="break-all rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700">
      {children}
    </code>
  );
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  organizer: "Organizer",
  staff: "Admin / Organizer (legacy)",
  customer_support: "Participant Support",
  referee: "Judge",
  participant: "Participant",
  school: "School / Dojo",
  sensei: "Sensei / Coach",
  audience: "Audience",
};

/** Every route into the bot, and what it actually sends. Kept as data rather
 * than hand-written rows so the DM rows and the group-post rows can't drift
 * apart visually — the distinction between the two is the single thing
 * people get wrong about this bot. */
const LINKED_BUTTONS: Array<{
  who: string;
  button: string;
  where: string;
  sends: string;
  kind: "dm" | "group";
}> = [
  {
    who: "Admin · Organizer · Participant Support",
    button: "“Connect Telegram for admin alerts”",
    where: "My Account → approved-staff panel",
    sends:
      "New issue reports · testimonial removal notices · bulk upload results (Schools/Senseis/Judges/Audience/Participants) · sensei CSV received · bulk payment confirmed",
    kind: "dm",
  },
  {
    who: "Judge",
    button: "“Connect Telegram for assignment notifications”",
    where: "My Account → referee panel",
    sends:
      "You’ve been assigned a recording to judge · you’ve been unassigned (forfeit / not-forfeit) · certificates published",
    kind: "dm",
  },
  {
    who: "School / Dojo",
    button: "“Connect Telegram for certificate alerts”",
    where: "My Account → paid School panel",
    sends: "Certificates published · registration status changes",
    kind: "dm",
  },
  {
    who: "Sensei / Coach",
    button: "“Connect Telegram for bulk upload & certificate alerts”",
    where: "My Account → paid Sensei panel",
    sends: "Bulk upload confirmations · certificates published · registration status changes",
    kind: "dm",
  },
  {
    who: "Participant",
    button: "“Connect Telegram for judging alerts”",
    where: "My Account → after a kata recording has been submitted",
    sends:
      "Every judge has scored your recording · certificates published · payment / registration status changes",
    kind: "dm",
  },
  {
    who: "Anyone already connected",
    button: "“Send” (staff-initiated — no button on their side)",
    where: "Admin → Telegram DM",
    sends: "A free-text direct message written by Admin, Organizer, Support or Judge",
    kind: "dm",
  },
  {
    who: "Participant",
    button: "“💬 Telegram” (staff-initiated)",
    where: "Admin → Participants → Telegram DM column",
    sends:
      "Free-text feedback from Admin / Organizer / Support — a copy of every send, and every failure, is recorded against that participant",
    kind: "dm",
  },
  {
    who: "The person who filed an issue report",
    button: "“Reply via Telegram DM” (staff-initiated)",
    where: "Admin → Issue Reports",
    sends: "Staff’s reply to that specific report",
    kind: "dm",
  },
  {
    who: "A whole category’s group",
    button: "“Publish” on an announcement",
    where: "Admin → Announcements",
    sends: "The announcement text, posted into the group — not a DM",
    kind: "group",
  },
  {
    who: "A whole category’s group",
    button: "Winners announced (automatic, on the judging timeline)",
    where: "Cron → judging timeline",
    sends: "“Winners have been announced” notice, posted into the group — not a DM",
    kind: "group",
  },
  {
    who: "A whole category’s group",
    button: "“Notify Telegram group” on an issue report",
    where: "Admin → Issue Reports",
    sends: "The report summary, posted into the chosen group — not a DM",
    kind: "group",
  },
];

export default function TelegramBotGuide({
  botUsername,
  tokenSet,
  webhookSecretSet,
  appUrl,
  connectedByRole,
  canEdit,
  returnTo,
}: {
  botUsername: string | null;
  tokenSet: boolean;
  webhookSecretSet: boolean;
  appUrl: string;
  connectedByRole: Array<{ role: string; count: number }>;
  canEdit: boolean;
  returnTo: string;
}) {
  const botLink = botUsername ? `https://t.me/${botUsername}` : null;
  const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/telegram-webhook`;
  const totalConnected = connectedByRole.reduce((sum, r) => sum + r.count, 0);
  const fullyWired = Boolean(botUsername) && tokenSet && webhookSecretSet;

  const headerCell = "px-2 py-1.5 text-left align-top text-[11px] font-bold uppercase tracking-wide text-neutral-500";
  const bodyCell = "px-2 py-2 align-top text-xs text-neutral-700";

  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold text-neutral-800">Telegram Bot</h2>
      <p className="mt-1 text-sm text-neutral-500">
        The groups above are rooms people <em>join</em>. The bot below is the one-to-one channel
        that sends each person their own alerts — assignment notices, judging results, issue
        reports, certificate releases, and direct messages from staff.
      </p>

      {/* ── The record itself ─────────────────────────────────────────── */}
      <div className="mt-4 rounded-lg border border-neutral-200">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            Bot record
          </span>
          <StatusChip ok={Boolean(botUsername)}>TELEGRAM_BOT_USERNAME</StatusChip>
          <StatusChip ok={tokenSet}>TELEGRAM_BOT_TOKEN</StatusChip>
          <StatusChip ok={webhookSecretSet}>TELEGRAM_WEBHOOK_SECRET</StatusChip>
        </div>

        <dl className="divide-y divide-neutral-100 text-xs">
          <div className="grid gap-1 px-3 py-2 sm:grid-cols-[200px_1fr]">
            <dt className="font-semibold text-neutral-600">Bot link</dt>
            <dd>
              {canEdit ? (
                <TelegramBotUsernameField botUsername={botUsername} returnTo={returnTo} />
              ) : botLink ? (
                <a
                  href={botLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-semibold text-[#1c7fb5] underline"
                >
                  {botLink}
                </a>
              ) : (
                <span className="font-semibold text-red-600">
                  Not set — ask Admin/Organizer to set it above. Until then every
                  “Connect Telegram” button is hidden site-wide.
                </span>
              )}
            </dd>
          </div>

          <div className="grid gap-1 px-3 py-2 sm:grid-cols-[200px_1fr]">
            <dt className="font-semibold text-neutral-600">Connect deep link</dt>
            <dd>
              <Code>{botUsername ? `https://t.me/${botUsername}?start=<account id>` : "https://t.me/<bot username>?start=<account id>"}</Code>
              <p className="mt-1 text-neutral-500">
                Built per person by every “Connect Telegram” button. The{" "}
                <Code>?start=</Code> payload is that signed-in person’s own account id — it is how
                the bot knows whose chat it is talking to.
              </p>
            </dd>
          </div>

          <div className="grid gap-1 px-3 py-2 sm:grid-cols-[200px_1fr]">
            <dt className="font-semibold text-neutral-600">Webhook URL</dt>
            <dd>
              <Code>{webhookUrl}</Code>
              <p className="mt-1 text-neutral-500">
                Telegram POSTs here whenever someone messages the bot. It checks the{" "}
                <Code>x-telegram-bot-api-secret-token</Code> header against{" "}
                <Code>TELEGRAM_WEBHOOK_SECRET</Code> and rejects anything that doesn’t match.
              </p>
            </dd>
          </div>

          <div className="grid gap-1 px-3 py-2 sm:grid-cols-[200px_1fr]">
            <dt className="font-semibold text-neutral-600">Confirmation message</dt>
            <dd className="text-neutral-700">
              “✅ Telegram connected — you’ll be notified here…” is shown back on My Account once
              that person’s chat id has been stored, and the bot itself replies in Telegram to
              confirm.
            </dd>
          </div>

          <div className="grid gap-1 px-3 py-2 sm:grid-cols-[200px_1fr]">
            <dt className="font-semibold text-neutral-600">Connected accounts</dt>
            <dd>
              {totalConnected === 0 ? (
                <span className="text-neutral-500">
                  Nobody has connected yet — nothing will be delivered over Telegram DM until
                  someone presses their own “Connect Telegram” button.
                </span>
              ) : (
                <>
                  <span className="font-semibold text-neutral-800">{totalConnected} total</span>
                  <span className="text-neutral-500">
                    {" "}
                    ·{" "}
                    {connectedByRole
                      .map((r) => `${ROLE_LABEL[r.role] ?? r.role}: ${r.count}`)
                      .join(" · ")}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {!fullyWired && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          The bot is not fully wired up yet. Every Telegram DM below is silently skipped until all
          three values are set — the matching email still goes out, so nobody misses a notice, but
          nothing arrives in Telegram.
        </p>
      )}

      {/* ── Who is linked to it ───────────────────────────────────────── */}
      <h3 className="mt-8 text-base font-bold text-neutral-800">
        Who is linked to the bot, and from which button
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        Rows marked <span className="font-semibold text-neutral-700">Group post</span> do not use
        anyone’s chat id — the same bot posts into a category’s group instead, which is why they
        work even when nobody has connected.
      </p>

      <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full border-collapse" style={{ minWidth: 900 }}>
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <th className={headerCell}>Who receives it</th>
              <th className={headerCell}>Button that links them</th>
              <th className={headerCell}>Where that button is</th>
              <th className={headerCell}>What the bot sends</th>
              <th className={headerCell}>Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {LINKED_BUTTONS.map((row, i) => (
              <tr key={i} className={row.kind === "group" ? "bg-neutral-50/60" : undefined}>
                <td className={bodyCell + " font-semibold text-neutral-800"}>{row.who}</td>
                <td className={bodyCell}>{row.button}</td>
                <td className={bodyCell + " text-neutral-500"}>{row.where}</td>
                <td className={bodyCell}>{row.sends}</td>
                <td className={bodyCell}>
                  <span
                    className={
                      "whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase " +
                      (row.kind === "dm"
                        ? "bg-[#229ED9]/10 text-[#1c7fb5]"
                        : "bg-neutral-200 text-neutral-600")
                    }
                  >
                    {row.kind === "dm" ? "Direct DM" : "Group post"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── How it is used ────────────────────────────────────────────── */}
      <h3 className="mt-8 text-base font-bold text-neutral-800">How it is used</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-neutral-600">
        <li>
          <strong>One bot serves everybody.</strong> There is no separate referee bot or
          participant bot — the same bot handles every role, and the person’s own account decides
          which alerts they get.
        </li>
        <li>
          <strong>Connecting is always the person’s own action.</strong> Telegram does not let us
          message anyone who hasn’t started a chat with the bot first, so a chat id can only ever
          appear after they press their own “Connect Telegram” button. Staff cannot connect it on
          their behalf from here.
        </li>
        <li>
          <strong>Telegram never replaces email.</strong> Every notice in the table is also
          emailed. Telegram is the faster copy, not the only copy — so a blocked bot, a deleted
          chat, or an unconnected account never means a missed notice.
        </li>
        <li>
          <strong>Connecting grants no access.</strong> The chat id is only a delivery address.
          Videos, scores, and certificates stay behind the normal sign-in, so even a forged{" "}
          <Code>?start=</Code> payload could at worst misdirect a notification — never expose
          data.
        </li>
        <li>
          <strong>Disconnecting</strong> = blocking the bot in Telegram, or clearing that
          person’s <Code>telegram_chat_id</Code>. Sends then fail quietly and email carries on.
        </li>
      </ul>

      {/* ── Setup guide ───────────────────────────────────────────────── */}
      <h3 className="mt-8 text-base font-bold text-neutral-800">
        What needs setting up in Telegram — step by step
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        Steps 1–7 are needed for direct messages. Step 8 is only needed if you also want the bot
        to post into the groups listed at the top of this page.
      </p>

      <ol className="mt-3 space-y-4 text-xs text-neutral-700">
        <li>
          <p className="font-bold text-neutral-800">1. Create the bot in BotFather</p>
          <p className="mt-1">
            In Telegram, search for <strong>@BotFather</strong> (the one with the blue verified
            tick) and open a chat. Send <Code>/newbot</Code>. It asks two things:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-neutral-600">
            <li>
              <strong>Display name</strong> — free text, what people see at the top of the chat,
              e.g. <em>Malaysia IKO Goju-Ryu Kata</em>.
            </li>
            <li>
              <strong>Username</strong> — must be unique across all of Telegram and must end in{" "}
              <Code>bot</Code>, e.g. <Code>MalaysiaKataBot</Code>. This cannot be changed later
              without creating a new bot.
            </li>
          </ul>
          <p className="mt-1">
            BotFather replies with a token that looks like{" "}
            <Code>7123456789:AAH…</Code>. Keep that message — it is the only place it appears.
          </p>
        </li>

        <li>
          <p className="font-bold text-neutral-800">2. Give the bot a face (optional but worth it)</p>
          <p className="mt-1">
            Still in BotFather: <Code>/setuserpic</Code> to upload the competition logo,{" "}
            <Code>/setdescription</Code> for the text people see before they press Start, and{" "}
            <Code>/setabouttext</Code> for the short blurb on its profile. People are far more
            likely to press Start on a bot that looks official.
          </p>
        </li>

        <li>
          <p className="font-bold text-neutral-800">3. Add two environment variables in Vercel</p>
          <p className="mt-1">
            Vercel → your project → <strong>Settings → Environment Variables</strong>. Add each
            one to <strong>both Production and Preview</strong>, otherwise staging silently has no
            bot. The bot <strong>username</strong> is not one of these two — set it in the
            &quot;Bot link&quot; field above instead, which saves immediately with no redeploy:
          </p>
          <div className="mt-2 overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full border-collapse text-[11px]" style={{ minWidth: 620 }}>
              <thead className="bg-neutral-50">
                <tr>
                  <th className={headerCell}>Variable</th>
                  <th className={headerCell}>Value</th>
                  <th className={headerCell}>Now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                <tr>
                  <td className={bodyCell}>
                    <Code>TELEGRAM_BOT_TOKEN</Code>
                  </td>
                  <td className={bodyCell}>The token BotFather gave you, pasted whole.</td>
                  <td className={bodyCell}>
                    <StatusChip ok={tokenSet}>{tokenSet ? "Set" : "Missing"}</StatusChip>
                  </td>
                </tr>
                <tr>
                  <td className={bodyCell}>
                    <Code>TELEGRAM_WEBHOOK_SECRET</Code>
                  </td>
                  <td className={bodyCell}>
                    Any long random string you invent (letters, digits, <Code>-</Code>,{" "}
                    <Code>_</Code>). It is a shared password between Telegram and this site.
                  </td>
                  <td className={bodyCell}>
                    <StatusChip ok={webhookSecretSet}>
                      {webhookSecretSet ? "Set" : "Missing"}
                    </StatusChip>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </li>

        <li>
          <p className="font-bold text-neutral-800">4. Redeploy</p>
          <p className="mt-1">
            <Code>TELEGRAM_BOT_TOKEN</Code> and <Code>TELEGRAM_WEBHOOK_SECRET</Code> only reach the
            running site on the next deployment. Vercel → <strong>Deployments</strong> → latest →{" "}
            <strong>Redeploy</strong>. The status chips at the top of this page turn green once it
            is live. (The bot username doesn&apos;t need this step — it took effect the moment you
            saved it above.)
          </p>
        </li>

        <li>
          <p className="font-bold text-neutral-800">5. Point Telegram at the webhook</p>
          <p className="mt-1">
            Telegram has to be told where to deliver messages. Run this once (replace{" "}
            <Code>&lt;BOT_TOKEN&gt;</Code> and <Code>&lt;WEBHOOK_SECRET&gt;</Code> with the real
            values):
          </p>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-neutral-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-100">
{`curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \\
  -d "url=${webhookUrl}" \\
  -d "secret_token=<WEBHOOK_SECRET>"`}
          </pre>
          <p className="mt-1 text-neutral-600">
            You can also just paste this into a browser address bar instead:{" "}
            <Code>
              {`https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=${webhookUrl}&secret_token=<WEBHOOK_SECRET>`}
            </Code>
          </p>
          <p className="mt-1 text-neutral-600">
            A correct call replies <Code>{`{"ok":true,"result":true,…}`}</Code>.
          </p>
        </li>

        <li>
          <p className="font-bold text-neutral-800">6. Confirm Telegram accepted it</p>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-neutral-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-100">
{`curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"`}
          </pre>
          <p className="mt-1 text-neutral-600">
            Check that <Code>url</Code> is exactly the webhook URL above,{" "}
            <Code>pending_update_count</Code> is 0, and there is no{" "}
            <Code>last_error_message</Code>. If you see{" "}
            <Code>&quot;Wrong response from the webhook: 401 Unauthorized&quot;</Code>, the secret
            in step 5 doesn’t match <Code>TELEGRAM_WEBHOOK_SECRET</Code> in Vercel.
          </p>
        </li>

        <li>
          <p className="font-bold text-neutral-800">7. Test it end to end</p>
          <p className="mt-1">
            Open <Code>/account</Code> as any account that has a “Connect Telegram” button (a
            Judge is the easiest — theirs is always visible once approved). Press it: Telegram
            opens on the bot with a <strong>Start</strong> button, and the bot should reply{" "}
            <em>“✅ Telegram connected”</em> straight away.
          </p>
          <p className="mt-1">
            Come back here and reload — the <strong>Connected accounts</strong> row must have gone
            up by one. That single number is the real proof; anything else is guesswork.
          </p>
        </li>

        <li>
          <p className="font-bold text-neutral-800">
            8. Only if the bot should also post into the groups above
          </p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-neutral-600">
            <li>
              In BotFather send <Code>/setprivacy</Code> → pick the bot →{" "}
              <strong>Disable</strong>. With privacy mode on, the bot cannot see ordinary group
              messages, so step (3) below never produces a chat id.
            </li>
            <li>
              Open the group in Telegram → <strong>Add members</strong> → add the bot → then
              promote it to <strong>admin</strong> with “Post messages” allowed. A non-admin bot
              cannot post in most groups.
            </li>
            <li>
              Send any message starting with <Code>/</Code> in that group, e.g.{" "}
              <Code>/hello</Code>. Then open Vercel → <strong>Logs</strong> and look for{" "}
              <Code>[telegram-webhook] group message — chat_id=… title=…</Code>. That{" "}
              <Code>chat_id</Code> is the group’s real id.
            </li>
            <li>
              Either add it to Vercel as{" "}
              <Code>TELEGRAM_CHAT_ID_&lt;CATEGORY&gt;</Code> (uppercase category —{" "}
              <Code>TELEGRAM_CHAT_ID_PARTICIPANT</Code>,{" "}
              <Code>TELEGRAM_CHAT_ID_REFEREE</Code>, and so on), <em>or</em> simply fill in that
              group’s <strong>Already-member link</strong> in the table at the top of this page —
              the chat id is derived from it automatically, no redeploy needed.
            </li>
          </ol>
        </li>
      </ol>

      {/* ── Troubleshooting ───────────────────────────────────────────── */}
      <h3 className="mt-8 text-base font-bold text-neutral-800">If something isn’t arriving</h3>
      <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full border-collapse" style={{ minWidth: 760 }}>
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <th className={headerCell}>Symptom</th>
              <th className={headerCell}>Cause</th>
              <th className={headerCell}>Fix</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            <tr>
              <td className={bodyCell}>No “Connect Telegram” button anywhere on My Account</td>
              <td className={bodyCell}>
                The bot username is unset in the “Bot link” field above, so there is no link to
                build
              </td>
              <td className={bodyCell}>Set it above — takes effect immediately, no redeploy</td>
            </tr>
            <tr>
              <td className={bodyCell}>Button opens Telegram, but the bot never replies “connected”</td>
              <td className={bodyCell}>The webhook isn’t registered, or the secret doesn’t match</td>
              <td className={bodyCell}>Steps 5 and 6</td>
            </tr>
            <tr>
              <td className={bodyCell}>Person shows as connected but receives nothing</td>
              <td className={bodyCell}>They blocked or deleted the bot chat</td>
              <td className={bodyCell}>Ask them to reopen the bot, press Start, and reconnect</td>
            </tr>
            <tr>
              <td className={bodyCell}>Someone doesn’t appear on the Telegram DM page</td>
              <td className={bodyCell}>They have never pressed their own Connect button</td>
              <td className={bodyCell}>
                Only they can do it — email them the instruction, then check the count above
              </td>
            </tr>
            <tr>
              <td className={bodyCell}>Group posts fail while DMs work</td>
              <td className={bodyCell}>
                Bot isn’t a group admin, privacy mode is on, or the group has no chat id yet
              </td>
              <td className={bodyCell}>Step 8</td>
            </tr>
            <tr>
              <td className={bodyCell}>
                Staging shows &quot;Connect Telegram&quot; but never confirms as connected
              </td>
              <td className={bodyCell}>
                Both environments have the same bot configured now, but a bot has only one
                webhook — it can point at just one deployment&apos;s URL at a time. Whichever
                environment it&apos;s currently pointed at gets the confirmation; the other one
                opens the right bot but the reply never lands in its own database. This doesn&apos;t
                affect notifications already delivered via an existing telegram_chat_id (referee
                assignments, certificates, etc.) — only brand-new &quot;Connect Telegram&quot; attempts.
              </td>
              <td className={bodyCell}>
                Re-run <Code>setWebhook</Code> (step 5) pointed at staging&apos;s own URL when you
                need to test connecting there, then point it back at production&apos;s URL
                afterwards — or use a second, separate bot for staging so both stay connectable at
                the same time
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
