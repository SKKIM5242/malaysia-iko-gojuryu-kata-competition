/** A device-local, per-registration backup of a just-recorded kata video --
 * exists purely for poor-connectivity moments where the normal record ->
 * upload -> submit flow can't complete in one go. The recording itself is
 * still only ever produced by KataRecorder's own in-app camera (see its own
 * "no file upload or editing" rule); this just lets that SAME already-made
 * recording survive a failed upload and be retried later, including after
 * the tab or app was closed in between.
 *
 * IndexedDB (not localStorage, which can't hold a Blob and has a tiny
 * string-only quota) keyed by registrationId -- a login linked to several
 * participants can have more than one recording cached at once, each
 * independent of the others. */

const DB_NAME = "kata-local-recordings";
const DB_VERSION = 1;
const STORE = "recordings";

interface StoredRecording {
  blob: Blob;
  mime: string;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Never throws -- a save failure (private browsing, storage full, browser
 * without IndexedDB) just means no local backup exists, not a broken
 * recording flow. Callers should fire-and-forget this. */
export async function saveLocalRecording(registrationId: string, blob: Blob, mime: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ blob, mime, savedAt: Date.now() } satisfies StoredRecording, registrationId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // No local backup this time -- the participant still has the normal
    // upload path and, if they used it, their own device's Save option.
  }
}

/** Returns null on any failure or if nothing was ever saved for this
 * registration -- callers treat that as "no local backup available", not
 * an error to surface. */
export async function getLocalRecording(registrationId: string): Promise<{ blob: Blob; mime: string } | null> {
  try {
    const db = await openDb();
    const result = await new Promise<StoredRecording | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(registrationId);
      req.onsuccess = () => resolve(req.result as StoredRecording | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result ? { blob: result.blob, mime: result.mime } : null;
  } catch {
    return null;
  }
}

/** Called once a recording has been successfully submitted (via either the
 * normal in-app path or the saved-recording upload path) so a stale local
 * copy doesn't keep offering itself for re-upload. Never throws. */
export async function clearLocalRecording(registrationId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(registrationId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Nothing to clean up if the store never worked in the first place.
  }
}
