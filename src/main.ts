import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './style.css';

type Kind = 'png' | 'gif' | 'jpeg' | 'webp';
type Filter = 'all' | 'favorites' | 'recent' | 'gif' | 'image';
type Meme = { id: string; title: string; description: string; tags: string[]; filename: string; kind: Kind; favorite: boolean; last_used: number | null };
type Bootstrap = { items: Meme[]; diagnostics: string[]; shortcut: string; version: string };
const native = isTauri();
const app = document.querySelector<HTMLDivElement>('#app')!;
let all: Meme[] = [], results: Meme[] = [], selected = 0, filter: Filter = 'all';
let diagnostics: string[] = [], shortcut = 'CommandOrControl+Shift+M', queryGeneration = 0, busy = false;
let hideAfter = localStorage.getItem('hideAfter') !== 'false';
const media = new Map<string, string>();
const pendingMedia = new Map<string, Promise<string>>();
let mediaObserver: IntersectionObserver | undefined;
let renderedQuery = '';
const mac = /Mac/i.test(navigator.platform);
const keyLabel = mac ? '⌘' : 'Ctrl';
const icons = {
 search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>',
 plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
 settings: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></svg>',
 star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>',
 copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></svg>'
};
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

app.innerHTML = `<header><div class="brand"><span class="brand-icon">m<span>!</span></span><div><strong>MemeIT</strong><small>LESS TYPING. MORE FEELING.</small></div></div><div class="header-actions"><button id="import" class="secondary">${icons.plus} Import memes</button><button id="settings" class="icon-button" aria-label="Settings">${icons.settings}</button></div></header>
<main><div class="intro"><h1>Find your reaction.</h1><span class="local-label">YOUR LIBRARY. ON YOUR DEVICE.</span></div>
<div class="search-box">${icons.search}<input id="search" type="search" autofocus autocomplete="off" maxlength="500" placeholder="Describe the moment… ‘pretending everything is fine’" aria-label="Describe a meme or reaction"><kbd>/</kbd></div>
<div class="browse-bar"><nav aria-label="Filter memes">${(['all', 'favorites', 'recent', 'gif', 'image'] as Filter[]).map(f => `<button class="tab ${f === 'all' ? 'active' : ''}" data-filter="${f}" aria-pressed="${f === 'all'}">${{ all: 'All memes', favorites: 'Favorites', recent: 'Recent', gif: 'GIFs', image: 'Images' }[f]}</button>`).join('')}</nav><span id="count" class="count"></span></div>
<div id="preview-note" class="notice" ${native ? 'hidden' : ''}>Browser preview · Install the desktop app for imports, global shortcuts, and native media copying.</div>
<div id="diagnostic-note" class="notice" hidden></div><section id="grid" class="grid" aria-label="Meme results" aria-busy="true"></section><div id="empty" class="empty" hidden><div class="empty-mark">:)</div><h2>No reactions here yet.</h2><p id="empty-text">Try a shorter description or import a meme.</p><button id="clear" class="secondary">Show all memes</button></div></main>
<aside id="selection" class="selection" aria-label="Selected meme"></aside><footer><div><kbd>↑</kbd><kbd>↓</kbd> navigate <span>·</span> <kbd>Enter</kbd> copy <span>·</span> <kbd>Esc</kbd> hide</div><span id="shortcut-label">${keyLabel} Shift M to open</span></footer><div id="toast" role="status" aria-live="polite"></div><dialog id="dialog"></dialog>`;

const search = document.querySelector<HTMLInputElement>('#search')!;
const grid = document.querySelector<HTMLElement>('#grid')!;
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string, error = false) {
 const el = document.querySelector<HTMLElement>('#toast')!;
 el.textContent = message; el.className = `show ${error ? 'error' : ''}`;
 clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, 4500);
}
function fail(error: unknown) { toast(String(error), true); }
function previewOnly() { toast('This is a browser preview. Use the desktop app for this action.'); }

