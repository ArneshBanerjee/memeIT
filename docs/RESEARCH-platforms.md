# Cross-platform interaction research

Research checked against upstream documentation on 26 November 2026. This document distinguishes platform capabilities from features implemented or verified in MemeIT. A compiled artifact is not evidence that clipboard insertion works in every chat application.

## The interaction worth building

The useful product is a small, resident reaction palette: invoke a shortcut while chatting, describe the reaction, choose a result using the keyboard, copy the media, return to the conversation, and paste. A single-instance process, a tray menu, recent selections, local favorites, immediate search focus, Escape to hide, and cancellation of stale search requests reduce friction. Previews should be inexpensive; original media should be retained for export and animated GIF transfer.

Automatic sending is unnecessary. It could send into the wrong conversation and cannot be made reliable merely by sharing a Rust codebase. The initial implementation copies and optionally hides the palette. Users choose the destination and paste. Future automatic paste must be opt-in, limited to platforms with tested focus handling, and must never simulate the final Send/Enter action.

## Framework decision

**Tauri v2 with a Rust core is the practical choice.** Tauri offers window management, a system tray, single-instance activation, packaging, and maintained plugins. It renders HTML/CSS/JavaScript through the operating system's webview, while Rust owns internet provider requests, the library, search ranking, image handling, persistence, and clipboard. Animated GIF rendering and accessible keyboard controls are straightforward in HTML. This is a Rust-backed desktop application; its interface is web technology, not an entirely Rust-authored UI. [Tauri overview](https://v2.tauri.app/start/)

