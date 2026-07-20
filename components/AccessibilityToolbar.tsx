"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface Window {
    googleTranslateElementInit?: () => void;
    google?: {
      translate?: {
        TranslateElement: new (
          options: { pageLanguage: string; includedLanguages: string; autoDisplay: boolean },
          elementId: string
        ) => unknown;
      };
    };
  }
  // TypeScript's DOM lib only declares `forEach` for the CSS Custom
  // Highlight API's Highlight/HighlightRegistry — these Set/Map-like
  // methods are real at runtime (MDN) but missing from lib.dom.d.ts.
  interface Highlight {
    add(range: AbstractRange): void;
    clear(): void;
  }
  interface HighlightRegistry {
    set(name: string, highlight: Highlight): HighlightRegistry;
    delete(name: string): boolean;
  }
}

const LANGUAGES = [
  { code: "en", label: "English (original)", flag: "🇬🇧" },
  { code: "ar", label: "Arabic", flag: "🇸🇦" },
  { code: "zh-CN", label: "Chinese / Mandarin (Simplified)", flag: "🇨🇳" },
  { code: "nl", label: "Dutch", flag: "🇳🇱" },
  { code: "fr", label: "French", flag: "🇫🇷" },
  { code: "de", label: "German", flag: "🇩🇪" },
  { code: "hi", label: "Hindi", flag: "🇮🇳" },
  { code: "id", label: "Indonesian", flag: "🇮🇩" },
  { code: "it", label: "Italian", flag: "🇮🇹" },
  { code: "ja", label: "Japanese", flag: "🇯🇵" },
  { code: "ko", label: "Korean", flag: "🇰🇷" },
  { code: "ms", label: "Malay", flag: "🇲🇾" },
  { code: "fa", label: "Persian (Iran)", flag: "🇮🇷" },
  { code: "pt", label: "Portuguese", flag: "🇵🇹" },
  { code: "ru", label: "Russian", flag: "🇷🇺" },
  { code: "es", label: "Spanish", flag: "🇪🇸" },
  { code: "th", label: "Thai", flag: "🇹🇭" },
  { code: "vi", label: "Vietnamese", flag: "🇻🇳" },
] as const;

const GOOGLE_TRANSLATE_SCRIPT_ID = "google-translate-script";
const SENTENCE_CHUNK_MAX = 200;
const KEEP_ALIVE_MS = 10_000;

const BLOCK_DISPLAY = new Set([
  "block", "flex", "grid", "table", "list-item", "table-row",
  "table-row-group", "table-cell", "table-caption", "flow-root",
]);

interface TextSegment {
  node: Text;
  /** Offset within `node.data` where this segment's text begins. */
  offset: number;
  /** Start/end offset of this segment within the assembled reading text. */
  start: number;
  end: number;
}

