"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

function getReadableText(): string {
  const root = (document.querySelector("main") ?? document.body) as HTMLElement;
  return root.innerText.trim();
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

export default function AccessibilityToolbar() {
  const [open, setOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState("en");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rate, setRate] = useState(1);

  const queueRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const rateRef = useRef(1);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

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

  const speakNext = useCallback(() => {
    const queue = queueRef.current;
    const idx = indexRef.current;
    if (idx >= queue.length) {
      setIsSpeaking(false);
      setIsPaused(false);
      stopKeepAlive();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(queue[idx]);
    utterance.rate = rateRef.current;
    utterance.onend = () => {
      indexRef.current += 1;
      speakNext();
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      stopKeepAlive();
    };
    window.speechSynthesis.speak(utterance);
  }, [stopKeepAlive]);

  const handlePlayPause = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!isSpeaking) {
      synth.cancel();
      const selected = window.getSelection()?.toString().trim();
      queueRef.current = chunkText(selected || getReadableText());
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
    setIsSpeaking(false);
    setIsPaused(false);
  }, [stopKeepAlive]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      stopKeepAlive();
    };
  }, [stopKeepAlive]);

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
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2 print:hidden">
      {open && (
        <div className="w-72 rounded-xl border border-neutral-200 bg-white p-4 shadow-2xl">
          <div className="mb-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Read Aloud</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePlayPause}
                aria-label={isSpeaking && !isPaused ? "Pause reading" : "Play reading"}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-700 text-white hover:bg-red-600"
              >
                {isSpeaking && !isPaused ? "⏸" : "▶"}
              </button>
              <button
                type="button"
                onClick={handleStop}
                disabled={!isSpeaking}
                aria-label="Stop reading"
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
                onChange={(e) => setRate(parseFloat(e.target.value))}
                aria-label="Reading speed"
                className="flex-1 accent-red-700"
              />
              <span className="w-9 shrink-0 text-right text-xs text-neutral-500">{rate.toFixed(1)}x</span>
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-400">
              Select some text on the page first to read just that part — otherwise the whole page is read.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Translate</p>
            <button
              type="button"
              onClick={() => setLangMenuOpen((v) => !v)}
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

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Accessibility: read aloud and translate"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-xl text-white shadow-lg hover:bg-neutral-800"
      >
        🌐
      </button>
      <div id="google_translate_element" />
    </div>
  );
}
