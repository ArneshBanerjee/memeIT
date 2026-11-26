export type BrowserMeme = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  filename: string;
  kind: "png";
  favorite: boolean;
  last_used: number | null;
};

const DATABASE = "memeit-browser-library";
const MAX_DATA_URL = 20 * 1024 * 1024;
const PNG_PREFIX = "data:image/png;base64,";
let opening: Promise<IDBDatabase> | undefined;

function storageError(error: unknown): Error {
  const name = error instanceof DOMException ? error.name : "";
  return new Error(name === "QuotaExceededError"
    ? "Your browser storage is full. Free some space or use the desktop app to save this meme."
    : "Could not save or open Your memes in this browser. Allow site storage or use the desktop app.");
}

function database(): Promise<IDBDatabase> {
  if (opening) return opening;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : storageError(error));
    };
    const timer = setTimeout(() => fail(new Error("Browser storage is busy. Close other MemeIT tabs and try again.")), 10000);
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("metadata")) db.createObjectStore("metadata", { keyPath: "id" });
        if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "id" });
      };
      request.onblocked = () => fail(new Error("Close other MemeIT tabs, then try saving again."));
      request.onerror = () => fail(storageError(request.error));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        clearTimeout(timer);
        db.onversionchange = () => { db.close(); opening = undefined; };
        db.onclose = () => { opening = undefined; };
        resolve(db);
      };
    } catch (error) { fail(storageError(error)); }
  });
  opening = pending;
  void pending.catch(() => { if (opening === pending) opening = undefined; });
  return pending;
}

function plain(value: unknown, length: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, length) : "";
}

function decodePng(dataUrl: string): Uint8Array<ArrayBuffer> {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_DATA_URL || !dataUrl.startsWith(PNG_PREFIX)) {
    throw new Error("This meme must be a PNG smaller than 20 MB.");
  }
  const encoded = dataUrl.slice(PNG_PREFIX.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("The finished PNG is invalid.");
  let binary: string;
  try { binary = atob(encoded); } catch { throw new Error("The finished PNG is invalid."); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
      || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") throw new Error("The finished image is not a PNG.");
  const header = new DataView(bytes.buffer);
  const width = header.getUint32(16), height = header.getUint32(20);
  if (!width || !height || width > 1600 || height > 1600) throw new Error("Meme exports must fit within 1,600 pixels per side.");
  return bytes;
}

function validMetadata(value: unknown): value is BrowserMeme {
  if (!value || typeof value !== "object") return false;
  const item = value as BrowserMeme;
  return /^browser:[a-f0-9]{64}$/.test(item.id) && item.kind === "png" &&
    typeof item.title === "string" && item.title.length <= 160 &&
    typeof item.description === "string" && item.description.length <= 4000 &&
    Array.isArray(item.tags) && item.tags.length <= 12 && item.tags.every(tag => typeof tag === "string" && tag.length <= 80) &&
    typeof item.filename === "string" && /^memeit-[a-f0-9]{64}\.png$/.test(item.filename) &&
    typeof item.favorite === "boolean" && (item.last_used === null || (Number.isFinite(item.last_used) && item.last_used >= 0));
}

/** Commit metadata and PNG together; equal image bytes reuse the same saved item. */
export async function saveBrowserMeme(
  dataUrl: string,
  template: { title: string; sourceUrl: string; description?: string; tags?: string[] },
  captions: string[],
): Promise<BrowserMeme> {
  const bytes = decodePng(dataUrl);
  if (!globalThis.crypto?.subtle) throw new Error("Saving memes needs a secure browser connection. Open MemeIT over HTTPS or use the desktop app.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
  const title = plain(template.title, 100) || "My meme";
  const text = captions.slice(0, 6).map(caption => plain(caption, 400)).filter(Boolean);
  let source = "";
  try {
    const url = new URL(template.sourceUrl);
    if (url.protocol === "https:" && !url.username && !url.password) source = plain(url.href, 1000);
  } catch { /* A source link is optional for a locally saved image. */ }
  const scene = plain(template.description, 600);
  const provenance = [`Created from ${title}.`, source ? `Source: ${source}` : ""].filter(Boolean).join("\n");
  const context = [scene ? `Scene: ${scene}` : "", provenance].filter(Boolean).join("\n");
  const captionText = text.join("\n").slice(0, 4000 - context.length - 1);
  const tags = [...new Set([
    "created", "captioned", plain(title.toLowerCase(), 80),
    ...(Array.isArray(template.tags) ? template.tags.slice(0, 30) : []).map(tag => plain(tag, 80).toLowerCase()).filter(Boolean),
  ])].slice(0, 12);
  const meme: BrowserMeme = {
    id: `browser:${hash}`,
    title: plain(text[0] ? `${text[0].slice(0, 70)} — ${title}` : title, 160),
    description: [context, captionText].filter(Boolean).join("\n"),
    tags,
    filename: `memeit-${hash}.png`,
    kind: "png",
    favorite: false,
    last_used: Math.floor(Date.now() / 1000),
  };
  const db = await database();
  return new Promise((resolve, reject) => {
    let saved = meme;
    let transaction: IDBTransaction;
    try { transaction = db.transaction(["metadata", "media"], "readwrite"); }
    catch (error) { reject(storageError(error)); return; }
    transaction.oncomplete = () => resolve(saved);
    transaction.onabort = () => reject(storageError(transaction.error));
    transaction.onerror = () => { /* The abort handler reports the atomic failure. */ };
    const metadata = transaction.objectStore("metadata");
    const existing = metadata.get(meme.id);
    existing.onsuccess = () => {
      try {
        if (validMetadata(existing.result)) saved = { ...existing.result, last_used: meme.last_used };
        metadata.put(saved);
        transaction.objectStore("media").put({ id: meme.id, data: new Blob([bytes], { type: "image/png" }) });
      } catch (error) { transaction.abort(); reject(storageError(error)); }
    };
  });
}

async function readStore(store: "metadata" | "media", id?: string): Promise<unknown> {
  const db = await database();
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(store, "readonly");
      const records = transaction.objectStore(store);
      const request = id === undefined ? records.getAll() : records.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(storageError(request.error));
      transaction.onabort = () => reject(storageError(transaction.error));
    } catch (error) { reject(storageError(error)); }
  });
}

