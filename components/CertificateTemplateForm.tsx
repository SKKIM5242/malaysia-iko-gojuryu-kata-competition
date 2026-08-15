"use client";

import { useRef, useState } from "react";
import { saveCertificateTemplate, deleteCertificateTemplateImage } from "@/app/actions/admin";
import { adminBtn, adminInput, adminLabel } from "@/components/admin-styles";

export interface CertificateTemplateRow {
  kind: string;
  header1: string;
  header2: string;
  body1: string;
  body2: string;
  body3: string;
  logo_count: 1 | 2;
  show_medal: boolean;
  medal_position: "between" | "left" | "right";
}

const MERGE_TOKENS = [
  { token: "{name}", label: "Name" },
  { token: "{kata_category}", label: "Kata / Category" },
  { token: "{competition_tier}", label: "Competition Tier" },
] as const;

/** One Body textarea plus small "insert" buttons for the 3 (4 for Winner)
 * merge tokens it can pull live data from -- clicking a button appends the
 * token at the end rather than tracking cursor position, simple and
 * predictable for a field that's usually short. */
function BodyField({
  id, name, label, value, onChange, showRankToken,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  showRankToken: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function insert(token: string) {
    onChange(value + (value && !value.endsWith(" ") ? " " : "") + token);
    ref.current?.focus();
  }
  return (
    <div>
      <label htmlFor={id} className={adminLabel}>{label}</label>
      <textarea
        ref={ref} id={id} name={name} rows={2} value={value}
        onChange={(e) => onChange(e.target.value)}
        className={adminInput}
      />
      <div className="mt-1 flex flex-wrap gap-1.5">
        {MERGE_TOKENS.map((t) => (
          <button
            key={t.token} type="button" onClick={() => insert(t.token)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            + {t.label}
          </button>
        ))}
        {showRankToken && (
          <button
            type="button" onClick={() => insert("{rank}")}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            + Rank (1st/2nd/3rd)
          </button>
        )}
      </div>
    </div>
  );
}

/** One image slot (Logo 1 / Logo 2 / Medal): current preview (if any) with
 * its own Remove button — a separate form/action from the file input below
 * it, so deleting doesn't depend on also re-submitting the rest of the
 * template — plus a file input that uploads a replacement on the next
 * "Save template" click (same "leave blank to keep the existing image"
 * convention as Certificate Settings' signature/stamp fields). */
function ImageSlot({
  kind, field, label, currentUrl, returnTo,
}: {
  kind: string;
  field: "logo1" | "logo2" | "medal";
  label: string;
  currentUrl: string | null;
  returnTo: string;
}) {
  return (
    <div className="rounded border border-neutral-200 bg-neutral-50 p-2">
      <p className="mb-1 text-xs font-semibold text-neutral-600">{label}</p>
      {currentUrl && (
        <div className="mb-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={currentUrl} alt="" className="h-12 w-12 rounded border border-neutral-200 bg-white object-contain" />
          <form action={deleteCertificateTemplateImage}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="field" value={field} />
            <input type="hidden" name="return_to" value={returnTo} />
            <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
              Remove
            </button>
          </form>
        </div>
      )}
      <input type="file" name={field} accept="image/png,image/jpeg,image/webp" className="block w-full text-xs" />
      <p className="mt-1 text-[11px] text-neutral-400">
        {currentUrl ? "Choose a file to replace it, or leave blank to keep it." : "PNG/JPEG/WEBP, max 5 MB."}
      </p>
    </div>
  );
}

export default function CertificateTemplateForm({
  kind,
  kindLabel,
  template,
  logo1Url,
  logo2Url,
  medalUrl,
  returnTo,
}: {
  kind: string;
  kindLabel: string;
  template: CertificateTemplateRow;
  logo1Url: string | null;
  logo2Url: string | null;
  medalUrl: string | null;
  returnTo: string;
}) {
  const [logoCount, setLogoCount] = useState<1 | 2>(template.logo_count);
  const [showMedal, setShowMedal] = useState(template.show_medal);
  const [medalPosition, setMedalPosition] = useState<"between" | "left" | "right">(template.medal_position);
  const [header1, setHeader1] = useState(template.header1);
  const [header2, setHeader2] = useState(template.header2);
  const [body1, setBody1] = useState(template.body1);
  const [body2, setBody2] = useState(template.body2);
  const [body3, setBody3] = useState(template.body3);
  const isWinner = kind === "winner";

  return (
    <form action={saveCertificateTemplate} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="return_to" value={returnTo} />
      <p className="text-sm font-bold text-neutral-800">{kindLabel}</p>

      <div>
        <label className={adminLabel}>Logos</label>
        <div className="flex gap-4 text-sm">
          {([1, 2] as const).map((n) => (
            <label key={n} className="flex items-center gap-1.5">
              <input
                type="radio" name="logo_count" value={n} checked={logoCount === n}
                onChange={() => setLogoCount(n)}
              />
              {n} logo{n === 2 ? "s" : ""}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ImageSlot kind={kind} field="logo1" label="Logo 1" currentUrl={logo1Url} returnTo={returnTo} />
        {logoCount === 2 && (
          <ImageSlot kind={kind} field="logo2" label="Logo 2" currentUrl={logo2Url} returnTo={returnTo} />
        )}
      </div>

      <div>
        {isWinner ? (
          <p className="text-xs text-neutral-400">
            Medal: uses the automatic gold / silver / bronze artwork, centered between Logo 1 and Logo 2 — not
            an uploaded image.
          </p>
        ) : (
          <>
            <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
              <input type="checkbox" name="show_medal" checked={showMedal} onChange={(e) => setShowMedal(e.target.checked)} />
              Show a medal graphic
            </label>
            {showMedal && (
              <div className="mt-2 space-y-2">
                <ImageSlot kind={kind} field="medal" label="Medal" currentUrl={medalUrl} returnTo={returnTo} />
                {logoCount === 1 ? (
                  <div>
                    <label className={adminLabel}>Medal position, relative to Logo 1</label>
                    <div className="flex gap-4 text-sm">
                      {(["left", "right"] as const).map((pos) => (
                        <label key={pos} className="flex items-center gap-1.5 capitalize">
                          <input
                            type="radio" name="medal_position" value={pos} checked={medalPosition === pos}
                            onChange={() => setMedalPosition(pos)}
                          />
                          {pos}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <input type="hidden" name="medal_position" value="between" />
                    <p className="text-[11px] text-neutral-400">With 2 logos, the medal renders centered between them.</p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={`${kind}_header1`} className={adminLabel}>Header 1 (title)</label>
          <input id={`${kind}_header1`} name="header1" value={header1} onChange={(e) => setHeader1(e.target.value)} className={adminInput} />
        </div>
        <div>
          <label htmlFor={`${kind}_header2`} className={adminLabel}>Header 2 (intro line)</label>
          <input id={`${kind}_header2`} name="header2" value={header2} onChange={(e) => setHeader2(e.target.value)} className={adminInput} />
        </div>
      </div>

      <BodyField id={`${kind}_body1`} name="body1" label="Body 1 (recipient)" value={body1} onChange={setBody1} showRankToken={isWinner} />
      <BodyField id={`${kind}_body2`} name="body2" label="Body 2 (reason)" value={body2} onChange={setBody2} showRankToken={isWinner} />
      <BodyField id={`${kind}_body3`} name="body3" label="Body 3 (competition)" value={body3} onChange={setBody3} showRankToken={isWinner} />

      <button type="submit" className={adminBtn}>Save {kindLabel} template</button>
    </form>
  );
}
