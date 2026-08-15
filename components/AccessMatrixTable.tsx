import FilterableTable from "@/components/FilterableTable";
import type { AccessRow } from "@/lib/access-matrix";

/**
 * Renders the Access Matrix as an adjustable, filterable table — shared by
 * the admin /admin/accounts?tab=access page and the published "Admin Panel
 * Access Matrix" announcement (see app/announcements/[slug]/page.tsx),
 * so both stay in sync with a single implementation.
 */
export default function AccessMatrixTable({ rows }: { rows: AccessRow[] }) {
  return (
    <FilterableTable
      rowKey="resource_text"
      downloadName="access-matrix"
      columns={[
        { key: "resource", label: "Resource", wrap: true },
        { key: "admin", label: "Admin" },
        { key: "organizer", label: "Organizer / Staff" },
        { key: "customerSupport", label: "Participant Support" },
        { key: "referee", label: "Judge" },
      ]}
      rows={rows.map((row) => ({
        resource: row.note ? (
          <>
            <p className="whitespace-normal break-words">{row.resource}</p>
            <p className="mt-1 whitespace-normal break-words text-xs font-normal text-neutral-400">{row.note}</p>
          </>
        ) : (
          row.resource
        ),
        resource_text: row.resource,
        admin: row.admin,
        organizer: row.organizer,
        customerSupport: row.customerSupport,
        referee: row.referee,
      }))}
      csvColumns={[
        { key: "resource_text", label: "Resource" },
        { key: "admin", label: "Admin" },
        { key: "organizer", label: "Organizer / Staff" },
        { key: "customerSupport", label: "Participant Support" },
        { key: "referee", label: "Judge" },
      ]}
    />
  );
}
