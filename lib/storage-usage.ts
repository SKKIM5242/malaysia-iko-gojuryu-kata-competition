import { createAdminClient } from "@/lib/supabase/admin";
import { UPLOAD_CEILING_BYTES } from "@/lib/media-recording";

export interface StorageObject {
  bucket: string;
  path: string;
  bytes: number;
  createdAt: string | null;
}

export interface BucketUsage {
  id: string;
  isPublic: boolean;
  /** The bucket's OWN per-file limit. Frequently larger than the project
   * ceiling, in which case it never actually applies — see
   * effectiveFileLimit below. */
  fileSizeLimit: number | null;
  files: number;
  bytes: number;
}

export interface StorageUsage {
  buckets: BucketUsage[];
  totalBytes: number;
  totalFiles: number;
  largest: StorageObject[];
  /** Set when a bucket could not be listed at all, so the page can say the
   * totals are incomplete rather than quietly under-reporting. */
  errors: string[];
}

/** Supabase's own plan allowances, for the "how much room is left" read.
 * These are the storage quotas, not the per-file ceiling. */
export const PLAN_QUOTAS: Array<{ plan: string; bytes: number }> = [
  { plan: "Free", bytes: 1 * 1024 * 1024 * 1024 },
  { plan: "Pro", bytes: 100 * 1024 * 1024 * 1024 },
];

/** The size limit that actually applies to a file going into this bucket:
 * the smaller of the bucket's own setting and the project-wide ceiling. The
 * distinction matters — kata-videos advertises 500MB, but a 60MB upload into
 * it is still rejected, which is exactly the confusion this surfaces. */
export function effectiveFileLimit(bucket: BucketUsage): number {
  return bucket.fileSizeLimit != null
    ? Math.min(bucket.fileSizeLimit, UPLOAD_CEILING_BYTES)
    : UPLOAD_CEILING_BYTES;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Walks every bucket and sums what is actually stored.
 *
 * Storage has no "total size" endpoint, so this lists objects and adds up
 * their metadata. Paths in this project are `userId/file`, so the listing
 * has to recurse: a folder comes back as an entry with a null id and null
 * metadata, and counting those as files would report a size of zero for
 * everything. Depth is bounded by `maxDepth` so a pathological tree can
 * never turn this page into an unbounded crawl.
 */
export async function getStorageUsage(maxDepth = 3): Promise<StorageUsage> {
  const admin = createAdminClient();
  const errors: string[] = [];
  const { data: buckets, error: bucketErr } = await admin.storage.listBuckets();
  if (bucketErr || !buckets) {
    return { buckets: [], totalBytes: 0, totalFiles: 0, largest: [], errors: [bucketErr?.message ?? "Could not list buckets."] };
  }

  const all: StorageObject[] = [];
  const usage: BucketUsage[] = [];

  for (const b of buckets) {
    let files = 0;
    let bytes = 0;

    const walk = async (prefix: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      let offset = 0;
      for (;;) {
        const { data: items, error } = await admin.storage
          .from(b.id)
          .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
        if (error) {
          errors.push(`${b.id}${prefix ? `/${prefix}` : ""}: ${error.message}`);
          return;
        }
        if (!items || items.length === 0) return;
        for (const it of items) {
          const full = prefix ? `${prefix}/${it.name}` : it.name;
          // A folder: null id AND null metadata. Checking only one of the
          // two misses real files whose metadata failed to populate.
          if (it.id === null && it.metadata === null) {
            await walk(full, depth + 1);
            continue;
          }
          const size = (it.metadata as { size?: number } | null)?.size ?? 0;
          files += 1;
          bytes += size;
          all.push({ bucket: b.id, path: full, bytes: size, createdAt: it.created_at ?? null });
        }
        if (items.length < 1000) return;
        offset += 1000;
      }
    };

    await walk("", 0);
    usage.push({
      id: b.id,
      isPublic: Boolean((b as { public?: boolean }).public),
      fileSizeLimit: (b as { file_size_limit?: number | null }).file_size_limit ?? null,
      files,
      bytes,
    });
  }

  usage.sort((a, b) => b.bytes - a.bytes);
  all.sort((a, b) => b.bytes - a.bytes);

  return {
    buckets: usage,
    totalBytes: usage.reduce((s, b) => s + b.bytes, 0),
    totalFiles: usage.reduce((s, b) => s + b.files, 0),
    largest: all.slice(0, 20),
    errors,
  };
}
