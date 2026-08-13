"use client";

import { useState, useTransition } from "react";
import { sendParticipantMessage } from "@/app/actions/admin";

/**
 * One "send feedback" button per channel, per participant, on the admin
 * Participants table. Opens a small compose dialog rather than expanding
 * inside the cell — a table cell is far too narrow to write a real message
 * in, and the table scrolls horizontally.
 *
 * Whatever is sent (and any failure) is recorded server-side in
 * participant_messages, so there is a permanent record of what the
 * organizer told each participant.
 */
export default function ParticipantMessageButton({
  participantId,
  participantName,
  channel,
  returnTo,
}: {
  participantId: string;
  participantName: string;
  channel: "email" | "telegram";
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  const label = channel === "email" ? "✉️ Email" : "💬 Telegram";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          "rounded border px-2 py-1 text-xs font-semibold " +
          (channel === "email"
            ? "border-sky-300 text-sky-700 hover:bg-sky-50"
            : "border-cyan-300 text-cyan-700 hover:bg-cyan-50")
        }
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl">
            <h3 className="text-sm font-bold text-neutral-800">
              {channel === "email" ? "Email" : "Telegram DM"} to {participantName}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              {channel === "telegram"
                ? "Only works if this participant has connected Telegram from My Account. Sent as a direct message from the competition bot."
                : "Sent from the competition's own email address."}{" "}
              A copy of this message is recorded against the participant.
            </p>

            <label className="mt-3 block text-xs font-semibold text-neutral-600">
              Subject {channel === "telegram" && <span className="font-normal text-neutral-400">(optional)</span>}
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm font-normal text-neutral-800"
              />
            </label>

            <label className="mt-3 block text-xs font-semibold text-neutral-600">
              Message
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={7}
                className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm font-normal text-neutral-800"
              />
            </label>

            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || !body.trim()}
                onClick={() =>
                  startTransition(() => {
                    const fd = new FormData();
                    fd.set("participant_id", participantId);
                    fd.set("channel", channel);
                    fd.set("subject", subject);
                    fd.set("body", body);
                    fd.set("return_to", returnTo);
                    void sendParticipantMessage(fd);
                  })
                }
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {pending ? "Sending…" : "Send & record"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
