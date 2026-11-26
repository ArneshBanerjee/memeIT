import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./style.css";
import { openTemplateEditor } from "./editor";
import { searchPreview } from "./preview-search";

type Kind = "png" | "gif" | "jpeg" | "webp";
type Filter = "all" | "favorites" | "recent" | "gif" | "image";
type Provider =
  | "popular"
  | "klipy-gifs"
  | "klipy-memes"
  | "imgflip"
  | "library";
type OnlineItem = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  kind: Kind;
  previewUrl: string;
  mediaUrl: string;
  sourceUrl: string;
  provider: string;
  isTemplate: boolean;
};
type OnlineResponse = {
  items: OnlineItem[];
  nextPage: number | null;
  notice: string;
  configured: boolean;
};
type Meme = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  filename: string;
  kind: Kind;
  favorite: boolean;
  last_used: number | null;
  online?: OnlineItem;
};
type Bootstrap = {
  items: Meme[];
  diagnostics: string[];
  shortcut: string;
  version: string;
};
const native = isTauri();
const app = document.querySelector<HTMLDivElement>("#app")!;
let all: Meme[] = [],
  results: Meme[] = [],
  selected = 0,
  filter: Filter = "all";
let provider: Provider = "popular",
  page = 1,
  nextPage: number | null = null;
let onlineNotice = "",
  providerConfigured = true,
  browserCatalog: OnlineItem[] | null = null;
let diagnostics: string[] = [],
  shortcut = "CommandOrControl+Shift+M",
  queryGeneration = 0,
  busy = false;