Tauri v2 uses WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux. This avoids shipping a full browser engine but makes webview compatibility and Linux system dependencies part of testing. Tauri 3 is currently alpha; the app intentionally uses the stable v2 line. [Webview versions](https://v2.tauri.app/reference/webview-versions/), [Tauri 3 runtime documentation](https://v3.tauri.app/develop/webview-runtime/)

Pure-Rust alternatives were considered. `egui` is productive and provides AccessKit support, but its immediate-mode model requires more custom work for a highly styled, animated media browser. `iced` provides a declarative architecture inspired by Elm, while its own README still describes it as experimental. Both are legitimate options when an entirely Rust UI is a strict requirement; neither removes platform clipboard or focus constraints. [egui](https://github.com/emilk/egui), [iced](https://github.com/iced-rs/iced)

## Global shortcuts and application lifetime

Tauri's global-shortcut plugin uses the `global-hotkey` crate. The underlying crate explicitly lists Windows, macOS, and **Linux X11 only**. Its Linux support must not be interpreted as native Wayland global-shortcut support. Windows requires a running Win32 event loop, and macOS requires the event loop and hotkey manager on the main thread. Tauri supplies the application event loop. [Global hotkeys upstream](https://github.com/tauri-apps/global-hotkey), [Tauri plugin](https://v2.tauri.app/plugin/global-shortcut/)

For Wayland, the standard long-term solution is the XDG GlobalShortcuts portal. Applications create a session, bind shortcuts, and receive activation signals independently of window focus. Availability depends on the installed desktop portal backend. A production implementation must test portal discovery, user approval, rebinding, and unavailable-backend behavior. [XDG GlobalShortcuts](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html)

MemeIT's first implementation detects a Wayland session and explains the limitation. The launcher and tray still work, and a desktop-configured command shortcut can relaunch MemeIT: the single-instance handler focuses the existing window. Native Wayland portal registration remains future work. The default shortcut elsewhere is Command/Ctrl+Shift+M, with conflict reporting and a configurable binding.

Closing the palette hides it so the process can continue hosting the Linux clipboard. Quit remains an explicit tray action. Shortcut failures should not prevent search, importing, or saving files.

## Clipboard: static images and animated GIFs are different

`arboard::Clipboard::set_image` accepts pixel data and exposes platform image representations: NSImage on macOS, PNG on Linux, and DIB/bitmap on Windows. This is appropriate for static PNG/JPEG/WebP. Converting a GIF into these pixel representations loses its animation. [arboard Clipboard API](https://docs.rs/arboard/latest/arboard/struct.Clipboard.html)

The GIF path must preserve the original file. arboard 3.7.0 exposes `clipboard.set().file_list(&[path])`, allowing the operating system's file clipboard representation to reference the retained GIF. The actual 3.7.0 version was verified against crates.io during implementation. Receiving applications still decide whether file pasting creates an attachment. Provide Save file as a universal manual fallback; a future remote provider can also offer Copy link. [arboard Set API](https://docs.rs/arboard/latest/arboard/struct.Set.html)

At the platform level, Windows `CF_HDROP` represents existing file paths, while macOS's pasteboard supports file URLs and typed file contents. These mechanisms transfer the original bytes; they do not guarantee that every chat editor accepts them. [Windows shell clipboard formats](https://learn.microsoft.com/en-us/windows/win32/shell/clipboard), [Apple file URL type](https://developer.apple.com/documentation/appkit/nspasteboard/pasteboardtype/fileurl)

On Linux, clipboard contents are served by the application that owns the selection. Creating a temporary clipboard object, setting an image, and dropping it can make the data disappear before another application pastes. MemeIT keeps a long-lived clipboard object in state. Clipboard operations are serialized, which also avoids competing Windows clipboard access. [arboard ownership documentation](https://github.com/1Password/arboard#gnulinux)

arboard's `wayland-data-control` feature adds native support when the compositor offers a supported data-control extension. It is enabled here. Pure Wayland environments without these protocols may still need XWayland or a future toolkit-specific integration. The app reports clipboard failures and retains Save file functionality. Wayland support must be verified per desktop/compositor, not asserted for all Linux distributions.

## Focus and automatic paste

Windows restricts `SetForegroundWindow`; calls can be denied even when documented preconditions appear satisfied. A reliable automatic-paste feature must remember the previous target, restore it, verify focus, and abort if the target is no longer valid. Hiding a window alone is not a universal guarantee that the intended editor regained focus. [Microsoft foreground rules](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)

Enigo is a possible Rust input-simulation layer. Its permissions documentation notes macOS Accessibility approval and Windows integrity-level restrictions. Linux support varies between X11 and Wayland backends. These requirements are unnecessary for basic search/copy and should not be requested during first-run onboarding. [Enigo](https://github.com/enigo-rs/enigo), [Enigo permissions](https://github.com/enigo-rs/enigo/blob/main/Permissions.md)

The current version does not implement input injection, explicit foreground-app restoration, or automatic sending. Its user-facing promise is copying media and leaving the user in control of pasting.

## Desktop support and mobile scope

The initial deliverables target macOS on Apple Silicon and Intel, Windows x64, and Linux x64. Installer formats and runner availability are a release engineering concern separate from interaction testing. Minimum package versions should be stated alongside each release; unsupported OS versions should not be advertised simply because the code compiles.

Android and iOS need different integrations. Android's Commit Content API lets keyboards insert rich media, but the receiving editor must advertise matching MIME types and accept the content URI. This requires an Android input-method extension or a share-sheet flow, not a desktop hotkey port. [Android image keyboard support](https://developer.android.com/develop/ui/views/touch-and-input/image-keyboard)

iOS keyboard extensions use a text-document proxy rather than direct access to another application's editor. Apps can reject third-party keyboards; network/shared-container access is also subject to extension configuration. A share/copy flow or native keyboard extension requires separate product work and testing. Rust may share the search/library logic, but does not remove the OS integration requirements. [Apple custom keyboards](https://developer.apple.com/documentation/uikit/creating-a-custom-keyboard), [Apple keyboard interfaces](https://developer.apple.com/documentation/uikit/configuring-a-custom-keyboard-interface), [Text document proxy](https://developer.apple.com/documentation/uikit/uitextdocumentproxy)

## Search and media boundaries in the first version

Internet search starts with the public Imgflip and Memegen catalogs: real, recognizable meme formats, explicitly labeled as templates rather than finished captioned posts or the entire internet. Selected Imgflip/Memegen media can be downloaded, copied, exported, and retained locally. Users may also import files through a native picker. Images are inspected by content, capped at 20 MiB, 8,192 pixels per side, and 16 megapixels overall. Static local previews are reduced to 720 pixels; local GIF previews use original bytes to retain animation. Animated PNG and animated WebP are detected and rejected with a request to convert to GIF, avoiding silent flattening. Static PNG/JPEG/WebP remain supported. Imported media is never interpreted as HTML or JavaScript.

Imgflip API Premium enables its full template search with a user-supplied key. Separate KLIPY GIF and meme sections support direct requests from the desktop client and preserve provider ordering and delivery URLs. KLIPY currently permits Copy link only: its integration requirements prohibit retaining media copies without written approval, so local saving and file copying are disabled. User-entered keys last for the app session and are never written to disk or returned to the UI. A persistent random client ID is sent to KLIPY for the provider's customer identifier. [Imgflip API](https://imgflip.com/api), [Memegen guide](https://memegen.link/guide/), [KLIPY integration requirements](https://docs.klipy.com/integration-requirements)

The frontend receives local media by opaque library ID as a data URI. Internet media uses provider-returned, validated HTTPS CDN URLs. Download commands accept only IDs looked up in Rust-held search results, never arbitrary URLs or filesystem paths. Redirects must remain on the provider's allowlisted CDN. Filenames are validated, symlinks are rejected, and media is checked to remain inside the library directory. The webview's restricted content security policy permits only the selected providers' image hosts, and has no filesystem or shell plugin grants. JSON updates use a temporary file and atomic replacement; an unreadable existing library is reported rather than overwritten.

Public-catalog and Your memes search combine local sentence embeddings with title, tag, and description matching. The CPU-only Rust Candle implementation uses a pinned, checksum-verified `sentence-transformers/all-MiniLM-L6-v2` model and a precomputed description index. Model loading happens lazily on a blocking worker, and queries stay on the device. The 90.9 MB model weights are distributed separately from web assets and bundled with the native app. Missing or invalid resources cause an explicit keyword-search fallback. Embeddings improve paraphrase recall; they do not add missing images to a catalog or guarantee the right interpretation of every description. Saved and imported library items are embedded from their editable text metadata on the same worker. Their descriptors use an in-memory cache of at most 512 items, keyed by item ID and the complete metadata hash so edits invalidate previous meanings. Filters apply before inference, and all eligible items receive a score before results return; a large uncached library can take longer on its first description search. Captioned creations retain the source template visual description alongside caption text. Imported images need user-provided descriptions: there is no image classification. Live providers use their own search engines without local reordering. [MiniLM model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), [Candle](https://github.com/huggingface/candle)

The public APIs are bounded catalogs, so `assets/public-supplemental.json` supplies verified existing Imgflip templates that are absent from those feeds. It is shared by the desktop app and browser preview and stores only source URLs and descriptive metadata, not bundled copies of the images. Supplemental formats merge by provider ID even when a previously downloaded catalog is still fresh. The exact Cooked Dog example was visually checked against the requested brown Labrador with closed eyes in sunset light. Other additions cover Chill Guy, Let Him Cook, Sad Hamster, Absolute Cinema, Smurf Cat, Huh Cat, Shocked Black Guy and Math Lady. This is an extensible curated supplement, not a claim to cover every internet meme. Source links remain in each record. [Cooked Dog template](https://imgflip.com/memetemplate/574931918/Cooked-Dog), [Chill Guy](https://imgflip.com/memetemplate/562391530/Chill-guy), [Let Him Cook](https://imgflip.com/memetemplate/430535625/Let-Him-Cook), [Sad Hamster](https://imgflip.com/memetemplate/511654183/Sad-Hamster), [Absolute Cinema](https://imgflip.com/memetemplate/514151477/Absolute-Cinema-Blank), [Smurf Cat](https://imgflip.com/memetemplate/480418395/Blue-Smurf-cat), [Huh Cat](https://imgflip.com/memetemplate/488919824/Huh-Cat), [Shocked Black Guy](https://imgflip.com/memetemplate/417698494/Shocked-black-guy), [Math Lady](https://imgflip.com/memetemplate/80996545/Math-ladyConfused-lady)

Template captioning happens locally. The Rust backend downloads a selected, registered Imgflip/Memegen static template and returns a decoded PNG capped at 1,600 pixels per side. This avoids cross-origin canvas restrictions without allowing the webview to fetch arbitrary URLs through Rust. The interface adds user text on a canvas. Copy accepts a strictly validated static PNG data URL, a Rust-registered template ID, and up to six bounded captions. It first saves the finished image into Your memes, using a SHA-256 content ID to avoid duplicate files and entries on retries, then copies pixels directly to the clipboard. Metadata includes the source template, caption text and source URL, with bounded searchable descriptions. Metadata commit failure removes a newly created image; clipboard failure keeps the durable saved meme and explicitly reports that copying failed. The existing saved item retains user edits and favorite state on repeated copies. Export remains an optional fallback from Your memes. No caption text is sent to a provider, no captioning API key is required, and copying never automatically sends the message. GIF template editing and KLIPY editing are not supported. Original source information remains available beside the online template and is included in locally retained template descriptions.

## Required manual compatibility matrix

Before calling an OS/chat combination supported, test the installed application, not only a development window:

| Check | Expected evidence |
| --- | --- |
| Launch, tray, single instance | Packaged app opens; second launch reuses it; Quit exits |
| Shortcut and conflict | Opens from another app; reports occupied binding; custom binding survives restart |
| Keyboard navigation | Search receives focus; arrows/Enter work; Escape hides |
| Static media | PNG/JPEG/WebP paste as visible images, with correct transparency and dimensions |
| GIF media | File paste produces attachment; animation survives sending; Save fallback preserves original bytes |
| Clipboard lifetime | Copy, hide, wait, then paste; repeat on X11 and supported Wayland desktops |
| Focus behavior | Hiding does not lose user's draft; manual paste reaches the intended conversation |
| File safety | Fake images, oversized media, bad dimensions, and symlinks fail visibly |
| Persistence | Favorites, metadata, recent history, and imports survive restart |
| Accessibility | Keyboard-only use, readable focus, screen reader labels, reduced-motion behavior |

The target chat matrix includes Discord, Slack, Telegram, WhatsApp web/desktop, browser chat editors, and native Messages where available. Windows/macOS/Linux builds and automated unit tests do not substitute for these application-specific checks. Keep untested combinations labeled as unverified.
