"use client";

import { saveRecordingAppearance, resetRecordingAppearance } from "@/app/actions/admin";
import { adminInput, adminLabel, adminBtn, adminBtnSecondary, Card } from "@/components/admin-styles";
import CertificateUploadField from "@/components/CertificateUploadField";
import {
  TEXT_ALIGN_OPTIONS, LINE_HEIGHT_OPTIONS, FONT_FAMILY_OPTIONS, FONT_SIZE_OPTIONS,
} from "@/lib/site-appearance";
import {
  RECORDING_APPEARANCE_FALLBACK,
  type RecordingAppearance,
} from "@/lib/recording-appearance";
import { RecordingBanner, RecordingFooterWatermark, PoseGuideOverlay } from "@/components/RecordingChrome";

const RETURN_TO = "/admin/competitions";

/** The same six style knobs Site Appearance offers, so an organizer who has
 * used one form already knows this one. Deliberately a local copy rather
 * than an import from SiteAppearanceForm: that file does not export it, and
 * exporting a private helper across two forms couples them in a way that
 * makes either one harder to change on its own. */
function StyleControls({
  prefix, align, lineHeight, color, fontSize, fontFamily, bold,
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

export default function RecordingAppearanceForm({
  settings,
  logoUrl,
}: {
  settings: RecordingAppearance | null;
  logoUrl: string | null;
}) {
  const s = settings;
  return (
    <Card>
      <p className="mb-3 text-sm text-neutral-500">
        Branding for the <strong>recording screens</strong> — the banner across the top and the
        watermark along the bottom of the camera view a winner sees while recording their video
        testimonial. Separate from Site Appearance above, which controls the website&apos;s own
        header and footer.
      </p>

      {/* A live preview rather than a description of one: these settings are
          only ever seen over a camera feed, and no amount of prose tells an
          organizer whether their chosen font size fits the banner. */}
      <div className="mb-5">
        <p className={adminLabel}>Preview</p>
        <div className="w-full max-w-sm overflow-hidden rounded-md bg-black">
          <RecordingBanner settings={s} logoUrl={logoUrl} />
          <div className="relative aspect-[3/4] bg-black">
            <PoseGuideOverlay />
          </div>
          <RecordingFooterWatermark settings={s} />
        </div>
        <p className="mt-1 text-xs text-neutral-400">
          The dotted framing guide is shown here for reference. On the real screen it sits over the
          live camera, and it disappears during replay and after the testimonial is submitted.
        </p>
      </div>

      <form action={saveRecordingAppearance} className="space-y-6">
        <input type="hidden" name="return_to" value={RETURN_TO} />

        <div className="border-t border-neutral-200 pt-4">
          <p className={adminLabel}>Banner logo</p>
          <div className="flex items-center gap-3">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Current recording banner logo" className="h-12 w-12 rounded-md border border-neutral-200 bg-white object-contain p-1" />
            )}
            <CertificateUploadField id="logo" name="logo" />
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Optional — sits at the left of the banner. Leave blank to keep the current one; the
            banner shows text only until one is uploaded.
          </p>
        </div>

        <div className="border-t border-neutral-200 pt-4">
          <p className="mb-2 text-sm font-bold text-neutral-800">Banner line 1</p>
          <div className="mb-3">
            <label htmlFor="line1_text" className={adminLabel}>Line 1 text</label>
            <input id="line1_text" name="line1_text" defaultValue={s?.line1_text ?? ""} className={adminInput} placeholder={RECORDING_APPEARANCE_FALLBACK.line1} />
            <p className="mt-1 text-xs text-neutral-400">The main title across the top of the recording screen.</p>
          </div>
          <StyleControls
            prefix="line1"
            align={s?.line1_align ?? "center"}
            lineHeight={s?.line1_line_height ?? 1.2}
            color={s?.line1_color ?? "#ffffff"}
            fontSize={s?.line1_font_size ?? 18}
            fontFamily={s?.line1_font_family ?? "serif"}
            bold={s?.line1_bold ?? true}
          />
        </div>

        <div className="border-t border-neutral-200 pt-4">
          <p className="mb-2 text-sm font-bold text-neutral-800">Banner line 2</p>
          <div className="mb-3">
            <label htmlFor="line2_text" className={adminLabel}>Line 2 text</label>
            <input id="line2_text" name="line2_text" defaultValue={s?.line2_text ?? ""} className={adminInput} placeholder={RECORDING_APPEARANCE_FALLBACK.line2} />
            <p className="mt-1 text-xs text-neutral-400">The smaller line underneath, e.g. who organized the competition.</p>
          </div>
          <StyleControls
            prefix="line2"
            align={s?.line2_align ?? "center"}
            lineHeight={s?.line2_line_height ?? 1.2}
            color={s?.line2_color ?? "#ffffff"}
            fontSize={s?.line2_font_size ?? 11}
            fontFamily={s?.line2_font_family ?? "sans"}
            bold={s?.line2_bold ?? false}
          />
        </div>

        <div className="border-t border-neutral-200 pt-4">
          <p className="mb-2 text-sm font-bold text-neutral-800">Footer watermark</p>
          <div className="mb-3">
            <label htmlFor="footer_text" className={adminLabel}>Watermark text</label>
            <input id="footer_text" name="footer_text" defaultValue={s?.footer_text ?? ""} className={adminInput} placeholder={RECORDING_APPEARANCE_FALLBACK.footer} />
            <p className="mt-1 text-xs text-neutral-400">Runs along the bottom of the recording screen, under the camera view.</p>
          </div>
          <StyleControls
            prefix="footer"
            align={s?.footer_align ?? "center"}
            lineHeight={s?.footer_line_height ?? 1.2}
            color={s?.footer_color ?? "#ffffff"}
            fontSize={s?.footer_font_size ?? 12}
            fontFamily={s?.footer_font_family ?? "sans"}
            bold={s?.footer_bold ?? true}
          />
        </div>

        <div className="flex gap-2 border-t border-neutral-200 pt-4">
          <button type="submit" className={adminBtn}>Save recording appearance</button>
        </div>
      </form>

      <form action={resetRecordingAppearance} className="mt-3 border-t border-neutral-200 pt-3">
        <input type="hidden" name="return_to" value={RETURN_TO} />
        <button
          type="submit"
          className={`${adminBtnSecondary} border-red-300 text-red-700 hover:bg-red-50`}
          onClick={(e) => {
            if (!window.confirm("Reset the recording banner and footer watermark back to the competition's default wording and styling? This can't be undone.")) {
              e.preventDefault();
            }
          }}
        >
          Reset to defaults
        </button>
      </form>
    </Card>
  );
}
