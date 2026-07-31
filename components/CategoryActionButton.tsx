"use client";

import { useTransition } from "react";
import { deleteCategory, mergeCategoryToMix, mergeCategoryAgeGroup, mergeKataFamily, mergeKataBeltGroup } from "@/app/actions/admin";

const ACTIONS = {
  mergeToMix: mergeCategoryToMix,
  mergeAgeGroup: mergeCategoryAgeGroup,
  mergeFamily: mergeKataFamily,
  mergeBeltGroup: mergeKataBeltGroup,
  delete: deleteCategory,
} as const;

/**
 * Calls a Server Action directly on click instead of wiring it through a
 * <form action={fn}> element, AND imports the action itself at module level
 * (like KataGroupDragZone/SubcategoryDragZone already do) instead of taking
 * it as a prop from the server-rendered tree above.
 *
 * This page renders one row per kata sub-category (~300 per competition,
 * ~900 across all three tiers), each with up to 3 of these buttons. Passing
 * a Server Action down through props -- whether via <form action={fn}> or as
 * a Client Component prop -- makes Next serialize a fresh signed reference
 * to it for every single occurrence; with ~900 rows that added 40+ seconds
 * to this page's render (confirmed in a production build, not just dev).
 * Importing the action directly means each Client Component's own bundle
 * already resolves it once, with nothing per-instance to serialize.
 */
export default function CategoryActionButton({
  actionName,
  fields,
  className,
  title,
  confirmMessage,
  children,
}: {
  actionName: keyof typeof ACTIONS;
  fields: Record<string, string>;
  className?: string;
  title?: string;
  /** When set, a native browser confirm() must be accepted before the
   * action runs — for actions bigger than a single row (e.g. mergeFamily,
   * which can consolidate 100+ categories in one click). */
  confirmMessage?: string;
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const action = ACTIONS[actionName];
  return (
    <button
      type="button"
      className={className}
      title={title}
      disabled={pending}
      onClick={() => {
        if (confirmMessage && !window.confirm(confirmMessage)) return;
        const formData = new FormData();
        for (const [key, value] of Object.entries(fields)) formData.set(key, value);
        startTransition(() => {
          action(formData);
        });
      }}
    >
      {children}
    </button>
  );
}
