mod library;

use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose::STANDARD, Engine};
use library::{LibraryStore, MemeItem, Result, DEFAULT_SHORTCUT};
use serde::Serialize;
use std::{borrow::Cow, fs, io::Cursor, sync::Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct AppState {
    store: Mutex<Result<LibraryStore>>,
    clipboard: Mutex<Option<Clipboard>>,
    diagnostics: Mutex<Vec<String>>,
}

fn with_store<T>(
    state: &AppState,
    action: impl FnOnce(&mut LibraryStore) -> Result<T>,
) -> Result<T> {
    let mut guard = state
        .store
        .lock()
        .map_err(|_| "The library is busy after an unexpected error. Restart MemeIT.")?;
    match guard.as_mut() {
        Ok(store) => action(store),
        Err(error) => Err(error.clone()),
    }
}

fn diagnostic(app: &AppHandle, text: String) {
    if let Ok(mut diagnostics) = app.state::<AppState>().diagnostics.lock() {
        if !diagnostics.contains(&text) {
            diagnostics.push(text);
        }
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("picker-shown", ());
    }
}

#[derive(Serialize)]
struct Bootstrap {
    items: Vec<MemeItem>,
    diagnostics: Vec<String>,
    shortcut: String,
    version: &'static str,
}

#[tauri::command]
fn bootstrap(state: State<'_, AppState>) -> Result<Bootstrap> {
    with_store(&state, |store| {
        Ok(Bootstrap {
            items: store.library.items.clone(),
            diagnostics: state
                .diagnostics
                .lock()
                .map_err(|_| "Could not read diagnostics.")?
                .clone(),
            shortcut: store.library.shortcut.clone(),
            version: env!("CARGO_PKG_VERSION"),
        })
    })
}

#[tauri::command]
fn search_memes(
    query: String,
    filter: String,
    state: State<'_, AppState>,
) -> Result<Vec<MemeItem>> {
    with_store(&state, |store| {
        library::search(&store.library.items, &query, &filter)
    })
}

#[derive(Serialize)]
struct Media {
    preview: String,
    original: Option<String>,
}

#[tauri::command]
async fn get_media(id: String, app: AppHandle) -> Result<Media> {
    tauri::async_runtime::spawn_blocking(move || {
        let (path, kind) = with_store(&app.state::<AppState>(), |store| {
            Ok((store.media_path(&id)?, store.item(&id)?.kind.clone()))
        })?;
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.len() > library::MAX_FILE_BYTES {
            return Err("Media exceeds the 20 MB limit.".into());
        }
        if kind == "gif" {
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            return Ok(Media {
                preview: format!("data:image/gif;base64,{}", STANDARD.encode(bytes)),
                original: None,
            });
        }
        library::inspect_media(&path)?;
        let image = image::open(path)
            .map_err(|e| format!("Cannot display image: {e}"))?
            .thumbnail(720, 720);
        let mut encoded = Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        Ok(Media {
            preview: format!(
                "data:image/png;base64,{}",
                STANDARD.encode(encoded.into_inner())
            ),
            original: None,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_memes(app: AppHandle) -> Result<Vec<MemeItem>> {
    let files = rfd::AsyncFileDialog::new()
        .set_title("Import memes")
        .add_filter("Images and GIFs", &["png", "gif", "jpg", "jpeg", "webp"])
        .pick_files()
        .await;
    let Some(files) = files else {
        return Ok(Vec::new());
    };
    let paths = files
        .into_iter()
        .map(|file| file.path().to_path_buf())
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        with_store(&app.state::<AppState>(), |store| store.import(paths))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn update_meme(
    id: String,
    title: String,
    description: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
) -> Result<MemeItem> {
    let title = title.trim().to_string();
    let description = description.trim().to_string();
    if title.is_empty() || title.chars().count() > 160 {
        return Err("Give this meme a title of 1–160 characters.".into());
    }
    if description.chars().count() > 2000 {
        return Err("Descriptions can contain up to 2,000 characters.".into());
    }
    if tags.len() > 24 || tags.iter().any(|tag| tag.chars().count() > 60) {
        return Err("Use up to 24 tags, each no longer than 60 characters.".into());
    }
    let mut tags: Vec<_> = tags
        .into_iter()
        .map(|tag| tag.trim().to_lowercase())
        .filter(|tag| !tag.is_empty())
        .collect();
    tags.sort();
    tags.dedup();
    with_store(&state, |store| {
        store.mutate(|library| {
            let item = library
                .items
                .iter_mut()
                .find(|item| item.id == id)
                .ok_or("Meme not found.")?;
            item.title = title;
            item.description = description;
            item.tags = tags;
            Ok(item.clone())
        })
    })
}

#[tauri::command]
fn toggle_favorite(id: String, state: State<'_, AppState>) -> Result<MemeItem> {
    with_store(&state, |store| {
        store.mutate(|library| {
            let item = library
                .items
                .iter_mut()
                .find(|item| item.id == id)
                .ok_or("Meme not found.")?;
            item.favorite = !item.favorite;
            Ok(item.clone())
        })
    })
}

#[derive(Serialize)]
struct CopyResult {
    message: String,
}

#[tauri::command]
async fn copy_meme(
    id: String,
    mode: String,
    hide_after: bool,
    app: AppHandle,
) -> Result<CopyResult> {
    let copy_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<CopyResult> {
        let state = copy_app.state::<AppState>();
        let (path, kind) = with_store(&state, |store| {
            Ok((store.media_path(&id)?, store.item(&id)?.kind.clone()))
        })?;
        library::inspect_media(&path)?;
        if mode != "image" && mode != "file" {
            return Err("Unknown copy mode.".into());
        }
        if mode == "image" && kind == "gif" {
            return Err("Use Copy GIF file to preserve the animation.".into());
        }
        let mut owner = state
            .clipboard
            .lock()
            .map_err(|_| "Clipboard is unavailable. Restart MemeIT.")?;
        if owner.is_none() {
            *owner = Some(Clipboard::new().map_err(|e| {
                format!("Clipboard is unavailable on this desktop. Use Save file instead. {e}")
            })?);
        }
        let clipboard = owner.as_mut().ok_or("Clipboard is unavailable.")?;
        if mode == "file" {
            clipboard
                .set()
                .file_list(&[path])
                .map_err(|e| format!("Could not copy the file. Try Save file instead. {e}"))?;
        } else {
            let image = image::open(path).map_err(|e| e.to_string())?.to_rgba8();
            let (width, height) = image.dimensions();
            clipboard
                .set_image(ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: Cow::Owned(image.into_raw()),
                })
                .map_err(|e| format!("Could not copy the image. Try Save file instead. {e}"))?;
        }
        drop(owner);
        // Copy succeeded even if writing the recent-use history fails.
        if let Err(error) = with_store(&state, |store| {
            store.mutate(|library| {
                let item = library
                    .items
                    .iter_mut()
                    .find(|item| item.id == id)
                    .ok_or("Meme not found.")?;
                item.last_used = Some(library::now());
                Ok(())
            })
        }) {
            diagnostic(
                &copy_app,
                format!("Copied successfully, but could not save recent history: {error}"),
            );
        }
        let message = if mode == "file" {
            "File copied. Paste into a chat that accepts attachments, or use Save file."
        } else {
            "Image copied. Return to your conversation and paste."
        };
        Ok(CopyResult {
            message: message.into(),
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    if hide_after {
        if let Some(window) = app.get_webview_window("main") {
            window.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(result)
}

#[tauri::command]
async fn export_meme(id: String, app: AppHandle) -> Result<bool> {
    let (source, filename) = with_store(&app.state::<AppState>(), |store| {
        Ok((store.media_path(&id)?, store.item(&id)?.filename.clone()))
    })?;
    let destination = rfd::AsyncFileDialog::new()
        .set_title("Save meme")
        .set_file_name(filename)
        .save_file()
        .await;
    let Some(destination) = destination else {
        return Ok(false);
    };
    let destination = destination.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        library::inspect_media(&source)?;
        if destination.canonicalize().ok().as_ref() == Some(&source) {
            return Ok(true);
        }
        let parent = destination.parent().ok_or("Invalid destination.")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        std::io::copy(
            &mut fs::File::open(source).map_err(|e| e.to_string())?,
            &mut temporary,
        )
        .map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary
            .persist(destination)
            .map_err(|e| format!("Could not save file: {e}"))?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) -> Result<()> {
    window.hide().map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct ShortcutResult {
    shortcut: String,
    diagnostics: Vec<String>,
}

#[tauri::command]
fn set_shortcut(
    binding: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ShortcutResult> {
    if binding.len() > 100 || binding.trim().is_empty() {
        return Err("Enter a valid keyboard shortcut.".into());
    }
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        return Err("Global shortcuts are not yet supported on Wayland. Configure your desktop's keyboard shortcut to launch MemeIT; an existing instance will reopen.".into());
    }
    let shortcut: tauri_plugin_global_shortcut::Shortcut = binding
        .parse()
        .map_err(|e| format!("Invalid shortcut: {e}"))?;
    // Shift alone is ordinary typing; require a command modifier.
    use tauri_plugin_global_shortcut::Modifiers;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::SUPER | Modifiers::ALT)
    {
        return Err(
            "Include Control, Command, or Alt, for example CommandOrControl+Shift+M.".into(),
        );
    }
    let old = with_store(&state, |store| Ok(store.library.shortcut.clone()))?;
    let old_shortcut = old.parse::<tauri_plugin_global_shortcut::Shortcut>().ok();
    let was_registered = app.global_shortcut().is_registered(shortcut);
    if !was_registered {
        app.global_shortcut()
            .register(shortcut)
            .map_err(|e| format!("This shortcut is unavailable or already used: {e}"))?;
    }
    if old != binding {
        if let Err(error) = with_store(&state, |store| {
            store.mutate(|library| {
                library.shortcut = binding.clone();
                Ok(())
            })
        }) {
            if !was_registered {
                let _ = app.global_shortcut().unregister(shortcut);
            }
            return Err(error);
        }
        if old_shortcut != Some(shortcut) {
            let _ = app.global_shortcut().unregister(old.as_str());
        }
    }
    let mut diagnostics = state
        .diagnostics
        .lock()
        .map_err(|_| "Could not read diagnostics.")?;
    diagnostics.retain(|message| !message.starts_with("Could not register "));
    Ok(ShortcutResult {
        shortcut: binding,
        diagnostics: diagnostics.clone(),
    })
}

fn install_tray(app: &AppHandle) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Open MemeIT", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit MemeIT", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("MemeIT — find the reaction")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_window(app),
            "quit" => app.exit(0),
            _ => (),
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app)
        }));
    // The shortcut plugin opens X11 during initialization. Do not load it on
    // Wayland: the entire application must remain usable without an X server.
    let shortcuts_available =
        !cfg!(target_os = "linux") || std::env::var_os("WAYLAND_DISPLAY").is_none();
    let builder = if shortcuts_available {
        builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false)
                                && window.is_focused().unwrap_or(false)
                            {
                                let _ = window.hide();
                            } else {
                                show_window(app);
                            }
                        }
                    }
                })
                .build(),
        )
    } else {
        builder
    };
    builder.setup(|app| {
            let directory = app.path().app_data_dir()?;
            let assets = app.path().resource_dir()?.join("assets");
            let assets = if cfg!(debug_assertions) && !assets.join("catalog.json").exists() {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets")
            } else { assets };
            let store = LibraryStore::load(directory, &assets);
            let shortcut = store.as_ref().map(|store| store.library.shortcut.clone()).unwrap_or_else(|_| DEFAULT_SHORTCUT.into());
            let clipboard = Clipboard::new();
            let mut diagnostics = Vec::new();
            if let Err(error) = &clipboard { diagnostics.push(format!("Clipboard is unavailable. You can still search and save files. {error}")); }
            app.manage(AppState { store: Mutex::new(store), clipboard: Mutex::new(clipboard.ok()), diagnostics: Mutex::new(diagnostics) });
            #[cfg(not(target_os = "linux"))]
            let register = true;
            #[cfg(target_os = "linux")]
            let mut register = true;
            #[cfg(target_os = "linux")]
            if std::env::var_os("WAYLAND_DISPLAY").is_some() {
                register = false;
                diagnostic(app.handle(), "Wayland: use the launcher or tray. You can assign a desktop keyboard shortcut to launch MemeIT; native global shortcut support is planned.".into());
            }
            if register { if let Err(error) = app.global_shortcut().register(shortcut.as_str()) { diagnostic(app.handle(), format!("Could not register {shortcut}. Choose another shortcut in Settings. {error}")); } }
            if let Err(error) = install_tray(app.handle()) { diagnostic(app.handle(), format!("System tray is unavailable: {error}")); }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![bootstrap, search_memes, get_media, import_memes, update_meme, toggle_favorite, copy_meme, export_meme, hide_window, set_shortcut])
        .build(tauri::generate_context!())
        .expect("MemeIT could not start")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if matches!(_event, tauri::RunEvent::Reopen { .. }) { show_window(_app); }
        });
}
