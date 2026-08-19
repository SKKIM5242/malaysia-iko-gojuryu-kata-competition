import Link from "next/link";
import type { CSSProperties } from "react";
import RoleSwitcher from "@/components/RoleSwitcher";
import FooterHeightSync from "@/components/FooterHeightSync";
import { fontStackFor, type TextAlign } from "@/lib/site-appearance";
import { getSiteAppearance } from "@/lib/site-appearance-server";

// Split out of components/ui.tsx: SiteHeader/SiteFooter need an async
// Supabase fetch (getSiteAppearance), and that server-only import chain
// (next/headers via lib/supabase/server) can't be reached from ANY module
// a "use client" component also imports from -- ui.tsx is imported by
// several client components for its plain utilities (formatUSD etc.), so
// keeping SiteHeader/SiteFooter there broke the client bundle the moment
// they gained a server-only dependency. This file has no client
// consumers, so it can freely be async/server-only.

const JUSTIFY_FOR_ALIGN: Record<TextAlign, CSSProperties["justifyContent"]> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

const MENU_DEFAULTS = { color: "#ffffff", font_size: 14, bold: false, font_family: "sans", align: "right" as TextAlign, line_height: 1.2 };

export async function SiteHeader() {
  const { settings: s, logoUrl } = await getSiteAppearance();

  // Font-size only overrides once there's custom text to size — otherwise
  // the header keeps its carefully fluid (clamp()-based) mobile sizing,
  // which a flat admin-set px value would fight with on narrow screens.
  // Color/weight/family/alignment/line-height don't have that conflict,
  // so those apply as soon as a site_appearance row exists (its own
  // defaults already match today's look).
  const titleCustomized = !!s?.title_text;
  const subtitleCustomized = !!s?.subtitle_text;
  const menuCustomized = s
    ? s.menu_color !== MENU_DEFAULTS.color || s.menu_font_size !== MENU_DEFAULTS.font_size ||
      s.menu_bold !== MENU_DEFAULTS.bold || s.menu_font_family !== MENU_DEFAULTS.font_family ||
      s.menu_align !== MENU_DEFAULTS.align || s.menu_line_height !== MENU_DEFAULTS.line_height
    : false;

  const titleStyle: CSSProperties = s
    ? {
        textAlign: s.title_align,
        lineHeight: s.title_line_height,
        color: s.title_color,
        fontFamily: fontStackFor(s.title_font_family),
        fontWeight: s.title_bold ? 700 : 400,
        ...(titleCustomized ? { fontSize: `${s.title_font_size}px` } : {}),
      }
    : {};
  const subtitleStyle: CSSProperties = s
    ? {
        textAlign: s.subtitle_align,
        lineHeight: s.subtitle_line_height,
        color: s.subtitle_color,
        fontFamily: fontStackFor(s.subtitle_font_family),
        fontWeight: s.subtitle_bold ? 700 : 400,
        ...(subtitleCustomized ? { fontSize: `${s.subtitle_font_size}px` } : {}),
      }
    : {};
  const menuStyle: CSSProperties = menuCustomized && s
    ? {
        color: s.menu_color,
        fontSize: `${s.menu_font_size}px`,
        fontWeight: s.menu_bold ? 700 : 400,
        fontFamily: fontStackFor(s.menu_font_family),
        lineHeight: s.menu_line_height,
        justifyContent: JUSTIFY_FOR_ALIGN[s.menu_align],
      }
    : {};

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-neutral-950 text-white lg:max-h-[12vh] lg:overflow-hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-1.5 px-4 py-2 sm:gap-3 sm:py-4 lg:gap-2 lg:py-1.5 [@media(max-height:500px)_and_(orientation:landscape)]:gap-1 [@media(max-height:500px)_and_(orientation:landscape)]:py-0.5">
        <Link href="/" className="flex items-center gap-1.5 sm:gap-3 lg:gap-2 [@media(max-height:500px)_and_(orientation:landscape)]:gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl ?? "/logo.jpg"}
            alt="Malaysia IKO Goju-ryu Karate-do crest"
            className="h-7 w-7 rounded-lg bg-white p-0.5 sm:h-11 sm:w-11 lg:h-8 lg:w-8 [@media(max-height:500px)_and_(orientation:landscape)]:h-6 [@media(max-height:500px)_and_(orientation:landscape)]:w-6"
          />
          <span className="leading-none sm:leading-tight lg:leading-none [@media(max-height:500px)_and_(orientation:landscape)]:leading-none">
            {/* Fluid (vw-based) font size + no-wrap instead of a fixed px
                size -- a fixed size either wrapped to 2 lines on narrow
                phones or sat needlessly small on wider ones. Scales with
                the viewport instead, so it stays on one line at any width
                this breakpoint covers. Overridden by a Site Appearance
                font-size only once that section has its own custom text
                (see titleCustomized/subtitleCustomized above). */}
            {/* vw coefficients measured, not estimated: at the previous
                2.9vw/2.15vw the title ran past the right edge on every
                width from 320 to 375 (iPhone SE is 375 — that's the
                clipped "COMPETITION"), and the subtitle all the way up to
                412. These are the tightest coefficients that still fit the
                space actually left over after the header's own padding,
                the crest and the gap, at every width below the sm
                breakpoint — where the text is allowed to wrap and none of
                this applies. */}
            <span
              style={titleStyle}
              className={`block whitespace-nowrap font-bold tracking-wide sm:whitespace-normal ${
                titleCustomized ? "" : "text-[clamp(6.5px,2.7vw,11px)] sm:text-sm lg:text-[13px]"
              }`}
            >
              {s?.title_text || "MALAYSIA OPEN VIRTUAL KARATE-DO KATA COMPETITION"}
            </span>
            <span
              style={subtitleStyle}
              className={`block whitespace-nowrap font-bold tracking-wide sm:whitespace-normal ${
                subtitleCustomized
                  ? ""
                  : "text-[clamp(5px,1.95vw,8.5px)] sm:text-sm lg:text-xs [@media(max-height:500px)_and_(orientation:landscape)]:text-[clamp(5px,1.5vw,6.5px)]"
              }`}
            >
              {/* "Kobudo(Weapon)Kata" is deliberately unspaced: with spaces,
                  a phone in portrait breaks the line inside it and clips the
                  final "a" of Kata, so the word never reads in full. */}
              {s?.subtitle_text || "Goju-ryu or IKO Goju-ryu Version Only & Open Version for Kobudo(Weapon)Kata"}
            </span>
          </span>
        </Link>
        {/* Sibling of the logo/title link, placed before <nav> in source
            order so flex-wrap assigns it to the first row (next to the
            title, in the space to the right of it) instead of the second
            row -- flex-wrap can't backfill an earlier row for a later item,
            so this only works by coming before nav, not after it. */}
        <RoleSwitcher />
        <nav
          style={menuStyle}
          className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-xs sm:gap-1 sm:text-sm lg:gap-x-0.5 lg:leading-none"
        >
          <Link href="/" className="rounded px-1.5 py-px hover:bg-neutral-800 sm:px-3 sm:py-1.5 lg:px-2 lg:py-1">Home</Link>
          <Link href="/participants" className="rounded px-1.5 py-px hover:bg-neutral-800 sm:px-3 sm:py-1.5 lg:px-2 lg:py-1">Participants</Link>
          <Link href="/winners" className="rounded px-1.5 py-px hover:bg-neutral-800 sm:px-3 sm:py-1.5 lg:px-2 lg:py-1">Winners</Link>
          <Link href="/kata-arena" className="rounded px-1.5 py-px hover:bg-neutral-800 sm:px-3 sm:py-1.5 lg:px-2 lg:py-1">Kata Arena</Link>
          <Link href="/announcements" className="rounded px-1.5 py-px hover:bg-neutral-800 sm:px-3 sm:py-1.5 lg:px-2 lg:py-1">Announcements</Link>
          <Link
            href="/register"
            className="rounded bg-red-700 px-2 py-px font-semibold hover:bg-red-600 sm:ml-1 sm:px-4 sm:py-1.5 lg:px-3 lg:py-1"
          >
            Register
          </Link>
          <Link
            href="/account"
            className="rounded border border-white/30 px-2 py-px font-semibold hover:bg-neutral-800 sm:ml-1 sm:px-4 sm:py-1.5 lg:px-3 lg:py-1"
            title="Sign in to Kata Arena — watch/record your kata, judge as a referee, or manage your account"
          >
            Kata Arena Log In
          </Link>
        </nav>
      </div>
    </header>
  );
}

