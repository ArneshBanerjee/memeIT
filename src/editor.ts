import { invoke, isTauri } from "@tauri-apps/api/core";
import "./editor.css";
import { saveBrowserMeme, copyBrowserImage } from "./browser-library";

type TemplateItem = {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  provider: string;
  mediaUrl: string;
  sourceUrl: string;
  isTemplate: boolean;
};
type EditorCallbacks = {
  onCopied: (message: string) => void;
  onError: (error: unknown) => void;
};
type TextLayer = {
  id: number;
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  color: "#ffffff" | "#111111";
  outline: boolean;
  uppercase: boolean;
};
type Bounds = { x: number; y: number; width: number; height: number };
type PreparedTemplate = {
  dataUrl: string;
  width: number;
  height: number;
  title: string;
};

const MAX_DIMENSION = 1600;
const MAX_DATA_URL_BYTES = 20 * 1024 * 1024;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** Opens one local canvas editor. Provider artwork is loaded only on explicit edit. */
export async function openTemplateEditor(
  item: TemplateItem,
  callbacks: EditorCallbacks,
): Promise<void> {
  const existing =
    document.querySelector<HTMLDialogElement>("#template-editor");
  if (existing?.open) {
    existing.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    return;
  }
  if (!item.isTemplate || item.provider.startsWith("klipy")) {
    callbacks.onError(
      "Text editing is available for image templates from Imgflip and Memegen.",
    );
    return;
  }
  const native = isTauri();
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const dialog = document.createElement("dialog");
  dialog.id = "template-editor";
  dialog.className = "te-dialog";
  dialog.setAttribute("aria-labelledby", "te-title");
  dialog.setAttribute("aria-describedby", "te-description");
  dialog.innerHTML = `
    <header class="te-header"><div><p class="te-eyebrow">YOUR WORDS. THE INTERNET’S FORMAT.</p><h2 id="te-title">Make it yours.</h2><p id="te-description"></p></div><button type="button" class="te-close" aria-label="Close meme editor">×</button></header>
    <div class="te-body">
      <section class="te-preview" aria-label="Meme preview"><div class="te-stage"><canvas id="te-canvas" aria-label="Meme preview. Select a caption and drag it, or use the position controls." tabindex="0"></canvas><p class="te-loading" role="status">Loading the original template…</p></div><p class="te-preview-help">Drag a caption to place it. Handles stay out of your finished PNG.</p></section>
      <section class="te-controls" aria-label="Caption controls">
        <div class="te-section-label"><strong>Captions</strong><button type="button" id="te-add" class="te-text-button">+ Add text</button></div>
        <div class="te-layer-tabs" role="group" aria-label="Select a text layer"></div>
        <label class="te-field" for="te-text">Caption text<textarea id="te-text" rows="3" maxlength="400" placeholder="Type your caption…" spellcheck="true"></textarea></label>
        <div class="te-slider-pair"><label class="te-field" for="te-size">Text size <output id="te-size-value"></output><input id="te-size" type="range" min="2" max="14" step="0.1"></label><label class="te-field" for="te-width">Text width <output id="te-width-value"></output><input id="te-width" type="range" min="20" max="95" step="1"></label></div>
        <fieldset class="te-color"><legend>Text color</legend><label><input name="te-color" type="radio" value="#ffffff" checked><span class="te-swatch te-white"></span> White</label><label><input name="te-color" type="radio" value="#111111"><span class="te-swatch te-black"></span> Black</label></fieldset>
        <div class="te-toggles"><label><input id="te-outline" type="checkbox" checked> Outline</label><label><input id="te-uppercase" type="checkbox"> Uppercase</label></div>
        <div class="te-slider-pair te-position"><label class="te-field" for="te-x">Horizontal <output id="te-x-value"></output><input id="te-x" type="range" min="0" max="100" step="1"></label><label class="te-field" for="te-y">Vertical <output id="te-y-value"></output><input id="te-y" type="range" min="0" max="100" step="1"></label></div>
        <button type="button" id="te-remove" class="te-text-button te-remove">Remove this caption</button>
        <p class="te-local-note">Rendered on your device. Your caption is not sent to a captioning service.</p>
      </section>
    </div>
    <footer class="te-footer"><p id="te-status" role="status" aria-live="polite">Copy it now. Find it again in Your memes.</p><div><button type="button" id="te-copy" class="te-button te-primary" disabled>Copy meme</button></div></footer>`;
  document.body.append(dialog);
  const $ = <T extends HTMLElement>(selector: string) =>
    dialog.querySelector<T>(selector)!;
  const canvas = $<HTMLCanvasElement>("#te-canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    dialog.remove();
    callbacks.onError("This desktop could not create an image editor.");
    return;
  }
  const textInput = $<HTMLTextAreaElement>("#te-text");
  const status = $("#te-status");
  const loading = $(".te-loading");
  const copyButton = $<HTMLButtonElement>("#te-copy");
  const controls = $(".te-controls");
  $("#te-description").textContent = item.title;
  let image: HTMLImageElement | null = null;
  let closed = false;
  let busy = false;
  let editable = false;
  let counter = 2;
  let activeId = 1;
  let drag: { pointer: number; offsetX: number; offsetY: number } | null = null;
  let geometry = new Map<number, Bounds>();
  const drake = /drake/i.test(item.title);
  const makeLayer = (
    id: number,
    x: number,
    y: number,
    width: number,
  ): TextLayer => ({
    id,
    text: "",
    x,
    y,
    width,
    size: drake ? 0.055 : 0.065,
    color: drake ? "#111111" : "#ffffff",
    outline: !drake,
    uppercase: false,
  });
  let layers: TextLayer[] = drake
    ? [makeLayer(1, 0.75, 0.25, 0.43), makeLayer(2, 0.75, 0.75, 0.43)]
    : [makeLayer(1, 0.5, 0.12, 0.88), makeLayer(2, 0.5, 0.88, 0.88)];
  const active = () => layers.find((layer) => layer.id === activeId)!;

  function setStatus(message: string, error = false) {
    status.textContent = message;
    status.classList.toggle("te-error", error);
  }
  function setBusy(value: boolean) {
    busy = value;
    dialog.setAttribute("aria-busy", String(value));
    dialog
      .querySelectorAll<
        HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement
      >("input, button, textarea")
      .forEach((element) => {
        element.disabled =
          value || (!editable && !element.classList.contains("te-close"));
      });
    if (!value && editable) {
      $<HTMLButtonElement>("#te-add").disabled = layers.length >= 6;
      $<HTMLButtonElement>("#te-remove").disabled = layers.length <= 1;
    }
  }
  function close() {
    if (!busy && dialog.open) dialog.close();
  }
  dialog.addEventListener(
    "close",
    () => {
      closed = true;
      drag = null;
      image = null;
      canvas.width = 1;
      canvas.height = 1;
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    },
    { once: true },
  );
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  // The main picker also handles Enter/Escape/arrows. Keep editor keystrokes local.
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
  $(".te-close").addEventListener("click", close);

  function wrapText(
    context: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
  ): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      if (!paragraph.trim()) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of paragraph.trim().split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (context.measureText(candidate).width <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) {
          lines.push(line);
          line = "";
        }
        for (const char of word) {
          if (line && context.measureText(line + char).width > maxWidth) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines.length ? lines : [""];
  }
  function drawLayer(
    context: CanvasRenderingContext2D,
    layer: TextLayer,
    guides: boolean,
  ): Bounds {
    const width = canvas.width;
    const height = canvas.height;
    let fontSize = Math.max(12, width * layer.size);
    const text = layer.uppercase ? layer.text.toLocaleUpperCase() : layer.text;
    const placeholder = !text.trim();
    const content = placeholder && guides ? "Your caption" : text;
    let lines: string[] = [];
    // Fit unusually long captions vertically rather than silently dropping text.
    for (let attempt = 0; attempt < 24; attempt++) {
      context.font = `900 ${fontSize}px Impact, "Arial Black", Arial, sans-serif`;
      lines = wrapText(context, content, width * layer.width);
      if (lines.length * fontSize * 1.15 <= height * 0.9 || fontSize <= 8)
        break;
      fontSize *= 0.9;
    }
    const lineHeight = fontSize * 1.15;
    const contentHeight = Math.max(lineHeight, lines.length * lineHeight);
    const padding = Math.max(7, width * 0.008);
    const contentWidth = Math.max(
      fontSize * 2,
      ...lines.map((line) => context.measureText(line).width),
    );
    const left = width * layer.x - contentWidth / 2;
    const top = height * layer.y - contentHeight / 2;
    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = Math.max(1, fontSize * 0.085);
    context.strokeStyle = layer.color === "#ffffff" ? "#111111" : "#ffffff";
    context.fillStyle = layer.color;
    if (placeholder) context.globalAlpha = guides ? 0.55 : 0;
    lines.forEach((line, index) => {
      const y = top + lineHeight * (index + 0.5);
      if (layer.outline && line) context.strokeText(line, width * layer.x, y);
      context.fillText(line, width * layer.x, y);
    });
    context.restore();
    const bounds = {
      x: left - padding,
      y: top - padding,
      width: contentWidth + padding * 2,
      height: contentHeight + padding * 2,
    };
    if (guides && layer.id === activeId) {
      context.save();
      context.strokeStyle = "#b7f16b";
      context.lineWidth = Math.max(2, width / 500);
      context.setLineDash([Math.max(5, width / 120), Math.max(4, width / 180)]);
      context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      context.setLineDash([]);
      context.fillStyle = "#b7f16b";
      const handle = Math.max(7, width / 100);
      for (const [x, y] of [
        [bounds.x, bounds.y],
        [bounds.x + bounds.width, bounds.y],
        [bounds.x, bounds.y + bounds.height],
        [bounds.x + bounds.width, bounds.y + bounds.height],
      ])
        context.fillRect(x - handle / 2, y - handle / 2, handle, handle);
      context.restore();
    }
    return bounds;
  }
  function paint(context: CanvasRenderingContext2D, guides: boolean) {
    if (!image) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const nextGeometry = new Map<number, Bounds>();
    for (const layer of layers)
      nextGeometry.set(layer.id, drawLayer(context, layer, guides));
    if (guides) geometry = nextGeometry;
  }
  function render() {
    paint(ctx!, true);
  }
  function renderLayerTabs() {
    const tabs = $(".te-layer-tabs");
    tabs.replaceChildren();
    layers.forEach((layer, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `te-layer-tab${layer.id === activeId ? " active" : ""}`;
      button.textContent = `Text ${index + 1}`;
      button.setAttribute("aria-pressed", String(layer.id === activeId));
      button.addEventListener("click", () => {
        if (busy) return;
        activeId = layer.id;
        syncControls();
        render();
        textInput.focus();
      });
      tabs.append(button);
    });
  }
  function syncPositions() {
    const layer = active();
    $<HTMLInputElement>("#te-x").value = String(Math.round(layer.x * 100));
    $<HTMLInputElement>("#te-y").value = String(Math.round(layer.y * 100));
    $("#te-x-value").textContent = `${Math.round(layer.x * 100)}%`;
    $("#te-y-value").textContent = `${Math.round(layer.y * 100)}%`;
  }
  function syncControls() {
    const layer = active();
    textInput.value = layer.text;
    $<HTMLInputElement>("#te-size").value = String(layer.size * 100);
    $<HTMLInputElement>("#te-width").value = String(layer.width * 100);
    $("#te-size-value").textContent = `${Math.round(layer.size * 1000) / 10}%`;
    $("#te-width-value").textContent = `${Math.round(layer.width * 100)}%`;
    $<HTMLInputElement>("#te-outline").checked = layer.outline;
    $<HTMLInputElement>("#te-uppercase").checked = layer.uppercase;
    dialog
      .querySelectorAll<HTMLInputElement>('[name="te-color"]')
      .forEach((input) => {
        input.checked = input.value === layer.color;
      });
    syncPositions();
    renderLayerTabs();
    setBusy(busy);
  }
  textInput.addEventListener("input", () => {
    active().text = textInput.value;
    render();
  });
  $<HTMLInputElement>("#te-size").addEventListener("input", (event) => {
    active().size = Number((event.target as HTMLInputElement).value) / 100;
    $("#te-size-value").textContent =
      `${Math.round(active().size * 1000) / 10}%`;
    render();
  });
  $<HTMLInputElement>("#te-width").addEventListener("input", (event) => {
    active().width = Number((event.target as HTMLInputElement).value) / 100;
    $("#te-width-value").textContent = `${Math.round(active().width * 100)}%`;
    render();
  });
  $<HTMLInputElement>("#te-outline").addEventListener("change", (event) => {
    active().outline = (event.target as HTMLInputElement).checked;
    render();
  });
  $<HTMLInputElement>("#te-uppercase").addEventListener("change", (event) => {
    active().uppercase = (event.target as HTMLInputElement).checked;
    render();
  });
  dialog
    .querySelectorAll<HTMLInputElement>('[name="te-color"]')
    .forEach((input) =>
      input.addEventListener("change", () => {
        if (input.checked) active().color = input.value as TextLayer["color"];
        render();
      }),
    );
  for (const axis of ["x", "y"] as const)
    $<HTMLInputElement>(`#te-${axis}`).addEventListener("input", (event) => {
      active()[axis] = Number((event.target as HTMLInputElement).value) / 100;
      syncPositions();
      render();
    });
  $("#te-add").addEventListener("click", () => {
    if (busy || layers.length >= 6) return;
    const layer = makeLayer(++counter, 0.5, 0.5, 0.8);
    layers.push(layer);
    activeId = layer.id;
    syncControls();
    render();
    textInput.focus();
  });
  $("#te-remove").addEventListener("click", () => {
    if (busy || layers.length <= 1) return;
    const index = layers.findIndex((layer) => layer.id === activeId);
    layers = layers.filter((layer) => layer.id !== activeId);
    activeId = layers[Math.min(index, layers.length - 1)].id;
    syncControls();
    render();
    textInput.focus();
  });

  function point(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (!editable || busy || event.button !== 0) return;
    const position = point(event);
    const hit = [...layers].reverse().find((layer) => {
      const box = geometry.get(layer.id);
      return (
        box &&
        position.x >= box.x &&
        position.x <= box.x + box.width &&
        position.y >= box.y &&
        position.y <= box.y + box.height
      );
    });
    if (!hit) return;
    activeId = hit.id;
    drag = {
      pointer: event.pointerId,
      offsetX: position.x - hit.x * canvas.width,
      offsetY: position.y - hit.y * canvas.height,
    };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    syncControls();
    render();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointer !== event.pointerId || busy) return;
    const position = point(event);
    active().x = clamp((position.x - drag.offsetX) / canvas.width, 0, 1);
    active().y = clamp((position.y - drag.offsetY) / canvas.height, 0, 1);
    syncPositions();
    render();
  });
  const endDrag = (event: PointerEvent) => {
    if (drag?.pointer === event.pointerId) {
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      drag = null;
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", () => {
    drag = null;
  });
  canvas.addEventListener("keydown", (event) => {
    if (!editable || busy) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    active().x = clamp(active().x + move[0] * step, 0, 1);
    active().y = clamp(active().y + move[1] * step, 0, 1);
    syncPositions();
    render();
  });

  function composedPng(): string {
    if (!image || !editable)
      throw new Error("Wait for the template to finish loading.");
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    const context = output.getContext("2d");
    if (!context) throw new Error("Could not create the finished meme.");
    try {
      paint(context, false);
      const dataUrl = output.toDataURL("image/png");
      if (
        !dataUrl.startsWith("data:image/png;base64,") ||
        dataUrl.length > MAX_DATA_URL_BYTES
      )
        throw new Error(
          "The finished image is too large. Try a smaller template.",
        );
      return dataUrl;
    } catch (error) {
      if (error instanceof DOMException && error.name === "SecurityError")
        throw new Error(
          "This image host blocks browser image editing. Open the template in the desktop app to add text.",
        );
      throw error;
    } finally {
      output.width = 1;
      output.height = 1;
    }
  }
  async function finish() {
    if (busy || !editable) return;
    const captions = layers.map((layer) => layer.text.trim());
    if (!captions.some(Boolean)) {
      setStatus("Add a caption first. Your meme is waiting for the punchline.");
      textInput.focus();
      return;
    }
    setBusy(true);
    setStatus("Copying your meme and keeping it in Your memes…");
    let message = "";
    try {
      const dataUrl = composedPng();
      if (native) {
        const result = await invoke<{ message: string; copied: boolean }>(
          "copy_composed",
          {
            dataUrl,
            templateId: item.id,
            captions,
            hideAfter: localStorage.getItem("hideAfter") !== "false",
          },
        );
        if (!result.copied) {
          setStatus(result.message, true);
          return;
        }
        message = result.message;
      } else {
        // Start clipboard access within the click gesture. Its PNG promise is
        // gated on successful persistence, including in Safari.
        const saved = saveBrowserMeme(dataUrl, item, captions);
        const copied = copyBrowserImage(dataUrl, saved);
        const outcomes = await Promise.allSettled([saved, copied]);
        if (outcomes[0].status === "rejected") throw outcomes[0].reason;
        if (outcomes[1].status === "rejected") {
          setStatus(
            String(outcomes[1].reason instanceof Error ? outcomes[1].reason.message : outcomes[1].reason),
            true,
          );
          return;
        }
        message = "Copied to your clipboard and saved in Your memes.";
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setStatus(reason, true);
      callbacks.onError(reason);
    } finally {
      if (!closed) setBusy(false);
    }
    if (message && !closed) {
      close();
      callbacks.onCopied(message);
    }
  }
  copyButton.addEventListener("click", () => {
    void finish();
  });
  syncControls();
  dialog.showModal();
  $(".te-close").focus();

  try {
    const prepared = native
      ? await invoke<PreparedTemplate>("prepare_template", { id: item.id })
      : null;
    if (closed) return;
    const src = prepared?.dataUrl || item.mediaUrl;
    if (
      native &&
      (!src.startsWith("data:image/") || src.length > MAX_DATA_URL_BYTES)
    )
      throw new Error("The template is too large to edit safely.");
    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        img.src = "";
        reject(
          new Error(
            "The template took too long to load. Check your connection and try again.",
          ),
        );
      }, 20000);
      if (!native) img.crossOrigin = "anonymous";
      img.onload = () => {
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        reject(
          new Error(
            native
              ? "The template image could not be opened."
              : "This image host blocks browser editing, or the image is unavailable. Use the desktop app to add text to this template.",
          ),
        );
      };
      img.src = src;
    });
    if (closed) {
      loaded.src = "";
      return;
    }
    if (!loaded.naturalWidth || !loaded.naturalHeight)
      throw new Error("The template has no usable image dimensions.");
    image = loaded;
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(loaded.naturalWidth, loaded.naturalHeight),
    );
    canvas.width = Math.max(1, Math.round(loaded.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(loaded.naturalHeight * scale));
    editable = true;
    loading.hidden = true;
    canvas.hidden = false;
    controls.removeAttribute("aria-disabled");
    syncControls();
    render();
    setStatus(
      "Copy to your clipboard. Automatically saved in Your memes for next time.",
    );
    textInput.focus();
  } catch (error) {
    if (closed) return;
    const reason = error instanceof Error ? error.message : String(error);
    loading.textContent = reason;
    loading.classList.add("te-error");
    canvas.hidden = true;
    setStatus(
      "Close the editor and try another template, or retry after checking your connection.",
      true,
    );
    callbacks.onError(reason);
  }
}