async function getMedia(item: Meme) {
 if (media.has(item.id)) { const value = media.get(item.id)!; media.delete(item.id); media.set(item.id, value); return value; }
 if (pendingMedia.has(item.id)) return pendingMedia.get(item.id)!;
 const request = (async () => {
  const url = native ? (await invoke<{ preview: string }>('get_media', { id: item.id })).preview : `/${encodeURIComponent(item.filename)}`;
  // Bound retained data-URI memory. Visible DOM images have their own lifecycle below.
  if (url.length < 16 * 1024 * 1024) media.set(item.id, url);
  while (media.size > 24 || [...media.values()].reduce((sum, value) => sum + value.length, 0) > 24 * 1024 * 1024) media.delete(media.keys().next().value!);
  return url;
 })();
 pendingMedia.set(item.id, request);
 try { return await request; } finally { pendingMedia.delete(item.id); }
}
function updateSelection() {
 document.querySelectorAll<HTMLElement>('.meme-card').forEach((el, i) => { el.classList.toggle('selected', i === selected); el.setAttribute('aria-pressed', String(i === selected)); });
 const item = results[selected];
 const panel = document.querySelector<HTMLElement>('#selection')!;
 if (!item) { panel.innerHTML = '<p class="muted">A little less explaining. A little more expressing.</p>'; return; }
 panel.innerHTML = `<div class="selected-meta"><strong>${escape(item.title)}</strong><span>${escape(item.description)}</span></div><div class="selection-actions"><button id="favorite" class="icon-button ${item.favorite ? 'favorited' : ''}" aria-label="${item.favorite ? 'Remove from' : 'Add to'} favorites">${icons.star}</button><button id="edit" class="text-button">Edit</button><button id="save" class="text-button">Save file</button><button id="copy" class="primary">${icons.copy} ${item.kind === 'gif' ? 'Copy GIF file' : 'Copy image'} <kbd>↵</kbd></button></div>`;
 document.querySelector('#copy')!.addEventListener('click', () => void copySelected());
 document.querySelector('#favorite')!.addEventListener('click', () => void favorite(item));
 document.querySelector('#edit')!.addEventListener('click', () => edit(item));
 document.querySelector('#save')!.addEventListener('click', () => void save(item));
}
function render() {
 mediaObserver?.disconnect();
 document.querySelector('#count')!.textContent = `${results.length} ${results.length === 1 ? 'reaction' : 'reactions'}`;
 grid.setAttribute('aria-busy', 'false');
 document.querySelector<HTMLElement>('#empty')!.hidden = results.length > 0;
 document.querySelector('#empty-text')!.textContent = filter === 'favorites' ? 'Star a meme to keep it close.' : filter === 'recent' ? 'Your copied memes will appear here.' : 'Try a shorter description, a mood, or import your own meme.';
 grid.innerHTML = results.map((item, index) => `<button class="meme-card ${index === selected ? 'selected' : ''}" data-index="${index}" aria-label="${escape(item.title)}${item.kind === 'gif' ? ', animated GIF' : ''}" aria-pressed="${index === selected}"><div class="image-wrap"><img data-id="${escape(item.id)}" alt="${escape(item.title)}" loading="lazy"><span class="format">${item.kind === 'gif' ? 'GIF' : 'IMG'}</span>${item.favorite ? '<span class="favorite-badge">★</span>' : ''}</div><div class="card-caption"><strong>${escape(item.title)}</strong><span>${escape(item.tags[0] || 'your meme')}</span></div></button>`).join('');
 grid.querySelectorAll<HTMLButtonElement>('.meme-card').forEach(button => {
  button.addEventListener('focus', () => { selected = Number(button.dataset.index); updateSelection(); });
  button.addEventListener('click', () => { selected = Number(button.dataset.index); updateSelection(); });
  button.addEventListener('dblclick', () => { selected = Number(button.dataset.index); void copySelected(); });
 });
 const currentResults = results;
 mediaObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
   const img = entry.target as HTMLImageElement;
   img.dataset.visible = String(entry.isIntersecting);
   if (!entry.isIntersecting) { img.removeAttribute('src'); continue; }
   const item = currentResults.find(m => m.id === img.dataset.id); if (!item) continue;
   void getMedia(item).then(url => { if (img.isConnected && img.dataset.visible === 'true') img.src = url; }).catch(() => { img.alt = `${item.title} — preview unavailable`; });
  }
 }, { root: document.querySelector('main'), rootMargin: '100px' });
 grid.querySelectorAll('img').forEach(img => mediaObserver!.observe(img)); updateSelection();
}
async function refresh() {
 const generation = ++queryGeneration;
 try {
  let next: Meme[];
  if (native) next = await invoke<Meme[]>('search_memes', { query: search.value, filter });
  else {
   const tokens = search.value.toLowerCase().split(/\W+/).filter(t => t.length > 2 && !['the','that','with','for','when','and','everything'].includes(t));
   next = all.filter(m => filter === 'all' || (filter === 'favorites' && m.favorite) || (filter === 'recent' && m.last_used) || (filter === 'gif' && m.kind === 'gif') || (filter === 'image' && m.kind !== 'gif'));
   if (tokens.length) next = next.map(m => ({ m, score: tokens.filter(t => `${m.title} ${m.description} ${m.tags.join(' ')}`.toLowerCase().includes(t)).length })).filter(v => v.score > 0).sort((a,b) => b.score-a.score).map(v => v.m);
   if (filter === 'recent') next.sort((a,b) => (b.last_used || 0)-(a.last_used || 0));
  }
  if (generation !== queryGeneration) return;
  results = next; renderedQuery = search.value; selected = 0; render();
 } catch (error) { fail(error); grid.setAttribute('aria-busy','false'); }
}
async function copySelected() {
 if (busy) return;
 if (renderedQuery !== search.value) { clearTimeout(debounce); await refresh(); }
 const item = results[selected]; if (!item) return;
 if (!native) { previewOnly(); return; }
 busy = true;
 try { const result = await invoke<{message:string}>('copy_meme', { id: item.id, mode: item.kind === 'gif' ? 'file' : 'image', hideAfter }); toast(result.message); item.last_used = Math.floor(Date.now() / 1000); }
 catch (error) { fail(error); } finally { busy = false; }
}
async function favorite(item: Meme) {
 try { const updated = native ? await invoke<Meme>('toggle_favorite', { id: item.id }) : { ...item, favorite: !item.favorite }; Object.assign(item, updated); if (!native) { localStorage.setItem('preview-favorites', JSON.stringify(all.filter(x => x.favorite).map(x => x.id))); } if (filter === 'favorites') await refresh(); else { updateSelection(); render(); } } catch(error) { fail(error); }
}
async function save(item: Meme) {
 if (!native) { previewOnly(); return; }
 try { if (await invoke<boolean>('export_meme', { id: item.id })) toast('Saved. Attach the original file in your chat.'); } catch (error) { fail(error); }
}
function openDialog(content: string) {
 dialog.innerHTML = `<button class="dialog-close icon-button" aria-label="Close dialog">×</button>${content}`;
 dialog.querySelector('.dialog-close')!.addEventListener('click', () => dialog.close()); dialog.showModal();
}
function edit(item: Meme) {
 openDialog(`<div class="eyebrow">MAKE IT FINDABLE</div><h2>Describe this reaction.</h2><p>Search uses titles, descriptions, and tags. Add the situation you’d send it in.</p><form id="edit-form"><label>Title<input name="title" required maxlength="120" value="${escape(item.title)}"></label><label>Description<textarea name="description" rows="3" maxlength="2000">${escape(item.description)}</textarea></label><label>Tags <span class="muted">separated by commas</span><input name="tags" maxlength="1000" value="${escape(item.tags.join(', '))}"></label><button class="primary" type="submit">Save description</button></form>`);
 dialog.querySelector('form')!.addEventListener('submit', async event => {
  event.preventDefault(); if (!native) { previewOnly(); return; }
  const data = new FormData(event.currentTarget as HTMLFormElement);
  try { await invoke('update_meme', { id: item.id, title: String(data.get('title')), description: String(data.get('description')), tags: String(data.get('tags')).split(',').map(s => s.trim()).filter(Boolean) }); dialog.close(); await refresh(); toast('Description saved.'); } catch(error) { fail(error); }
 });
}
function settings() {
 openDialog(`<div class="eyebrow">SMALL APP. BIG REACTION.</div><h2>Your MemeIT.</h2><p>Search and media stay on this device. No account, chat access, or clipboard history.</p><form id="settings-form"><label>Open picker shortcut<input name="shortcut" required value="${escape(shortcut)}" aria-describedby="shortcut-help"></label><small id="shortcut-help">Example: CommandOrControl+Shift+M. On Wayland, use your desktop’s shortcut settings to launch MemeIT.</small><label class="checkbox"><input name="hideAfter" type="checkbox" ${hideAfter ? 'checked' : ''}> Hide after copying</label><button class="primary" type="submit">Save settings</button></form><div class="settings-notes"><strong>Images vs. GIFs</strong><p>Images copy as pixels. GIFs copy as original files to keep animation. If your chat doesn’t accept a pasted file, use Save file and attach it.</p><strong>Description search</strong><p>Local keyword and phrase matching with reaction synonyms. Add a useful description to imported memes; this version doesn’t recognize their contents automatically.</p>${diagnostics.length ? `<strong>System notes</strong><ul>${diagnostics.map(d => `<li>${escape(d)}</li>`).join('')}</ul>` : ''}<p class="muted">MemeIT 0.1.0 · Preview · MIT software / CC0 starter art</p></div>`);
 dialog.querySelector('form')!.addEventListener('submit', async event => {
  event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement);
  try { const binding = String(data.get('shortcut')).trim(); if (native && (binding !== shortcut || diagnostics.some(note => note.includes('Could not register')))) { const result = await invoke<{shortcut:string;diagnostics:string[]}>('set_shortcut',{binding}); shortcut = result.shortcut; diagnostics = result.diagnostics; }
   hideAfter = data.get('hideAfter') === 'on'; localStorage.setItem('hideAfter', String(hideAfter)); updateDiagnostics(); dialog.close(); toast('Settings saved.');
  } catch(error) { fail(error); }
 });
}
function updateDiagnostics() {
 const el = document.querySelector<HTMLElement>('#diagnostic-note')!;
 el.hidden = diagnostics.length === 0; el.textContent = diagnostics.length ? `${diagnostics[0]} See settings for details.` : '';
 document.querySelector('#shortcut-label')!.textContent = `${shortcut.replace(/CommandOrControl|CmdOrCtrl/g, keyLabel).replaceAll('+',' ')} to open`;
}
document.querySelector('#settings')!.addEventListener('click', settings);
document.querySelector('#import')!.addEventListener('click', async () => {
 if (!native) { previewOnly(); return; }
 try { const imported = await invoke<Meme[]>('import_memes'); if (imported.length) { filter = 'all'; search.value = ''; updateTabs(); await refresh(); toast(`Imported ${imported.length} ${imported.length === 1 ? 'meme' : 'memes'}. Add descriptions with Edit.`); } } catch(error) { fail(error); }
});
function updateTabs() { document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => { button.classList.toggle('active', button.dataset.filter === filter); button.setAttribute('aria-pressed',String(button.dataset.filter === filter)); }); }
document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter as Filter; updateTabs(); void refresh(); }));
document.querySelector('#clear')!.addEventListener('click', () => { filter = 'all'; search.value = ''; updateTabs(); void refresh(); search.focus(); });
let debounce: ReturnType<typeof setTimeout>;
search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => void refresh(), 100); });
document.addEventListener('keydown', event => {
 if (dialog.open) return;
 if (event.key === 'Escape') { event.preventDefault(); if (native) void invoke('hide_window').catch(fail); else { search.value = ''; void refresh(); } return; }
 const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
 if (event.key === '/' && !typing) { event.preventDefault(); search.focus(); return; }
 if (event.key === 'Enter' && (event.target === search || event.target === document.body || (event.target instanceof HTMLElement && event.target.closest('.meme-card')))) { event.preventDefault(); void copySelected(); return; }
 const directions: Record<string, number> = { ArrowDown: 3, ArrowUp: -3, ArrowRight: 1, ArrowLeft: -1 };
 if (event.key in directions && !(typing && ['ArrowRight','ArrowLeft'].includes(event.key))) { event.preventDefault(); selected = Math.min(Math.max(0, selected + directions[event.key]), results.length - 1); updateSelection(); grid.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }); }
});
async function boot() {
 try {
  if (native) { const state = await invoke<Bootstrap>('bootstrap'); all = state.items; diagnostics = state.diagnostics; shortcut = state.shortcut; updateDiagnostics(); await listen('picker-shown', () => { search.focus(); search.select(); void refresh(); }); }
  else { const response = await fetch('/catalog.json'); if (!response.ok) throw new Error('Starter pack could not be loaded.'); const favorites: string[] = JSON.parse(localStorage.getItem('preview-favorites') || '[]'); all = (await response.json() as Meme[]).map(m => ({...m, favorite: favorites.includes(m.id), last_used: null})); }
  await refresh(); search.focus();
 } catch(error) { fail(error); grid.setAttribute('aria-busy','false'); document.querySelector<HTMLElement>('#empty')!.hidden = false; document.querySelector('#empty-text')!.textContent = `Could not open the library: ${String(error)}`; }
}
void boot();