export async function listBrowserMemes(): Promise<BrowserMeme[]> {
  const records = await readStore("metadata");
  return Array.isArray(records)
    ? records.filter(validMetadata).sort((a, b) => (b.last_used || 0) - (a.last_used || 0))
    : [];
}

export async function updateBrowserMemeMetadata(
  item: Pick<BrowserMeme, "id" | "title" | "description" | "tags" | "favorite" | "last_used">,
): Promise<BrowserMeme> {
  if (!/^browser:[a-f0-9]{64}$/.test(item.id)) throw new Error("This saved meme could not be found.");
  const db = await database();
  return new Promise((resolve, reject) => {
    let updated: BrowserMeme | undefined;
    let transaction: IDBTransaction;
    try { transaction = db.transaction("metadata", "readwrite"); }
    catch (error) { reject(storageError(error)); return; }
    transaction.oncomplete = () => updated ? resolve(updated) : reject(new Error("This saved meme could not be found."));
    transaction.onabort = () => reject(storageError(transaction.error));
    const store = transaction.objectStore("metadata");
    const request = store.get(item.id);
    request.onsuccess = () => {
      if (!validMetadata(request.result)) return;
      updated = {
        ...request.result,
        title: plain(item.title, 160) || "My meme",
        description: plain(item.description, 4000),
        tags: (Array.isArray(item.tags) ? item.tags : []).slice(0, 12).map(tag => plain(tag, 80)).filter(Boolean),
        favorite: Boolean(item.favorite),
        last_used: item.last_used === null || (Number.isFinite(item.last_used) && item.last_used >= 0) ? item.last_used : request.result.last_used,
      };
      try { store.put(updated); }
      catch (error) { transaction.abort(); reject(storageError(error)); }
    };
  });
}

export async function getBrowserMedia(id: string): Promise<string> {
  if (!/^browser:[a-f0-9]{64}$/.test(id)) throw new Error("This saved meme could not be found.");
  const record = await readStore("media", id) as { data?: unknown } | undefined;
  if (!(record?.data instanceof Blob) || record.data.type !== "image/png" || record.data.size > MAX_DATA_URL * 0.75) {
    throw new Error("This saved image is missing. Recreate it from the original template.");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not open this saved image."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || result.length > MAX_DATA_URL || !result.startsWith(PNG_PREFIX)) reject(new Error("The saved image is invalid."));
      else resolve(result);
    };
    reader.readAsDataURL(record.data as Blob);
  });
}

/**
 * Call from the click handler before awaiting `saved`. ClipboardItem's promised
 * PNG preserves Safari's gesture while deferring image access until the save commits.
 */
export function copyBrowserImage(dataUrl: string | Promise<string>, saved?: Promise<unknown>): Promise<void> {
  const ready = saved ?? Promise.resolve();
  const unavailable = () => new Error("Saved in Your memes. Clipboard access is unavailable in this browser; use the desktop app to copy it directly into your chat.");
  const blob = Promise.all([dataUrl, ready]).then(([url]) => new Blob([decodePng(url)], { type: "image/png" }));
  // Observe a rejected save even when this browser has no ClipboardItem support.
  void blob.catch(() => {});
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined" || !globalThis.isSecureContext) {
    return blob.then(() => { throw unavailable(); });
  }
  let copied: Promise<void>;
  try { copied = navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); }
  catch { return blob.then(() => { throw unavailable(); }); }
  return copied.catch(async () => {
    await blob; // A failed save or image read is never described as successfully saved.
    throw unavailable();
  });
}
