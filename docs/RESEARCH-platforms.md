# Cross-platform interaction research

Research checked against upstream documentation on 26 November 2026. This document distinguishes platform capabilities from features implemented or verified in MemeIT. A compiled artifact is not evidence that clipboard insertion works in every chat application.

## The interaction worth building

The useful product is a small, resident reaction palette: invoke a shortcut while chatting, describe the reaction, choose a result using the keyboard, copy the media, return to the conversation, and paste. A single-instance process, a tray menu, recent selections, local favorites, immediate search focus, Escape to hide, and cancellation of stale search requests reduce friction. Previews should be inexpensive; original media should be retained for export and animated GIF transfer.

Automatic sending is unnecessary. It could send into the wrong conversation and cannot be made reliable merely by sharing a Rust codebase. The initial implementation copies and optionally hides the palette. Users choose the destination and paste. Future automatic paste must be opt-in, limited to platforms with tested focus handling, and must never simulate the final Send/Enter action.

## Framework decision

**Tauri v2 with a Rust core is the practical choice.** Tauri offers window management, a system tray, single-instance activation, packaging, and maintained plugins. It renders HTML/CSS/JavaScript through the operating system's webview, while Rust owns the library, search ranking, image handling, persistence, and clipboard. Animated GIF rendering and accessible keyboard controls are straightforward in HTML. This is a Rust-backed desktop application; its interface is web technology, not an entirely Rust-authored UI. [Tauri overview](https://v2.tauri.app/start/)

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

The first version uses a bundled original reaction pack and imports selected through a native file picker. User files are copied into the app's own data directory. Images are inspected by content, capped at 20 MiB, 8,192 pixels per side, and 16 megapixels overall. Static previews are reduced to 720 pixels; GIF previews use original bytes to retain animation. Imported media is never interpreted as HTML or JavaScript.

The frontend receives media by opaque library ID as a data URI. It cannot supply arbitrary filesystem paths to image or clipboard commands. Filenames are validated, symlinks are rejected, and media is checked to remain inside the library directory. The webview uses a restricted content security policy and has no filesystem or shell plugin grants. JSON updates use a temporary file and atomic replacement; an unreadable existing library is reported rather than overwritten.

Natural-language search currently means local token ranking with emotion/situation synonyms across titles, descriptions, and tags. It can connect “stressed at my job” with an overwhelmed/work reaction, but it is not an embedding model and cannot understand arbitrary descriptions with model-level semantic recall. The UI and marketing should say what it does accurately. A future semantic model can share the same library/search interface after model size, startup cost, and retrieval quality are measured.

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