function isReadableElement(el: Element): boolean {
  if (typeof el.checkVisibility === "function") {
    return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  }
  return (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === "fixed";
}

/** Walks visible text nodes under `root` (optionally narrowed to a Range, for
 * "read the selected text only") and builds both the plain string that gets
 * queued for speech AND a map back from character offsets in that string to
 * real DOM (Text node, offset) positions — so the currently-spoken word can
 * be highlighted live via the CSS Custom Highlight API without mutating the
 * page's DOM (safe alongside React, which owns these nodes). */
function collectReadableSegments(root: Node, range?: Range): { text: string; segments: TextSegment[] } {
  const segments: TextSegment[] = [];
  let text = "";
  const blockCache = new Map<Element, Element>();
  const closestBlock = (el: Element): Element => {
    const cached = blockCache.get(el);
    if (cached) return cached;
    let cur: Element | null = el;
    while (cur && cur !== root && !BLOCK_DISPLAY.has(getComputedStyle(cur).display)) {
      cur = cur.parentElement;
    }
    const result = cur ?? el;
    blockCache.set(el, result);
    return result;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest('[data-a11y-skip-read="true"], [aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
      if (!isReadableElement(parent)) return NodeFilter.FILTER_REJECT;
      if (range && !range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      return (node as Text).data.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let lastBlock: Element | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    let start = 0;
    let end = textNode.data.length;
    if (range) {
      if (textNode === range.startContainer) start = range.startOffset;
      if (textNode === range.endContainer) end = range.endOffset;
    }
    if (end <= start) continue;
    const raw = textNode.data.slice(start, end);
    if (!raw) continue;

    const block = closestBlock(textNode.parentElement!);
    if (lastBlock && block !== lastBlock && text && !/\s$/.test(text)) text += "\n";
    lastBlock = block;

    segments.push({ node: textNode, offset: start, start: text.length, end: text.length + raw.length });
    text += raw;
  }
  return { text, segments };
}

/** Resolves the word boundaries around a spoken-boundary event's charIndex
 * within `chunk`. Prefers the browser-supplied charLength (most reliable);
 * falls back to Intl.Segmenter word segmentation (handles CJK/Thai, which
 * have no whitespace between words), then a plain whitespace split. */
function wordBoundsAt(chunk: string, charIndex: number, charLength: number | undefined, lang: string): [number, number] {
  if (charLength && charLength > 0) return [charIndex, Math.min(chunk.length, charIndex + charLength)];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter(lang || undefined, { granularity: "word" });
      for (const seg of segmenter.segment(chunk)) {
        if (charIndex >= seg.index && charIndex < seg.index + seg.segment.length) {
          return [seg.index, seg.index + seg.segment.length];
        }
      }
    } catch {
      // Unsupported locale tag — fall through to the whitespace heuristic.
    }
  }
  let start = charIndex;
  while (start < chunk.length && /\s/.test(chunk[start])) start++;
  let end = start;
  while (end < chunk.length && !/\s/.test(chunk[end])) end++;
  return [start, end];
}

function chunkText(text: string): string[] {
  if (!text) return [];
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length > SENTENCE_CHUNK_MAX && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

// First names of common system voices across languages/platforms (Windows
// SAPI, Edge/Azure neural voices, macOS voices) so gender curation works for
// more than just English. Best-effort — coverage depends on what's actually
// installed on the visitor's device.
const MALE_VOICE_HINTS = [
  "david", "mark", "guy", "daniel", "alex", "fred", "tom", "james", "george", "ryan", "conrad", "stefan",
  "henri", "paul", "pablo", "alvaro", "diego", "antonio", "cosimo", "pavel", "dmitry", "naayf", "hamed",
  "hemant", "madhur", "pattara", "niwat", "kangkang", "zhiwei", "yunyang", "yunxi", "ichiro", "keita",
  "injoon", "andika", "nammin", "male",
];
const FEMALE_VOICE_HINTS = [
  "zira", "eva", "samantha", "victoria", "susan", "karen", "moira", "tessa", "fiona", "aria", "jenny",
  "salli", "joanna", "kendra", "ivy", "hazel", "sonia", "denise", "hedda", "katja", "helena", "laura",
  "elvira", "elsa", "isabella", "maria", "helia", "francisca", "irina", "svetlana", "hoda", "salma",
  "kalpana", "swara", "premwadee", "achara", "hoaimy", "gadis", "yating", "hanhan", "huihui", "yaoyao",
  "xiaoxiao", "haruka", "nanami", "heami", "sunhi", "hortense", "julie", "female",
];

function guessVoiceGender(name: string): "male" | "female" | "unknown" {
  const n = name.toLowerCase();
  if (MALE_VOICE_HINTS.some((hint) => n.includes(hint))) return "male";
  if (FEMALE_VOICE_HINTS.some((hint) => n.includes(hint))) return "female";
  return "unknown";
}

/** Strips platform branding ("Microsoft David - English (United States)" →
 * "David") so the dropdown just shows the voice's given name. */
function cleanVoiceLabel(name: string): string {
  return name.replace(/^(Microsoft|Google|Apple)\s+/i, "").split(" - ")[0].trim();
}

/** Picks up to 2 male + 2 female voices that actually speak the given
 * language (matched by BCP-47 prefix, e.g. "zh" matches "zh-CN"/"zh-TW") —
 * so Read Aloud sounds like a native speaker of whatever the page is
 * currently translated into, instead of an English voice mangling
 * non-English text. Returns [] if no voice for that language is installed;
 * callers should leave the browser's own default voice in charge then. */
function curateVoicesForLanguage(all: SpeechSynthesisVoice[], langPrefix: string): SpeechSynthesisVoice[] {
  const matches = all.filter((v) => v.lang.toLowerCase().startsWith(langPrefix.toLowerCase()));
  if (matches.length === 0) return [];
  const males = matches.filter((v) => guessVoiceGender(v.name) === "male").slice(0, 2);
  const females = matches.filter((v) => guessVoiceGender(v.name) === "female").slice(0, 2);
  const curated = [...males, ...females];
  return curated.length > 0 ? curated : matches.slice(0, 4);
}

export default function AccessibilityToolbar() {
  const [open, setOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState("en");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rate, setRate] = useState(1);
  const [allVoices, setAllVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");

  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const queueRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const charIndexRef = useRef(0);
  const rateRef = useRef(1);
  const segmentsRef = useRef<TextSegment[]>([]);
  const chunkOffsetsRef = useRef<number[]>([]);
  const highlightRef = useRef<Highlight | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const selectedLangRef = useRef("en");
  const restartingRef = useRef(false);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const loadVoices = () => setAllVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const langPrefix = selectedLang.split("-")[0];
  const curatedVoices = useMemo(
    () => curateVoicesForLanguage(allVoices, langPrefix),
    [allVoices, langPrefix]
  );

  useEffect(() => {
    selectedLangRef.current = selectedLang;
  }, [selectedLang]);

  useEffect(() => {
    setSelectedVoiceURI((prev) =>
      curatedVoices.some((v) => v.voiceURI === prev) ? prev : curatedVoices[0]?.voiceURI ?? ""
    );
  }, [curatedVoices]);

  useEffect(() => {
    voiceRef.current = curatedVoices.find((v) => v.voiceURI === selectedVoiceURI) ?? null;
  }, [curatedVoices, selectedVoiceURI]);

  const handleDragMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return;
    const panelW = panelRef.current?.offsetWidth ?? 288;
    const panelH = panelRef.current?.offsetHeight ?? 300;
    const x = Math.min(Math.max(8, e.clientX - dragOffsetRef.current.x), window.innerWidth - panelW - 8);
    const y = Math.min(Math.max(8, e.clientY - dragOffsetRef.current.y), window.innerHeight - panelH - 8);
    setDragPos({ x, y });
  }, []);

  const handleDragEnd = useCallback(() => {
    draggingRef.current = false;
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragEnd);
  }, [handleDragMove]);

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      e.preventDefault();
      draggingRef.current = true;
      dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setDragPos({ x: rect.left, y: rect.top });
      window.addEventListener("pointermove", handleDragMove);
      window.addEventListener("pointerup", handleDragEnd);
    },
    [handleDragMove, handleDragEnd]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  const stopKeepAlive = useCallback(() => {
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    keepAliveRef.current = null;
  }, []);

  const startKeepAlive = useCallback(() => {
    stopKeepAlive();
    // Chrome auto-pauses speechSynthesis after ~15s of silence between
    // utterances unless nudged — this keeps long pages reading smoothly.
    keepAliveRef.current = setInterval(() => {
      const synth = window.speechSynthesis;
      if (synth.speaking && !synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, KEEP_ALIVE_MS);
  }, [stopKeepAlive]);

  const clearHighlight = useCallback(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    highlightRef.current?.clear();
    CSS.highlights.delete("read-aloud-cursor");
    highlightRef.current = null;
  }, []);

  /** Highlights the word currently being spoken (given as a [start, end)
   * offset pair into the assembled reading text) using the CSS Custom
   * Highlight API — it styles arbitrary Ranges without touching the DOM, so
   * it can't conflict with React re-rendering the same text nodes. */
  const applyHighlight = useCallback((absStart: number, absEnd: number) => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const range = new Range();
    let rangeSet = false;
    for (const seg of segmentsRef.current) {
      if (seg.end <= absStart || seg.start >= absEnd) continue;
      const localStart = seg.offset + Math.max(absStart, seg.start) - seg.start;
      const localEnd = seg.offset + Math.min(absEnd, seg.end) - seg.start;
      if (!rangeSet) {
        range.setStart(seg.node, localStart);
        rangeSet = true;
      }
      range.setEnd(seg.node, localEnd);
    }
    if (!rangeSet) return;
    if (!highlightRef.current) {
      highlightRef.current = new Highlight();
      CSS.highlights.set("read-aloud-cursor", highlightRef.current);
    }
    highlightRef.current.clear();
    highlightRef.current.add(range);
    const rect = range.getBoundingClientRect();
    if (rect.top < 96 || rect.bottom > window.innerHeight - 96) {
      range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, []);

  const speakNext = useCallback(() => {
    const queue = queueRef.current;
    const idx = indexRef.current;
    if (idx >= queue.length) {
      setIsSpeaking(false);
      setIsPaused(false);
      stopKeepAlive();
      clearHighlight();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(queue[idx]);
    utterance.rate = rateRef.current;
    utterance.lang = selectedLangRef.current;
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.onboundary = (e) => {
      charIndexRef.current = e.charIndex;
      if (e.name && e.name !== "word") return;
      const chunk = queueRef.current[idx];
      if (!chunk) return;
      const [wStart, wEnd] = wordBoundsAt(chunk, e.charIndex, e.charLength, selectedLangRef.current);
      const base = chunkOffsetsRef.current[idx] ?? 0;
      applyHighlight(base + wStart, base + wEnd);
    };
    utterance.onend = () => {
      indexRef.current += 1;
      charIndexRef.current = 0;
      speakNext();
    };
    utterance.onerror = () => {
      // A cancel() triggered by a live speed change fires this too — swallow
      // it there so it doesn't look like reading stopped/broke.
      if (restartingRef.current) {
        restartingRef.current = false;
        return;
      }
      setIsSpeaking(false);
      setIsPaused(false);
      stopKeepAlive();
      clearHighlight();
    };
    window.speechSynthesis.speak(utterance);
  }, [stopKeepAlive, clearHighlight, applyHighlight]);

  /** Speed slider changes can't alter an utterance already in progress (the
   * Web Speech API bakes `rate` in at speak()-time), so to make it feel
   * "live" we cancel the current chunk and re-speak only its unread
   * remainder (tracked via onboundary) at the new rate. */
  const applyRateChange = useCallback(
    (newRate: number) => {
      setRate(newRate);
      rateRef.current = newRate;
      const synth = window.speechSynthesis;
      if (!isSpeaking || isPaused || !synth.speaking) return;
      const idx = indexRef.current;
      const currentChunk = queueRef.current[idx];
      if (!currentChunk) return;
      const remaining = currentChunk.slice(charIndexRef.current).trimStart();
      if (!remaining) return;
      restartingRef.current = true;
      // Keep absolute-offset math (used for word highlighting) correct: the
      // chunk shrank by the part we already read, so bump its recorded
      // start offset by the same amount.
      chunkOffsetsRef.current[idx] = (chunkOffsetsRef.current[idx] ?? 0) + (currentChunk.length - remaining.length);
      queueRef.current[idx] = remaining;
      charIndexRef.current = 0;
      synth.cancel();
      setTimeout(() => speakNext(), 50);
    },
    [isSpeaking, isPaused, speakNext]
  );

  const handlePlayPause = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!isSpeaking) {
      synth.cancel();
      const selection = window.getSelection();
      const hasSelection = !!selection && selection.rangeCount > 0 && selection.toString().trim().length > 0;
      const root = (document.querySelector("main") ?? document.body) as HTMLElement;
      const { text, segments } = hasSelection
        ? collectReadableSegments(root, selection!.getRangeAt(0))
        : collectReadableSegments(root);
      segmentsRef.current = segments;
      const chunks = chunkText(text);
      let pos = 0;
      chunkOffsetsRef.current = chunks.map((c) => {
        const offset = pos;
        pos += c.length;
        return offset;
      });
      queueRef.current = chunks;
      indexRef.current = 0;
      setIsSpeaking(true);
      setIsPaused(false);
      speakNext();
      startKeepAlive();
    } else if (isPaused) {
      synth.resume();
      setIsPaused(false);
    } else {
      synth.pause();
      setIsPaused(true);
    }
  }, [isSpeaking, isPaused, speakNext, startKeepAlive]);

  const handleStop = useCallback(() => {
    window.speechSynthesis.cancel();
    stopKeepAlive();
    clearHighlight();
    setIsSpeaking(false);
    setIsPaused(false);
  }, [stopKeepAlive, clearHighlight]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      stopKeepAlive();
      clearHighlight();
    };
  }, [stopKeepAlive, clearHighlight]);

  // Google Website Translator — loaded once, driven entirely through our own
  // dropdown; its default banner/gadget UI is hidden via globals.css.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const init = () => {
      if (!window.google?.translate) return;
      if (!document.querySelector("#google_translate_element .goog-te-combo")) {
        new window.google.translate.TranslateElement(
          {
            pageLanguage: "en",
            includedLanguages: LANGUAGES.map((l) => l.code).join(","),
            autoDisplay: false,
          },
          "google_translate_element"
        );
      }
    };
    if (window.google?.translate?.TranslateElement) {
      init();
      return;
    }
    window.googleTranslateElementInit = init;
    if (document.getElementById(GOOGLE_TRANSLATE_SCRIPT_ID)) return;
    const script = document.createElement("script");
    script.id = GOOGLE_TRANSLATE_SCRIPT_ID;
    script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const selectLanguage = useCallback((code: string) => {
    setSelectedLang(code);
    setLangMenuOpen(false);
    if (code === "en") {
      // Deleting the cookie doesn't reliably stick — setting it to a
      // same-language (en→en) pair is the trick that actually resets it.
      document.cookie = "googtrans=/en/en; path=/;";
      document.cookie = `googtrans=/en/en; path=/; domain=${window.location.hostname}`;
      window.location.reload();
      return;
    }
    let attempts = 0;
    const tryApply = () => {
      const combo = document.querySelector<HTMLSelectElement>(".goog-te-combo");
      if (combo) {
        combo.value = code;
        combo.dispatchEvent(new Event("change"));
      } else if (attempts < 10) {
        attempts += 1;
        setTimeout(tryApply, 300);
      }
    };
    tryApply();
  }, []);

  const current = LANGUAGES.find((l) => l.code === selectedLang) ?? LANGUAGES[0];

  return (
    <div
      data-a11y-skip-read="true"
      className="fixed top-56 right-4 z-[60] flex flex-col items-end gap-2 sm:top-36 print:hidden"
    >
      {/* Read Aloud word cursor — styled via the CSS Custom Highlight API, which
          doesn't require mutating the page's DOM. Rendered as a literal <style>
          tag (not globals.css) because the build's CSS parser doesn't yet
          recognize the ::highlight() functional pseudo-element syntax. */}
      <style>{"::highlight(read-aloud-cursor) { background-color: #fde68a; color: #451a03; }"}</style>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Accessibility: read aloud and translate"
        title={open ? "Close Read Aloud & Translate" : "Read Aloud & Translate"}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-xl text-white shadow-lg hover:bg-neutral-800"
      >
        🌐
      </button>
      {open && (
        <div
          ref={panelRef}
          className="relative w-72 rounded-xl border border-neutral-200 bg-white p-4 shadow-2xl"
          style={dragPos ? { position: "fixed", left: dragPos.x, top: dragPos.y, right: "auto", bottom: "auto" } : undefined}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close accessibility panel"
            title="Close"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            ✕
          </button>

          <div
            onPointerDown={handleDragStart}
            title="Drag to move"
            aria-label="Drag to move this panel"
            className="mb-2 flex cursor-move flex-col items-center justify-center gap-1 rounded-md py-1 pr-6 hover:bg-neutral-50"
          >
            <span className="h-1 w-10 rounded-full bg-neutral-300" />
            <span className="text-center text-[10px] leading-tight text-neutral-400">
              Move me around the page by clicking this bottom line
            </span>
          </div>

          <div className="mb-4 pr-6">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Read Aloud</p>
            <p className="mb-1.5 text-[11px] text-neutral-400">
              Select some text on the page first, then press play to read it aloud — otherwise the
              play button will read the whole page.
            </p>
            <p className="mb-1.5 text-[11px] text-neutral-400">
              The word currently being read is highlighted on the page as you listen, in any
              language.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePlayPause}
                aria-label={isSpeaking && !isPaused ? "Pause reading" : "Play reading"}
                title={isSpeaking && !isPaused ? "Pause reading" : "Play reading"}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-700 text-white hover:bg-red-600"
              >
                {isSpeaking && !isPaused ? "⏸" : "▶"}
              </button>
              <button
                type="button"
                onClick={handleStop}
                disabled={!isSpeaking}
                aria-label="Stop reading"
                title="Stop reading"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
              >
                ⏹
              </button>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={rate}
                onChange={(e) => applyRateChange(parseFloat(e.target.value))}
                aria-label="Reading speed"
                title="Reading speed — adjusts live, even mid-sentence, in any language"
                className="flex-1 accent-red-700"
              />
              <span className="w-9 shrink-0 text-right text-xs text-neutral-500">{rate.toFixed(1)}x</span>
            </div>

            <div className="mt-2.5">
              <label htmlFor="a11y-voice-select" className="mb-1 block text-[11px] font-semibold text-neutral-500">
                Voice Selection
              </label>
              {curatedVoices.length > 0 ? (
                <>
                  <select
                    id="a11y-voice-select"
                    value={selectedVoiceURI}
                    onChange={(e) => setSelectedVoiceURI(e.target.value)}
                    title="Choose a reading voice"
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  >
                    {curatedVoices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {current.flag} {cleanVoiceLabel(v.name)}
                      </option>
                    ))}
                  </select>
                  {curatedVoices.length < 4 && (
                    <p className="mt-1 text-[11px] text-neutral-400">
                      Only {curatedVoices.length} {current.label} voice{curatedVoices.length === 1 ? "" : "s"} found
                      on this device (aiming for up to 2 male + 2 female).
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-neutral-400">
                  No {current.label} voice installed on this device — using the browser&apos;s default voice
                  instead.
                </p>
              )}
              <p className="mt-1 text-[11px] text-neutral-400">
                Voice Selection depends on your device&apos;s OS system availability.
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Translate</p>
            <button
              type="button"
              onClick={() => setLangMenuOpen((v) => !v)}
              title="Translate this page"
              className="flex w-full items-center justify-between rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
            >
              <span>
                {current.flag} {current.label}
              </span>
              <span className="text-neutral-400">▾</span>
            </button>
            {langMenuOpen && (
              <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => selectLanguage(l.code)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 ${
                      l.code === selectedLang ? "bg-red-50 font-semibold text-red-700" : "text-neutral-700"
                    }`}
                  >
                    <span>{l.flag}</span>
                    <span>{l.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <div id="google_translate_element" />
    </div>
  );
}
