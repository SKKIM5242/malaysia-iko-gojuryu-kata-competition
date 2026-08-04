"use client";

import { useActionState, useState } from "react";
import {
  sendIssueReportMessage,
  updateIssueReport,
  type IssueActionState,
} from "@/app/actions/issue-reports";
import {
  CHANNEL_LABELS,
  STATUS_OPTIONS,
  type IssueMessageChannel,
} from "@/lib/issue-reports";

const initial: IssueActionState = {};

export interface IssueMessageView {
  id: string;
  channel: string;
  subject: string | null;
  body: string;
  sentByName: string | null;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none";

function Feedback({ state }: { state: IssueActionState }) {
  if (state.error) return <p className="text-xs font-semibold text-red-700">{state.error}</p>;
  if (state.ok) return <p className="text-xs font-semibold text-green-700">{state.ok}</p>;
  return null;
}

/** The compose box behind each channel button. Kept collapsed until the
 * staff member picks a channel so a long report list stays scannable —
 * "add message" is the button, the textarea is what it opens. */
function ComposeBox({
  reportId,
  channel,
  defaultSubject,
  onDone,
}: {
  reportId: string;
  channel: IssueMessageChannel;
  defaultSubject: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(sendIssueReportMessage, initial);
  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-md border border-neutral-300 bg-neutral-50 p-3">
      <input type="hidden" name="report_id" value={reportId} />
      <input type="hidden" name="channel" value={channel} />
      <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
        Write a {CHANNEL_LABELS[channel]} message
      </p>
      {channel === "email" && (
        <input name="subject" defaultValue={defaultSubject} className={inputClass} placeholder="Email subject" />
      )}
      {channel === "telegram_group" && (
        <input
          name="group_chat_id"
          className={inputClass}
          placeholder="Telegram group chat id (e.g. -1001234567890)"
        />
      )}
      <textarea name="body" rows={4} required className={inputClass} placeholder="Your message…" />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-red-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send & save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-neutral-300 bg-white px-4 py-1.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
        >
          Close
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export default function IssueReportRow({
  report,
  messages,
  screenshotUrls,
}: {
  report: {
    id: string;
    subject: string;
    status: string;
    staffNotes: string | null;
    reporterName: string | null;
    reporterEmail: string | null;
    expectedResult: string;
    whatWrong: string;
  };
  messages: IssueMessageView[];
  screenshotUrls: string[];
}) {
  const [openChannel, setOpenChannel] = useState<IssueMessageChannel | null>(null);
  const [saveState, saveAction, saving] = useActionState(updateIssueReport, initial);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">What is wrong</p>
        <p className="whitespace-pre-wrap text-sm text-neutral-800">{report.whatWrong}</p>
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Expected after fix</p>
        <p className="whitespace-pre-wrap text-sm text-neutral-800">{report.expectedResult}</p>
      </div>

      {screenshotUrls.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            Screenshots ({screenshotUrls.length})
          </p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {screenshotUrls.map((url, i) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Screenshot ${i + 1}`}
                    className="h-24 w-24 rounded border border-neutral-300 object-cover hover:opacity-80"
                  />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={saveAction} className="space-y-2 rounded-md border border-neutral-200 bg-white p-3">
        <input type="hidden" name="id" value={report.id} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-bold uppercase tracking-wide text-neutral-500" htmlFor={`st-${report.id}`}>
            Status
          </label>
          <select id={`st-${report.id}`} name="status" defaultValue={report.status} className="rounded-md border border-neutral-300 px-2 py-1 text-sm">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <textarea
          name="staff_notes"
          rows={2}
          defaultValue={report.staffNotes ?? ""}
          className={inputClass}
          placeholder="Internal staff notes (not sent to the participant)"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md border border-neutral-300 bg-white px-4 py-1.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <Feedback state={saveState} />
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(CHANNEL_LABELS) as IssueMessageChannel[]).map((channel) => (
          <button
            key={channel}
            type="button"
            onClick={() => setOpenChannel(openChannel === channel ? null : channel)}
            className="rounded-md border border-neutral-400 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
          >
            {openChannel === channel ? "▾ " : "＋ "}
            {CHANNEL_LABELS[channel]}
          </button>
        ))}
      </div>

      {openChannel && (
        <ComposeBox
          reportId={report.id}
          channel={openChannel}
          defaultSubject={`Re: ${report.subject}`}
          onDone={() => setOpenChannel(null)}
        />
      )}

      {messages.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            Messages sent ({messages.length})
          </p>
          <ul className="mt-1 space-y-1">
            {messages.map((m) => (
              <li key={m.id} className="rounded border border-neutral-200 bg-white px-3 py-2 text-xs">
                <span className="font-semibold text-neutral-700">
                  {CHANNEL_LABELS[m.channel as IssueMessageChannel] ?? m.channel}
                </span>{" "}
                <span className={m.ok ? "text-green-700" : "text-red-700"}>{m.ok ? "sent" : "failed"}</span>
                <span className="text-neutral-400">
                  {" "}
                  · {new Date(m.createdAt).toLocaleString()} · {m.sentByName ?? "staff"}
                </span>
                {m.subject && <p className="mt-0.5 font-semibold text-neutral-600">{m.subject}</p>}
                <p className="mt-0.5 whitespace-pre-wrap text-neutral-700">{m.body}</p>
                {m.error && <p className="mt-0.5 text-red-700">{m.error}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