let hideAfter = localStorage.getItem("hideAfter") !== "false";
const media = new Map<string, string>();
const pendingMedia = new Map<string, Promise<string>>();
let mediaObserver: IntersectionObserver | undefined;
let renderedQuery = "";
let searchLoading = false;
const pendingFavorites = new Set<string>();
const queryKey = () => `${provider}|${filter}|${search.value}`;
const mac = /Mac/i.test(navigator.platform);
const keyLabel = mac ? "⌘" : "Ctrl";
const icons = {
  search:
    '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></svg>',
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

app.innerHTML = `<header><div class="brand"><span class="brand-icon">m<span>!</span></span><div><strong>MemeIT</strong><small>LESS TYPING. MORE FEELING.</small></div></div><div class="header-actions"><button id="import" class="secondary">${icons.plus} Import memes</button><button id="settings" class="icon-button" aria-label="Settings">${icons.settings}</button></div></header>
<main><div class="intro"><h1>Find that meme.</h1><span class="local-label">THE INTERNET’S REACTION FOLDER.</span></div>
<div class="search-box">${icons.search}<input id="search" type="search" autofocus autocomplete="off" maxlength="300" placeholder="Describe it… ‘the dog pretending everything is fine’" aria-label="Describe a meme or reaction"><kbd>/</kbd></div>
<nav class="providers" aria-label="Meme sources">${(["popular", "klipy-gifs", "klipy-memes", "imgflip", "library"] as Provider[]).map((p) => `<button data-provider="${p}" class="provider-tab ${p === "popular" ? "active" : ""}" aria-pressed="${p === "popular"}">${{ popular: "Popular memes", "klipy-gifs": "GIF search", "klipy-memes": "Meme search", imgflip: "Full catalog", library: "Your library" }[p]}</button>`).join("")}</nav>
<div class="browse-bar"><nav id="filters" aria-label="Filter memes">${(["all", "favorites", "recent", "gif", "image"] as Filter[]).map((f) => `<button class="tab ${f === "all" ? "active" : ""}" data-filter="${f}" aria-pressed="${f === "all"}">${{ all: "All", favorites: "Favorites", recent: "Recent", gif: "GIFs", image: "Images" }[f]}</button>`).join("")}</nav><button id="provider-help" class="source-credit">Via Imgflip &amp; Memegen</button><span id="count" class="count"></span></div>
<div id="preview-note" class="notice" ${native ? "hidden" : ""}>Browser preview · Install the desktop app for imports, global shortcuts, and native media copying.</div>
<div id="diagnostic-note" class="notice" hidden></div><div id="source-notice" class="source-notice" role="status"></div><section id="grid" class="grid" aria-label="Meme results" aria-busy="true"></section><button id="load-more" class="secondary load-more" hidden>Load more</button><div id="empty" class="empty" hidden><div class="empty-mark">:)</div><h2 id="empty-title">No matches yet.</h2><p id="empty-text">Try a shorter description or another source.</p><button id="clear" class="secondary">Show popular memes</button><button id="connect" class="primary" hidden>Connect a provider</button></div></main>
<aside id="selection" class="selection" aria-label="Selected meme"></aside><footer><div><kbd>↑</kbd><kbd>↓</kbd> navigate <span>·</span> <kbd>Enter</kbd> copy <span>·</span> <kbd>Esc</kbd> hide</div><span id="shortcut-label">${keyLabel} Shift M to open</span></footer><div id="toast" role="status" aria-live="polite"></div><dialog id="dialog"></dialog>`;

const search = document.querySelector<HTMLInputElement>("#search")!;
const grid = document.querySelector<HTMLElement>("#grid")!;
const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string, error = false) {
  if (dialog.open) {
    let feedback = dialog.querySelector<HTMLElement>(".dialog-feedback");
    if (!feedback) {
      feedback = document.createElement("p");
      feedback.className = "dialog-feedback notice";
      feedback.setAttribute("role", "status");
      dialog.append(feedback);
    }
    feedback.textContent = message;
    feedback.style.color = error ? "#ffb6a5" : "";
    return;
  }
  const el = document.querySelector<HTMLElement>("#toast")!;
  el.textContent = message;
  el.className = `show ${error ? "error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "";
  }, 4500);
}
function fail(error: unknown) {
  toast(String(error), true);
}
function previewOnly() {
  toast("This is a browser preview. Use the desktop app for this action.");
}

async function getMedia(item: Meme) {
  if (item.online) return item.online.previewUrl;
  if (media.has(item.id)) {
    const value = media.get(item.id)!;
    media.delete(item.id);
    media.set(item.id, value);
    return value;
  }
  if (pendingMedia.has(item.id)) return pendingMedia.get(item.id)!;
  const request = (async () => {
    const url = native
      ? (await invoke<{ preview: string }>("get_media", { id: item.id }))
          .preview
      : `/${encodeURIComponent(item.filename)}`;
    // Bound retained data-URI memory. Visible DOM images have their own lifecycle below.
    if (url.length < 16 * 1024 * 1024) media.set(item.id, url);
    while (
      media.size > 24 ||
      [...media.values()].reduce((sum, value) => sum + value.length, 0) >
        24 * 1024 * 1024
    )
      media.delete(media.keys().next().value!);
    return url;
  })();
  pendingMedia.set(item.id, request);
  try {
    return await request;
  } finally {
    pendingMedia.delete(item.id);
  }
}
function updateSelection() {
  document.querySelectorAll<HTMLElement>(".meme-card").forEach((el, i) => {
    el.classList.toggle("selected", i === selected);
    el.setAttribute("aria-pressed", String(i === selected));
  });
  const item = results[selected];
  const panel = document.querySelector<HTMLElement>("#selection")!;
  if (renderedQuery !== queryKey()) {
    panel.innerHTML = '<p class="muted">Finding your next reaction…</p>';
    return;
  }
  if (!item) {
    panel.innerHTML =
      '<p class="muted">A little less explaining. A little more expressing.</p>';
    return;
  }
  const linkOnly = !!item.online?.provider.startsWith("klipy");
  panel.innerHTML = `<div class="selected-meta"><strong>${escape(item.title)}</strong><span>${escape(item.description || (item.online?.isTemplate ? "Popular internet meme format" : "Reaction"))}</span></div><div class="selection-actions">${!linkOnly ? `<button id="favorite" class="icon-button ${item.favorite ? "favorited" : ""}" aria-label="${item.online ? "Save to your library" : item.favorite ? "Remove from favorites" : "Add to favorites"}">${icons.star}</button>` : ""}${item.online?.isTemplate && item.kind !== "gif" ? '<button id="compose" class="secondary">Add text</button>' : ""}<button id="edit" class="text-button">${item.online ? "Source" : "Edit"}</button>${!linkOnly ? '<button id="save" class="text-button">Save file</button>' : ""}<button id="copy" class="primary">${icons.copy} ${linkOnly ? "Copy link" : item.kind === "gif" ? "Copy GIF file" : "Copy image"} <kbd>↵</kbd></button></div>`;
  document.querySelector("#compose")?.addEventListener("click", () => {
    if (item.online)
      void openTemplateEditor(item.online, {
        onCopied: (message) => toast(message),
        onError: fail,
      });
  });
  document
    .querySelector("#copy")!
    .addEventListener("click", () => void copySelected());
  document
    .querySelector("#favorite")
    ?.addEventListener("click", () => void favorite(item));
  document.querySelector("#edit")!.addEventListener("click", () => {
    if (item.online) {
      if (native)
        void invoke("open_online_source", { id: item.id }).catch(fail);
      else window.open(item.online.sourceUrl, "_blank", "noopener,noreferrer");
    } else edit(item);
  });
  document
    .querySelector("#save")
    ?.addEventListener("click", () => void save(item));
}
function render() {
  mediaObserver?.disconnect();
  document.querySelector("#count")!.textContent =
    `${results.length} ${results.length === 1 ? "reaction" : "reactions"}`;
  document.querySelector<HTMLElement>("#load-more")!.hidden = nextPage === null;
  document.querySelector<HTMLElement>("#filters")!.hidden =
    provider !== "library";
  document.querySelector<HTMLElement>("#source-notice")!.textContent =
    onlineNotice;
  document.querySelector<HTMLElement>("#source-notice")!.hidden = !onlineNotice;
  document.querySelector<HTMLElement>("#connect")!.hidden = providerConfigured;
  document.querySelector<HTMLElement>("#clear")!.hidden = !providerConfigured;
  document.querySelector<HTMLElement>("#empty-title")!.textContent =
    providerConfigured ? "No matches yet." : "Connect the full catalog.";
  document.querySelector<HTMLElement>("#provider-help")!.textContent =
    provider === "library"
      ? "Saved on your device"
      : provider.startsWith("klipy")
        ? "Powered by KLIPY"
        : provider === "imgflip"
          ? "Powered by Imgflip"
          : "Via Imgflip & Memegen";
  grid.setAttribute("aria-busy", "false");
  document.querySelector<HTMLElement>("#empty")!.hidden = results.length > 0;
  document.querySelector("#empty-text")!.textContent = !providerConfigured
    ? onlineNotice
    : filter === "favorites"
      ? "Save a meme to keep it close."
      : filter === "recent"
        ? "Your copied memes will appear here."
        : "Try a meme name, a visual description, or another source.";
  grid.innerHTML = results
    .map(
      (item, index) =>
        `<button class="meme-card ${index === selected ? "selected" : ""}" data-index="${index}" aria-label="${escape(item.title)}${item.kind === "gif" ? ", animated GIF" : ""}" aria-pressed="${index === selected}"><div class="image-wrap"><img data-id="${escape(item.id)}" alt="${escape(item.title)}" loading="lazy" referrerpolicy="no-referrer"><span class="format">${item.kind === "gif" ? "GIF" : item.online?.isTemplate ? "FORMAT" : "IMG"}</span>${item.favorite ? '<span class="favorite-badge">★</span>' : ""}</div><div class="card-caption"><strong>${escape(item.title)}</strong><span>${escape(item.online?.provider || item.tags[0] || "your meme")}</span></div></button>`,
    )
    .join("");
  grid.querySelectorAll<HTMLButtonElement>(".meme-card").forEach((button) => {
    button.addEventListener("focus", () => {
      selected = Number(button.dataset.index);
      updateSelection();
    });
    button.addEventListener("click", () => {
      selected = Number(button.dataset.index);
      updateSelection();
    });
    button.addEventListener("dblclick", () => {
      selected = Number(button.dataset.index);
      void copySelected();
    });
  });
  const currentResults = results;
  mediaObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const img = entry.target as HTMLImageElement;
        img.dataset.visible = String(entry.isIntersecting);
        if (!entry.isIntersecting) {
          img.removeAttribute("src");
          continue;
        }
        const item = currentResults.find((m) => m.id === img.dataset.id);
        if (!item) continue;
        void getMedia(item)
          .then((url) => {
            if (img.isConnected && img.dataset.visible === "true")
              img.src = url;
          })
          .catch(() => {
            img.alt = `${item.title} — preview unavailable`;
          });
      }
    },
    { root: document.querySelector("main"), rootMargin: "100px" },
  );
  grid.querySelectorAll("img").forEach((img) => mediaObserver!.observe(img));
  updateSelection();
}
function onlineMeme(item: OnlineItem): Meme {
  return {
    ...item,
    filename: "",
    favorite: false,
    last_used: null,
    online: item,
  };
}
async function previewCatalog(query: string): Promise<OnlineResponse> {
  if (provider !== "popular")
    return {
      items: [],
      nextPage: null,
      configured: false,
      notice:
        "Use the desktop app to connect your provider key for live catalog search.",
    };
  if (!browserCatalog) {
    const responses = await Promise.allSettled([
      fetch("https://api.imgflip.com/get_memes").then((r) => r.json()),
      fetch("https://api.memegen.link/templates").then((r) => r.json()),
    ]);
    let metadata: {
      source: string;
      id: string;
      description: string;
      tags: string[];
    }[] = [];
    try {
      const response = await fetch("/internet-metadata.json");
      if (response.ok) {
        const data = await response.json();
        metadata = Array.isArray(data) ? data : data.entries || [];
      }
    } catch {
      /* Names still work without enriched metadata. */
    }
    const enrich = (source: string, id: string) =>
      metadata.find((m) => m.source === source && m.id === id);
    browserCatalog = [];
    const imgflip = responses[0];
    if (imgflip.status === "fulfilled" && imgflip.value.success)
      for (const item of imgflip.value.data.memes) {
        const extra = enrich("imgflip", item.id);
        browserCatalog.push({
          id: `imgflip:${item.id}`,
          title: item.name,
          description: extra?.description || "",
          tags: extra?.tags || [],
          kind: "jpeg",
          previewUrl: item.url,
          mediaUrl: item.url,
          sourceUrl: `https://imgflip.com/memetemplate/${item.id}`,
          provider: "imgflip",
          isTemplate: true,
        });
      }
    const memegen = responses[1];
    if (memegen.status === "fulfilled" && Array.isArray(memegen.value))
      for (const item of memegen.value) {
        const extra = enrich("memegen", item.id);
        browserCatalog.push({
          id: `memegen:${item.id}`,
          title: item.name,
          description: extra?.description || "",
          tags: extra?.tags || item.keywords || [],
          kind: "jpeg",
          previewUrl: item.blank,
          mediaUrl: item.blank,
          sourceUrl: item.source || "https://memegen.link/",
          provider: "memegen",
          isTemplate: true,
        });
      }
    try {
      const response = await fetch("/public-supplemental.json");
      if (response.ok) {
        const supplements: OnlineItem[] = await response.json();
        const ids = new Set(browserCatalog.map((item) => item.id));
        for (const item of supplements) {
          if (!ids.has(item.id)) {
            browserCatalog.push(item);
            ids.add(item.id);
          }
        }
      }
    } catch {
      /* The live catalogs remain usable. */
    }
    if (!browserCatalog.length) {
      browserCatalog = null;
      throw new Error(
        "Internet catalogs are unavailable. Check your connection and try again.",
      );
    }
  }
  const items = searchPreview(browserCatalog, query);
  return {
    items,
    nextPage: null,
    configured: true,
    notice: `Live popular formats from Imgflip and Memegen. ${browserCatalog.length} source entries; broader GIF and meme search is available in the provider tabs.`,
  };
}
async function refresh(append = false): Promise<boolean> {
  if (
    append &&
    (searchLoading || renderedQuery !== queryKey() || nextPage === null)
  )
    return false;
  const generation = ++queryGeneration;
  searchLoading = true;
  document.querySelector<HTMLButtonElement>("#load-more")!.disabled = true;
  updateSelection();
  const query = search.value,
    currentProvider = provider,
    requestedKey = queryKey();
  if (!append) page = 1;
  const requestedPage = append ? nextPage || page : 1;
  grid.setAttribute("aria-busy", "true");
  document.querySelector("#count")!.textContent = "Searching…";
  try {
    let next: Meme[];
    if (currentProvider !== "library") {
      const response = native
        ? await invoke<OnlineResponse>("search_online", {
            query,
            provider: currentProvider,
            page: requestedPage,
          })
        : await previewCatalog(query);
      if (generation !== queryGeneration || requestedKey !== queryKey())
        return false;
      next = response.items.map(onlineMeme);
      nextPage = response.nextPage;
      page = requestedPage;
      onlineNotice = response.notice;
      providerConfigured = response.configured;
    } else {
      onlineNotice =
        "Your saved memes and imports. Search stays on this device.";
      providerConfigured = true;
      nextPage = null;
      if (native)
        next = await invoke<Meme[]>("search_memes", { query, filter });
      else {
        const tokens = query
          .toLowerCase()
          .split(/\W+/)
          .filter((t) => t.length > 2);
        next = all.filter(
          (m) =>
            filter === "all" ||
            (filter === "favorites" && m.favorite) ||
            (filter === "recent" && m.last_used) ||
            (filter === "gif" && m.kind === "gif") ||
            (filter === "image" && m.kind !== "gif"),
        );
        if (tokens.length)
          next = next.filter((m) =>
            tokens.some((t) =>
              `${m.title} ${m.description} ${m.tags.join(" ")}`
                .toLowerCase()
                .includes(t),
            ),
          );
      }
    }
    if (generation !== queryGeneration || requestedKey !== queryKey())
      return false;
    results = append
      ? [
          ...results,
          ...next.filter(
            (m) => !results.some((existing) => existing.id === m.id),
          ),
        ]
      : next;
    renderedQuery = requestedKey;
    if (!append) selected = 0;
    render();
    return true;
  } catch (error) {
    if (generation !== queryGeneration) return false;
    results = [];
    nextPage = null;
    onlineNotice = String(error);
    providerConfigured = true;
    render();
    fail(error);
    return false;
  } finally {
    if (generation === queryGeneration) {
      searchLoading = false;
      document.querySelector<HTMLButtonElement>("#load-more")!.disabled = false;
    }
  }
}
async function copySelected() {
  if (busy) return;
  busy = true;
  const intendedKey = queryKey();
  try {
    if (renderedQuery !== intendedKey) {
      clearTimeout(debounce);
      if (!(await refresh())) return;
    }
    if (intendedKey !== queryKey() || renderedQuery !== intendedKey) return;
    const item = results[selected];
    if (!item) return;
    if (!native) {
      previewOnly();
      return;
    }
    const result = await invoke<{ message: string }>(
      item.online ? "copy_online" : "copy_meme",
      {
        id: item.id,
        mode: item.online?.provider.startsWith("klipy")
          ? "link"
          : item.kind === "gif"
            ? "file"
            : "image",
        hideAfter,
      },
    );
    toast(result.message);
    item.last_used = Math.floor(Date.now() / 1000);
  } catch (error) {
    fail(error);
  } finally {
    busy = false;
  }
}
async function favorite(item: Meme) {
  if (pendingFavorites.has(item.id)) return;
  pendingFavorites.add(item.id);
  try {
    if (item.online) {
      if (!native) {
        previewOnly();
        return;
      }
      const saved = await invoke<Meme>("add_online_to_library", {
        id: item.id,
      });
      if (!saved.favorite) await invoke("toggle_favorite", { id: saved.id });
      item.favorite = true;
      render();
      toast("Saved to your library and favorites.");
      return;
    }
    const updated = native
      ? await invoke<Meme>("toggle_favorite", { id: item.id })
      : { ...item, favorite: !item.favorite };
    Object.assign(item, updated);
    if (!native)
      localStorage.setItem(
        "preview-favorites",
        JSON.stringify(all.filter((x) => x.favorite).map((x) => x.id)),
      );
    if (filter === "favorites") await refresh();
    else render();
  } catch (error) {
    fail(error);
  } finally {
    pendingFavorites.delete(item.id);
  }
}
async function save(item: Meme) {
  if (!native) {
    previewOnly();
    return;
  }
  try {
    if (
      await invoke<boolean>(item.online ? "save_online" : "export_meme", {
        id: item.id,
      })
    )
      toast("Saved. Attach the original file in your chat.");
  } catch (error) {
    fail(error);
  }
}
function openDialog(content: string) {
  dialog.innerHTML = `<button class="dialog-close icon-button" aria-label="Close dialog">×</button>${content}`;
  dialog
    .querySelector(".dialog-close")!
    .addEventListener("click", () => dialog.close());
  dialog.showModal();
}
function edit(item: Meme) {
  openDialog(
    `<div class="eyebrow">MAKE IT FINDABLE</div><h2>Describe this reaction.</h2><p>Search uses titles, descriptions, and tags. Add the situation you’d send it in.</p><form id="edit-form"><label>Title<input name="title" required maxlength="120" value="${escape(item.title)}"></label><label>Description<textarea name="description" rows="3" maxlength="2000">${escape(item.description)}</textarea></label><label>Tags <span class="muted">separated by commas</span><input name="tags" maxlength="1000" value="${escape(item.tags.join(", "))}"></label><button class="primary" type="submit">Save description</button></form>`,
  );
  dialog.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!native) {
      previewOnly();
      return;
    }
    const data = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await invoke("update_meme", {
        id: item.id,
        title: String(data.get("title")),
        description: String(data.get("description")),
        tags: String(data.get("tags"))
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      dialog.close();
      await refresh();
      toast("Description saved.");
    } catch (error) {
      fail(error);
    }
  });
}
function settings() {
  openDialog(
    `<div class="eyebrow">SMALL APP. BIG REACTION.</div><h2>Your MemeIT.</h2><p>No MemeIT account, chat access, or clipboard history. Internet searches go directly to the selected provider.</p><button id="provider-settings" class="secondary">Connect online catalogs</button><form id="settings-form"><label>Open picker shortcut<input name="shortcut" required value="${escape(shortcut)}" aria-describedby="shortcut-help"></label><small id="shortcut-help">Example: CommandOrControl+Shift+M. On Wayland, use your desktop’s shortcut settings to launch MemeIT.</small><label class="checkbox"><input name="hideAfter" type="checkbox" ${hideAfter ? "checked" : ""}> Hide after copying</label><button class="primary" type="submit">Save settings</button></form><div class="settings-notes"><strong>Images vs. GIFs</strong><p>Images copy as pixels. GIFs copy as original files to keep animation. If your chat doesn’t accept a pasted file, use Save file and attach it.</p><strong>Description search</strong><p>Popular memes combines an on-device language model with descriptions, names, and typo tolerance. Your library matches names, descriptions, and tags. Add descriptions to imported memes; their contents aren’t recognized automatically.</p>${diagnostics.length ? `<strong>System notes</strong><ul>${diagnostics.map((d) => `<li>${escape(d)}</li>`).join("")}</ul>` : ""}<p class="muted">MemeIT 0.1.1 · Preview · MIT software · Media belongs to its sources</p></div>`,
  );
  dialog.querySelector("#provider-settings")!.addEventListener("click", () => {
    dialog.close();
    void providerSettings();
  });
  dialog.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    try {
      const binding = String(data.get("shortcut")).trim();
      if (
        native &&
        (binding !== shortcut ||
          diagnostics.some((note) => note.includes("Could not register")))
      ) {
        const result = await invoke<{
          shortcut: string;
          diagnostics: string[];
        }>("set_shortcut", { binding });
        shortcut = result.shortcut;
        diagnostics = result.diagnostics;
      }
      hideAfter = data.get("hideAfter") === "on";
      localStorage.setItem("hideAfter", String(hideAfter));
      updateDiagnostics();
      dialog.close();
      toast("Settings saved.");
    } catch (error) {
      fail(error);
    }
  });
}
function updateDiagnostics() {
  const el = document.querySelector<HTMLElement>("#diagnostic-note")!;
  el.hidden = diagnostics.length === 0;
  el.textContent = diagnostics.length
    ? `${diagnostics[0]} See settings for details.`
    : "";
  document.querySelector("#shortcut-label")!.textContent =
    `${shortcut.replace(/CommandOrControl|CmdOrCtrl/g, keyLabel).replaceAll("+", " ")} to open`;
}
async function providerSettings() {
  let configured = { imgflip: false, klipy: false, storage: "session" };
  if (native)
    try {
      configured = await invoke("provider_config");
    } catch (error) {
      fail(error);
    }
  openDialog(
    `<div class="eyebrow">THE INTERNET, WITH SOURCES</div><h2>Go beyond popular.</h2><p>Popular memes loads real classic formats from Imgflip and Memegen without a key. Connect a provider for its full live search.</p><div class="settings-notes"><strong>KLIPY · GIFs &amp; ready-to-send memes</strong><p>Search a broad reaction catalog. A testing or approved production app key is required. Results keep KLIPY’s ordering. This preview shares media links; native file transfer needs provider approval.</p><button class="text-button" data-signup="klipy">Get a KLIPY app key</button><strong class="block">Imgflip · Full template catalog</strong><p>Search Imgflip’s advertised 1M+ formats. API Premium is required; check current pricing before connecting.</p><button class="text-button" data-signup="imgflip">Open Imgflip API settings</button></div><form id="provider-form"><label>Provider<select name="provider"><option value="klipy" ${provider !== "imgflip" ? "selected" : ""}>KLIPY ${configured.klipy ? "(key set)" : ""}</option><option value="imgflip" ${provider === "imgflip" ? "selected" : ""}>Imgflip ${configured.imgflip ? "(key set)" : ""}</option></select></label><label>API key<input type="password" name="key" autocomplete="off" spellcheck="false" required maxlength="512" placeholder="Paste your own app key"></label><small>Keys stay in this app’s memory until you quit. They are sent only to that provider, never to the MemeIT website.</small><button class="primary" type="submit">Connect provider</button></form>`,
  );
  dialog
    .querySelectorAll<HTMLButtonElement>("[data-signup]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const target = button.dataset.signup!;
        if (native)
          void invoke("open_provider_page", { provider: target }).catch(fail);
        else
          window.open(
            target === "klipy"
              ? "https://partner.klipy.com"
              : "https://imgflip.com/api-settings",
            "_blank",
            "noopener,noreferrer",
          );
      }),
    );
  dialog.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!native) {
      previewOnly();
      return;
    }
    const data = new FormData(event.currentTarget as HTMLFormElement);
    try {
      const selectedProvider = String(data.get("provider"));
      await invoke("set_provider_key", {
        provider: selectedProvider,
        key: String(data.get("key")).trim(),
      });
      provider =
        selectedProvider === "imgflip"
          ? "imgflip"
          : provider === "klipy-memes"
            ? "klipy-memes"
            : "klipy-gifs";
      filter = "all";
      updateTabs();
      dialog.close();
      await refresh();
      toast(
        "Provider key saved for this session. Run a search to verify access.",
      );
    } catch (error) {
      fail(error);
    }
  });
}
function sourceInfo() {
  openDialog(
    `<div class="eyebrow">CREDIT WHERE IT’S DUE</div><h2>Real memes. Real sources.</h2><p>Popular formats come from the live Imgflip and Memegen catalogs. Media belongs to its original creators and sources. Use Source on any selected result to open its page.</p><p><a data-home="imgflip" href="https://imgflip.com" target="_blank" rel="noopener noreferrer">Imgflip</a> · <a data-home="memegen" href="https://memegen.link" target="_blank" rel="noopener noreferrer">Memegen</a> · <a data-home="klipy" href="https://klipy.com" target="_blank" rel="noopener noreferrer">KLIPY</a></p><button id="connect-from-source" class="secondary">Connect a full catalog</button>`,
  );
  dialog.querySelectorAll<HTMLAnchorElement>("[data-home]").forEach((link) =>
    link.addEventListener("click", (event) => {
      if (native) {
        event.preventDefault();
        void invoke("open_provider_home", {
          provider: link.dataset.home,
        }).catch(fail);
      }
    }),
  );
  dialog
    .querySelector("#connect-from-source")!
    .addEventListener("click", () => {
      dialog.close();
      void providerSettings();
    });
}
document
  .querySelector("#connect")!
  .addEventListener("click", () => void providerSettings());
