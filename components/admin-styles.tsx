/** Shared admin-panel form styling constants — kept in their own module
 * (no server-only imports) so client components can use them without
 * pulling in components/admin.tsx's AdminShell, which needs next/headers
 * and can't be part of a client bundle. components/admin.tsx re-exports
 * these same constants for existing server-component call sites. */
export const adminInput =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";
export const adminLabel = "mb-1 block text-sm font-medium text-neutral-700";
export const adminBtn =
  "rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600";
export const adminBtnSecondary =
  "rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50";
