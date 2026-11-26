import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser-library.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const searchJs = ts.transpileModule(readFileSync(new URL('../src/preview-search.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { searchPreview } = await import(`data:text/javascript;base64,${Buffer.from(searchJs).toString('base64')}`);
const globalNames = ['indexedDB', 'FileReader', 'navigator', 'ClipboardItem', 'isSecureContext'];
const originalGlobals = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let api, instance = 0;

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

beforeEach(async () => {
  setGlobal('indexedDB', new IDBFactory());
  // Node has Blob but no FileReader. Only the browser's Blob-to-data-URL boundary
  // is adapted; IndexedDB requests, transactions, and rollback use fake-indexeddb.
  setGlobal('FileReader', class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload?.();
      }).catch(() => this.onerror?.());
    }
  });
  setGlobal('isSecureContext', true);
  setGlobal('navigator', {});
  setGlobal('ClipboardItem', class {
    constructor(data) { this.data = data; }
  });
  // A fresh module also resets its cached database connection for every case.
  const js = `${compiled}\n// Isolated test instance ${++instance}`;
  api = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
});

afterEach(() => {
  for (const name of globalNames) {
    const original = originalGlobals.get(name);
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  }
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Real, minimal 1×1 RGBA PNG fixtures; no artwork or external file dependency.
function png(color = [255, 0, 0, 255]) {
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const image = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, ...color]))), chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${image.toString('base64')}`;
}

const template = { title: 'A familiar format', sourceUrl: 'https://imgflip.com/memegenerator/1/Example' };
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('simultaneous saves deduplicate image bytes and round-trip the PNG', async () => {
  const image = png();
  const [first, second] = await Promise.all([
    api.saveBrowserMeme(image, template, ['same image']),
    api.saveBrowserMeme(image, template, ['another save']),
  ]);
  assert.equal(first.id, second.id);
  assert.match(first.id, /^browser:[a-f0-9]{64}$/);
  assert.equal((await api.listBrowserMemes()).length, 1);
  assert.equal(await api.getBrowserMedia(first.id), image);
});

test('metadata edits persist and survive another save of the same image', async () => {
  const image = png();
  const saved = await api.saveBrowserMeme(image, template, ['original caption']);
  await api.updateBrowserMemeMetadata({ ...saved, title: 'My title', description: 'A searchable memory', tags: ['custom'], favorite: true });
  await api.saveBrowserMeme(image, template, ['new caller metadata']);
  const [reloaded] = await api.listBrowserMemes();
  assert.equal(reloaded.title, 'My title');
  assert.equal(reloaded.description, 'A searchable memory');
  assert.deepEqual(reloaded.tags, ['custom']);
  assert.equal(reloaded.favorite, true);
  assert.equal(await api.getBrowserMedia(saved.id), image);
});

test('saved creations retain visual descriptions and tags for later description search', async () => {
  const sources = JSON.parse(readFileSync(new URL('../assets/public-supplemental.json', import.meta.url), 'utf8'));
  const cookedDog = sources.find(item => item.id === 'imgflip:574931918');
  assert.ok(cookedDog);
  const saved = await api.saveBrowserMeme(png(), cookedDog, ['Monday again']);
  await api.saveBrowserMeme(png([0, 0, 255, 255]), template, ['Monday again']);
  const reloaded = await api.listBrowserMemes();
  const stored = reloaded.find(item => item.id === saved.id);
  assert.ok(stored.description.includes(cookedDog.description.slice(0, 600)));
  assert.ok(stored.description.includes('Monday again'));
  assert.ok(stored.description.includes(cookedDog.sourceUrl));
  assert.ok(stored.tags.includes(cookedDog.tags[0].toLowerCase()));
  assert.equal(searchPreview(reloaded, 'brown dog eyes closed sunset')[0]?.id, saved.id);
});

test('media quota failure rolls metadata back and preserves existing memes', async () => {
  const image = png();
  const saved = await api.saveBrowserMeme(image, template, ['keep me']);
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'media') throw new DOMException('Storage is full', 'QuotaExceededError');
    return originalPut.apply(this, args);
  };
  try {
    await assert.rejects(api.saveBrowserMeme(png([0, 0, 255, 255]), template, ['cannot commit']), /storage is full/i);
  } finally { IDBObjectStore.prototype.put = originalPut; }
  const records = await api.listBrowserMemes();
  assert.deepEqual(records.map(item => item.id), [saved.id]);
  assert.equal(await api.getBrowserMedia(saved.id), image);
});

test('missing media and metadata produce explicit errors without creating records', async () => {
  const missing = `browser:${'0'.repeat(64)}`;
  await assert.rejects(api.getBrowserMedia('invalid-id'), /could not be found/);
  await assert.rejects(api.getBrowserMedia(missing), /missing/);
  await assert.rejects(api.updateBrowserMemeMetadata({ id: missing, title: 'missing', description: '', tags: [], favorite: false, last_used: null }), /could not be found/);
  assert.deepEqual(await api.listBrowserMemes(), []);
});

test('image validation rejects non-PNG, malformed, oversized, and excessive-dimension inputs', async () => {
  const oversizedDimensions = Buffer.from(png().split(',')[1], 'base64');
  oversizedDimensions.writeUInt32BE(1601, 16);
  for (const image of [
    'data:image/jpeg;base64,AAAA',
    'data:image/png;base64,not base64!',
    'data:image/png;base64,AAAA',
    `data:image/png;base64,${'A'.repeat(20 * 1024 * 1024)}`,
    `data:image/png;base64,${oversizedDimensions.toString('base64')}`,
  ]) await assert.rejects(api.saveBrowserMeme(image, template, ['caption']), /PNG|1,600|invalid/);
  assert.deepEqual(await api.listBrowserMemes(), []);
});

test('metadata stays bounded and credential-bearing source URLs are discarded', async () => {
  const saved = await api.saveBrowserMeme(png(), { title: `title\u0000${'T'.repeat(300)}`, sourceUrl: 'https://secret@imgflip.com/example', description: `scene\u0000${'D'.repeat(9000)}`, tags: Array.from({ length: 50 }, (_, index) => `${index}${'Z'.repeat(200)}`) }, Array(10).fill('C'.repeat(1000)));
  assert.ok(saved.title.length <= 160);
  assert.ok(saved.description.length <= 4000);
  assert.equal(saved.title.includes('\u0000'), false);
  assert.equal(saved.description.includes('secret'), false);
  assert.equal(saved.description.includes('\u0000'), false);
  assert.ok(saved.description.includes('Created from title'));
  assert.equal(saved.tags.length, 12);
  assert.ok(saved.tags.every(tag => tag.length <= 80));
  const edited = await api.updateBrowserMemeMetadata({ ...saved, title: 'X'.repeat(500), description: 'Y'.repeat(9000), tags: Array(30).fill('Z'.repeat(200)) });
  assert.equal(edited.title.length, 160);
  assert.equal(edited.description.length, 4000);
  assert.equal(edited.tags.length, 12);
  assert.ok(edited.tags.every(tag => tag.length === 80));
});

test('clipboard write starts synchronously while PNG access waits for image and committed save', async () => {
  const save = deferred(), media = deferred();
  let writes = 0, received;
  navigator.clipboard = {
    write(items) { writes++; return items[0].data['image/png'].then(blob => { received = blob; }); },
  };
  const copying = api.copyBrowserImage(media.promise, save.promise);
  assert.equal(writes, 1, 'write() must run before returning to preserve browser activation');
  save.resolve(); await Promise.resolve();
  assert.equal(received, undefined);
  media.resolve(png()); await copying;
  assert.equal(received.type, 'image/png');
  assert.ok(received.size > 33);
});

test('failed save and failed media reads retain their errors instead of claiming success', async () => {
  navigator.clipboard = { write: items => items[0].data['image/png'].then(() => {}) };
  const save = deferred();
  const error = new Error('Atomic save failed');
  const observed = assert.rejects(api.copyBrowserImage(png(), save.promise), failure => failure === error);
  save.reject(error); await observed;
  await assert.rejects(api.copyBrowserImage(Promise.reject(new Error('Missing image bytes'))), /Missing image bytes/);
});

test('denied and unsupported clipboards report a saved meme only after persistence succeeds', async () => {
  const save = deferred();
  let settled = false;
  navigator.clipboard = { write: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) };
  const result = api.copyBrowserImage(png(), save.promise).catch(error => { settled = true; throw error; });
  const observed = assert.rejects(result, /Saved in Your memes.*desktop app/);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  save.resolve(); await observed;
  navigator.clipboard = undefined;
  await assert.rejects(api.copyBrowserImage(png()), /Saved in Your memes.*desktop app/);
});