document.querySelector("#provider-help")!.addEventListener("click", sourceInfo);
document
  .querySelector("#load-more")!
  .addEventListener("click", () => void refresh(true));
document
  .querySelectorAll<HTMLButtonElement>("[data-provider]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      provider = button.dataset.provider as Provider;
      filter = "all";
      results = [];
      nextPage = null;
      updateTabs();
      void refresh();
      search.placeholder = provider.startsWith("klipy")
        ? "Search KLIPY… describe your reaction"
        : "Describe it… ‘the dog pretending everything is fine’";
    }),
  );
document.querySelector("#settings")!.addEventListener("click", settings);
document.querySelector("#import")!.addEventListener("click", async () => {
  if (!native) {
    previewOnly();
    return;
  }
  try {
    const imported = await invoke<Meme[]>("import_memes");
    if (imported.length) {
      provider = "library";
      filter = "all";
      search.value = "";
      updateTabs();
      await refresh();
      toast(
        `Imported ${imported.length} ${imported.length === 1 ? "meme" : "memes"}. Add descriptions with Edit.`,
      );
    }
  } catch (error) {
    fail(error);
  }
});
function updateTabs() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-provider]")
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.provider === provider);
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.provider === provider),
      );
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-filter]")
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === filter);
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.filter === filter),
      );
    });
}
document
  .querySelectorAll<HTMLButtonElement>("[data-filter]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      filter = button.dataset.filter as Filter;
      updateTabs();
      void refresh();
    }),
  );