const DEFAULT_FOOTER_LINES = [
  "Specially for all Goju-ryu Karateka to compete globally without leaving their beloved Country.",
  "Record your Kata live to compete online.",
];

export async function SiteFooter() {
  const { settings: s } = await getSiteAppearance();
  const footerCustomized = !!s?.footer_text;
  const footerLines = footerCustomized ? s!.footer_text!.split("\n").filter(Boolean) : DEFAULT_FOOTER_LINES;
  const footerStyle: CSSProperties = s
    ? {
        textAlign: s.footer_align,
        lineHeight: s.footer_line_height,
        color: s.footer_color,
        fontFamily: fontStackFor(s.footer_font_family),
        fontWeight: s.footer_bold ? 700 : 400,
        ...(footerCustomized ? { fontSize: `${s.footer_font_size}px` } : {}),
      }
    : {};
  const buttons = s?.buttons ?? [];

  return (
    // Bottom Menu — FooterHeightSync reserves exactly as much space in
    // normal flow as the footer actually renders (measured, not guessed),
    // then the footer pins itself to the bottom of the viewport so it
    // stays visible while scrolling a long page, mirroring the sticky
    // SiteHeader at the top. See FooterHeightSync for why this must be
    // measured rather than a fixed height class.
    <FooterHeightSync fallbackClassName="h-28 sm:h-24 lg:h-[10vh] [@media(max-height:500px)_and_(orientation:landscape)]:h-20">
      <div data-mobile-footer className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-950 text-white lg:max-h-[10vh] lg:overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-2 text-center text-xs sm:text-sm lg:py-1 lg:leading-tight lg:text-[11px] [@media(max-height:500px)_and_(orientation:landscape)]:px-3 [@media(max-height:500px)_and_(orientation:landscape)]:py-1">
          {footerLines.map((line, i) => (
            <p
              key={i}
              style={footerStyle}
              className={footerCustomized ? "" : "font-bold [@media(max-height:500px)_and_(orientation:landscape)]:text-[10px]"}
            >
              {line}
            </p>
          ))}
          <p className="mt-1 text-[10px] leading-tight text-neutral-300 sm:text-xs lg:mt-0.5 lg:text-[10px] [@media(max-height:500px)_and_(orientation:landscape)]:mt-0.5 [@media(max-height:500px)_and_(orientation:landscape)]:text-[9px]">
            Organizer &amp; Copyright ©{" "}
            <a
              href="https://www.mixo.io/site/iko-goju-ryu-karate-do-m-sdn-bhd-wt9nk"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline underline-offset-2 hover:text-white"
            >
              IKO Goju-ryu Karate-do Malaysia Sdn Bhd
            </a>
            {" "}- All Rights Reserved.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 lg:mt-0.5">
            <Link
              href="/register"
              className="inline-block rounded-md bg-red-700 px-5 py-1.5 font-semibold text-white hover:bg-red-600 lg:px-4 lg:py-0.5 lg:text-xs [@media(max-height:500px)_and_(orientation:landscape)]:px-4 [@media(max-height:500px)_and_(orientation:landscape)]:py-1 [@media(max-height:500px)_and_(orientation:landscape)]:text-xs"
            >
              Self Registration
            </Link>
            {buttons.map((b) => (
              <a
                key={b.id}
                href={b.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-md border border-white/30 px-5 py-1.5 font-semibold text-white hover:bg-neutral-800 lg:px-4 lg:py-0.5 lg:text-xs"
              >
                {b.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </FooterHeightSync>
  );
}
