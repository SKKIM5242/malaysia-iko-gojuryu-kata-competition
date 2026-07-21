"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import OptionPicker from "@/components/OptionPicker";

/** Dropdown filters for the Kata Arena — Competition Tier, Kata, Belt
 * division, Age, and Sex/Mix section. Selections live in the URL query so
 * the server page does the filtering and the choice survives reloads and
 * sharing. */
export default function ArenaFilterBar({
  tiers,
  katas,
  belts,
  ages,
  sexes,
  showTier = true,
}: {
  tiers: Array<{ id: string; name: string }>;
  katas: string[];
  belts: string[];
  ages: string[];
  sexes: string[];
  showTier?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`);
  }

  const tierBoxWidth = "w-64";
  const selectCls =
    `truncate rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm font-normal text-neutral-800 ${tierBoxWidth}`;
  const labelCls = "flex flex-col gap-0.5 text-xs font-semibold text-neutral-500";

  return (
    <div className="mb-6 flex flex-wrap gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-sm">
      {showTier && (
        <label className={labelCls}>
          Competition Tier
          <select value={params.get("tier") ?? ""} onChange={(e) => setParam("tier", e.target.value)} className={selectCls}>
            <option value="">All</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      )}
      <OptionPicker
        label="Kata"
        value={params.get("kata") ?? ""}
        options={katas}
        onChange={(v) => setParam("kata", v)}
        triggerClassName={tierBoxWidth}
      />
      <label className={labelCls}>
        Belt Division
        <select value={params.get("belt") ?? ""} onChange={(e) => setParam("belt", e.target.value)} className={selectCls}>
          <option value="">All</option>
          {belts.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        Age
        <select value={params.get("age") ?? ""} onChange={(e) => setParam("age", e.target.value)} className={selectCls}>
          <option value="">All</option>
          {ages.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        Sex / Mix
        <select value={params.get("sex") ?? ""} onChange={(e) => setParam("sex", e.target.value)} className={selectCls}>
          <option value="">All</option>
          {sexes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
