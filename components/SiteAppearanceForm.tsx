"use client";

import { useState } from "react";
import { saveSiteAppearance, resetSiteAppearance } from "@/app/actions/admin";
import { adminInput, adminLabel, adminBtn, adminBtnSecondary, Card } from "@/components/admin-styles";
import CertificateUploadField from "@/components/CertificateUploadField";
import {
  TEXT_ALIGN_OPTIONS, LINE_HEIGHT_OPTIONS, FONT_FAMILY_OPTIONS, FONT_SIZE_OPTIONS,
  type SiteAppearance, type SiteButton,
} from "@/lib/site-appearance";

const RETURN_TO = "/admin/competitions";

/** Align / line-height / color / font-size / font-family / bold — the same
 * six style knobs requested for title, subtitle, menu, and footer, so this
 * renders that block once per caller instead of four near-identical copies. */
function StyleControls({
  prefix,
  align,
  lineHeight,
  color,
  fontSize,
  fontFamily,
  bold,
}: {
  prefix: string;
  align: string;
  lineHeight: number;
  color: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <label htmlFor={`${prefix}_align`} className={adminLabel}>Alignment</label>
        <select id={`${prefix}_align`} name={`${prefix}_align`} defaultValue={align} className={adminInput}>
          {TEXT_ALIGN_OPTIONS.map((a) => (
            <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefix}_line_height`} className={adminLabel}>Line spacing</label>
        <select id={`${prefix}_line_height`} name={`${prefix}_line_height`} defaultValue={lineHeight} className={adminInput}>
          {LINE_HEIGHT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefix}_color`} className={adminLabel}>Color</label>
        <div className="flex items-center gap-2">
          <input id={`${prefix}_color`} name={`${prefix}_color`} type="color" defaultValue={color} className="h-9 w-12 rounded border border-neutral-300 bg-white p-1" />
          <span className="text-xs text-neutral-400">{color}</span>
        </div>
      </div>
      <div>
        <label htmlFor={`${prefix}_font_size`} className={adminLabel}>Font size</label>
        <select id={`${prefix}_font_size`} name={`${prefix}_font_size`} defaultValue={fontSize} className={adminInput}>
          {FONT_SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefix}_font_family`} className={adminLabel}>Font</label>
        <select id={`${prefix}_font_family`} name={`${prefix}_font_family`} defaultValue={fontFamily} className={adminInput}>
          {FONT_FAMILY_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-end pb-2">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <input type="checkbox" name={`${prefix}_bold`} defaultChecked={bold} className="h-4 w-4 rounded border-neutral-300 accent-red-700" />
          Bold
        </label>
      </div>
    </div>
  );
}

function ButtonsField({ initial }: { initial: SiteButton[] }) {
  const [rows, setRows] = useState<Array<{ key: string; label: string; url: string }>>(
    initial.length > 0 ? initial.map((b) => ({ key: b.id, label: b.label, url: b.url })) : [],
  );
  return (
    <div>
      {rows.map((row, i) => (
        <div key={row.key} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            aria-label={`Button ${i + 1} name`}
            placeholder="Button name"
            name="button_label"
            defaultValue={row.label}
            className={adminInput}
          />
          <input
            aria-label={`Button ${i + 1} link`}
            placeholder="https://…"
            name="button_url"
            defaultValue={row.url}
            className={adminInput}
          />
          <button
            type="button"
            onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
            className="rounded border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { key: crypto.randomUUID(), label: "", url: "" }])}
        className="mt-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
      >
        + Add button
      </button>
      <p className="mt-1 text-xs text-neutral-400">
        Extra buttons appear in the footer, after the built-in &quot;Self Registration&quot; button.
      </p>
    </div>
  );
}

export default function SiteAppearanceForm({
  settings,
  logoUrl,
}: {
  settings: SiteAppearance | null;
  logoUrl: string | null;
}) {
  const s = settings;
  return (
    <Card>
      <form action={saveSiteAppearance} className="space-y-6">
        <input type="hidden" name="return_to" value={RETURN_TO} />

        <div>
          <p className={adminLabel}>Logo</p>
          <div className="flex items-center gap-3">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Current site logo" className="h-12 w-12 rounded-md border border-neutral-200 bg-white object-contain p-1" />
            )}
            <CertificateUploadField id="logo" name="logo" />
          </div>
          <p className="mt-1 text-xs text-neutral-400">Leave blank to keep the current logo. Falls back to the default crest until one is uploaded.</p>
        </div>

        <div className="border-t border-neutral-200 pt-4">
          <p className="mb-2 text-sm font-bold text-neutral-800">Title</p>
          <div className="mb-3">
            <label htmlFor="title_text" className={adminLabel}>Title text</label>
            <input id="title_text" name="title_text" defaultValue={s?.title_text ?? ""} className={adminInput} placeholder="MALAYSIA OPEN VIRTUAL KARATE-DO KATA COMPETITION" />
            <p className="mt-1 text-xs text-neutral-400">Leave blank to keep the default title.</p>
          </div>
          <StyleControls
            prefix="title"
            align={s?.title_align ?? "left"}
            lineHeight={s?.title_line_height ?? 1.2}
            color={s?.title_color ?? "#ffffff"}
            fontSize={s?.title_font_size ?? 16}
            fontFamily={s?.title_font_family ?? "sans"}
            bold={s?.title_bold ?? true}
          />
        </div>

        <div className="border-t border-neutral-200 pt-4">
          <p className="mb-2 text-sm font-bold text-neutral-800">Subtitle</p>
          <div className="mb-3">
            <label htmlFor="subtitle_text" className={adminLabel}>Subtitle text</label>
            <input id="subtitle_text" name="subtitle_text" defaultValue={s?.subtitle_text ?? ""} className={adminInput} placeholder="Goju-ryu or IKO Goju-ryu Version Only & Open Version for Kobudo (Weapon) Kata" />
            <p className="mt-1 text-xs text-neutral-400">Leave blank to keep the default subtitle.</p>
          </div>
          <StyleControls
            prefix="subtitle"
            align={s?.subtitle_align ?? "left"}
            lineHeight={s?.subtitle_line_height ?? 1.2}
            color={s?.subtitle_color ?? "#ffffff"}
            fontSize={s?.subtitle_font_size ?? 12}
            fontFamily={s?.subtitle_font_family ?? "sans"}
            bold={s?.subtitle_bold ?? true}
          />
        </div>

        <div className="border-t border-neutral-200 pt-4">
          <p className="mb-2 text-sm font-bold text-neutral-800">Main menu</p>
          <p className="mb-2 text-xs text-neutral-400">Styling only — the menu items themselves (Home, Participants, Winners, etc.) stay fixed.</p>
          <StyleControls
            prefix="menu"
            align={s?.menu_align ?? "right"}
            lineHeight={s?.menu_line_height ?? 1.2}
            color={s?.menu_color ?? "#ffffff"}
            fontSize={s?.menu_font_size ?? 14}
            fontFamily={s?.menu_font_family ?? "sans"}
            bold={s?.menu_bold ?? false}
          />
        </div>

        <div className="border-t border-neutral-200 pt-4">
          <p className="mb-2 text-sm font-bold text-neutral-800">Footer</p>
          <div className="mb-3">
            <label htmlFor="footer_text" className={adminLabel}>Footer text</label>
            <textarea
              id="footer_text" name="footer_text" rows={3} defaultValue={s?.footer_text ?? ""} className={adminInput}
              placeholder={"Specially for all Goju-ryu Karateka to compete globally without leaving their beloved Country.\nRecord your Kata live to compete online."}
            />
            <p className="mt-1 text-xs text-neutral-400">One line per paragraph. Leave blank to keep the default footer text.</p>
          </div>
          <StyleControls
            prefix="footer"
            align={s?.footer_align ?? "center"}
            lineHeight={s?.footer_line_height ?? 1.2}
            color={s?.footer_color ?? "#ffffff"}
            fontSize={s?.footer_font_size ?? 13}
            fontFamily={s?.footer_font_family ?? "sans"}
            bold={s?.footer_bold ?? true}
          />
          <div className="mt-3">
            <p className={adminLabel}>Buttons</p>
            <ButtonsField initial={s?.buttons ?? []} />
          </div>
        </div>

        <div className="flex gap-2 border-t border-neutral-200 pt-4">
          <button type="submit" className={adminBtn}>Save site appearance</button>
        </div>
      </form>
      <form action={resetSiteAppearance} className="mt-3 border-t border-neutral-200 pt-3">
        <input type="hidden" name="return_to" value={RETURN_TO} />
        <button
          type="submit"
          className={`${adminBtnSecondary} border-red-300 text-red-700 hover:bg-red-50`}
          onClick={(e) => {
            if (!window.confirm("Clear every site appearance setting back to the default logo, title, subtitle, menu, and footer? This can't be undone.")) {
              e.preventDefault();
            }
          }}
        >
          Reset to defaults (clear everything)
        </button>
      </form>
    </Card>
  );
}