document.querySelector("#clear")!.addEventListener("click", () => {
  provider = "popular";
  filter = "all";
  search.value = "";
  updateTabs();
  void refresh();
  search.focus();
});
let debounce: ReturnType<typeof setTimeout>;
search.addEventListener("input", () => {
  clearTimeout(debounce);
  updateSelection();
  document.querySelector<HTMLButtonElement>("#load-more")!.disabled = true;
  debounce = setTimeout(
    () => void refresh(),
    provider === "library" || provider === "popular" ? 150 : 500,
  );
});
document.addEventListener("keydown", (event) => {
  if (dialog.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (native) void invoke("hide_window").catch(fail);
    else {
      search.value = "";
      void refresh();
    }
    return;
  }
  const typing =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement;
  if (event.key === "/" && !typing) {
    event.preventDefault();
    search.focus();
    return;
  }
  if (
    event.key === "Enter" &&
    (event.target === search ||
      event.target === document.body ||
      (event.target instanceof HTMLElement &&
        event.target.closest(".meme-card")))
  ) {
    event.preventDefault();
    void copySelected();
    return;
  }
  const directions: Record<string, number> = {
    ArrowDown: 3,
    ArrowUp: -3,
    ArrowRight: 1,
    ArrowLeft: -1,
  };
  if (
    event.key in directions &&
    !(typing && ["ArrowRight", "ArrowLeft"].includes(event.key))
  ) {
    event.preventDefault();
    selected = Math.min(
      Math.max(0, selected + directions[event.key]),
      results.length - 1,
    );
    updateSelection();
    grid.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }
});
async function boot() {
  try {
    if (native) {
      const state = await invoke<Bootstrap>("bootstrap");
      all = state.items;
      diagnostics = state.diagnostics;
      shortcut = state.shortcut;
      updateDiagnostics();
      await listen("picker-shown", () => {
        search.focus();
        search.select();
        void refresh();
      });
    } else {
      const response = await fetch("/catalog.json");
      if (!response.ok) throw new Error("Local library could not be loaded.");
      const favorites: string[] = JSON.parse(
        localStorage.getItem("preview-favorites") || "[]",
      );
      all = ((await response.json()) as Meme[]).map((m) => ({
        ...m,
        favorite: favorites.includes(m.id),
        last_used: null,
      }));
    }
    await refresh();
    search.focus();
  } catch (error) {
    fail(error);
    grid.setAttribute("aria-busy", "false");
    document.querySelector<HTMLElement>("#empty")!.hidden = false;
    document.querySelector("#empty-text")!.textContent =
      `Could not open the library: ${String(error)}`;
  }
}
void boot();
