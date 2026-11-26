use crate::library::{MemeItem, Result, MAX_FILE_BYTES};
use crate::online::{self, OnlineItem};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat, ImageReader};
use serde::Serialize;
use std::io::Cursor;

const PREFIX: &str = "data:image/png;base64,";

pub struct PreparedComposition {
    pub bytes: Vec<u8>,
    pub image: DynamicImage,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
}

#[derive(Serialize)]
pub struct CopyOutcome {
    pub message: String,
    pub item: MemeItem,
    pub copied: bool,
}

impl CopyOutcome {
    pub fn after_copy(item: MemeItem, result: Result<()>) -> Self {
        let copied = result.is_ok();
        let message = if copied {
            "Saved to Your memes and copied. Paste the image into your conversation.".into()
        } else {
            "Saved to Your memes, but the clipboard could not be updated. Try Copy image again from Your memes, or use Save file there to attach it.".into()
        };
        Self {
            message,
            item,
            copied,
        }
    }
}

/// Only the template ID crosses IPC; title and provenance come from Rust-held results.
pub fn prepare(
    data_url: &str,
    template: &OnlineItem,
    captions: &[String],
) -> Result<PreparedComposition> {
    if !template.is_template
        || !["imgflip", "memegen"].contains(&template.provider.as_str())
        || template.kind == "gif"
    {
        return Err("Choose a supported static template before copying your meme.".into());
    }
    online::checked_source(&template.source_url)?;
    if captions.len() > 6
        || captions.iter().any(|caption| {
            caption.chars().count() > 400
                || caption
                    .chars()
                    .any(|c| c.is_control() && !['\n', '\r', '\t'].contains(&c))
        })
    {
        return Err("Use up to six captions, each no longer than 400 characters.".into());
    }
    let (bytes, image) = decode(data_url)?;
    let template_title: String = template.title.chars().take(160).collect();
    let first = captions
        .iter()
        .map(|caption| caption.trim())
        .find(|caption| !caption.is_empty());
    let title: String = match first {
        Some(caption) => format!("{template_title} — {caption}"),
        None => format!("My {template_title} meme"),
    }
    .chars()
    .take(160)
    .collect();
    let provenance = format!(
        "Template: {template_title}\nSource: {}",
        template.source_url
    );
    if provenance.chars().count() > 1900 {
        return Err("This template has too much source metadata to save safely.".into());
    }
    // Preserve provenance while bounding editable/searchable library metadata.
    let scene_budget = 2000usize
        .saturating_sub(provenance.chars().count() + 32)
        .min(600);
    let scene: String = template.description.chars().take(scene_budget).collect();
    let scene = format!("Scene: {scene}");
    let budget = 2000usize.saturating_sub(provenance.chars().count() + scene.chars().count() + 15);
    let caption_text: String = captions.join("\n").trim().chars().take(budget).collect();
    let description: String = format!("{scene}\nCaptions: {caption_text}\n\n{provenance}")
        .trim()
        .chars()
        .take(2000)
        .collect();
    let mut tags: Vec<String> = template
        .tags
        .iter()
        .take(28)
        .map(|tag| tag.chars().take(40).collect())
        .collect();
    tags.extend(["my meme".into(), "created".into()]);
    tags.sort();
    tags.dedup();
    Ok(PreparedComposition {
        bytes,
        image,
        title,
        description,
        tags,
    })
}

/// Decode only a bounded static PNG supplied by the app's local canvas.
pub fn decode(data_url: &str) -> Result<(Vec<u8>, DynamicImage)> {
    let encoded = data_url
        .strip_prefix(PREFIX)
        .ok_or("The composed image must be a PNG data URL.")?;
    if encoded.len() as u64 > (MAX_FILE_BYTES.div_ceil(3) * 4) {
        return Err("The composed image exceeds 20 MB.".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "The composed image contains invalid base64.")?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("The composed image must be nonempty and no larger than 20 MB.".into());
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("The composed image is not a PNG.".into());
    }
    let (width, height) = ImageReader::with_format(Cursor::new(&bytes), ImageFormat::Png)
        .into_dimensions()
        .map_err(|_| "The composed PNG is invalid.")?;
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 16_000_000
    {
        return Err("The composed image exceeds the 8,192-pixel or 16-megapixel limit.".into());
    }
    let decoder = image::codecs::png::PngDecoder::new(Cursor::new(&bytes))
        .map_err(|_| "The composed PNG is invalid.")?;
    if decoder
        .is_apng()
        .map_err(|_| "The composed PNG is invalid.")?
    {
        return Err("Composed memes must be static PNG images.".into());
    }
    let mut reader = ImageReader::with_format(Cursor::new(&bytes), ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| "The composed PNG could not be decoded.")?;
    Ok((bytes, image))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::LibraryStore;

    fn template() -> OnlineItem {
        OnlineItem {
            id: "imgflip:574931918".into(),
            title: "Cooked Dog".into(),
            description: "Brown dog accepting its fate.".into(),
            tags: vec!["cooked".into(), "dog".into()],
            kind: "png".into(),
            preview_url: "https://i.imgflip.com/9iasb2.png".into(),
            media_url: "https://i.imgflip.com/9iasb2.png".into(),
            source_url: "https://imgflip.com/memetemplate/574931918/Cooked-Dog".into(),
            provider: "imgflip".into(),
            is_template: true,
        }
    }

    fn png_url() -> String {
        let pixels = image::RgbaImage::from_pixel(8, 6, image::Rgba([20, 40, 60, 255]));
        let mut png = Cursor::new(Vec::new());
        pixels.write_to(&mut png, ImageFormat::Png).unwrap();
        format!("{PREFIX}{}", STANDARD.encode(png.into_inner()))
    }

    fn store(root: &std::path::Path) -> LibraryStore {
        let assets = root.join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::write(assets.join("catalog.json"), "[]").unwrap();
        LibraryStore::load(root.join("library"), &assets).unwrap()
    }

    #[test]
    fn autosaved_caption_reopens_deduplicates_and_preserves_user_edits() {
        let root = tempfile::tempdir().unwrap();
        let mut store = store(root.path());
        let ready = prepare(
            &png_url(),
            &template(),
            &["When the deadline explodes".into()],
        )
        .unwrap();
        let saved = store
            .save_generated_png(
                &ready.bytes,
                ready.title.clone(),
                ready.description.clone(),
                ready.tags.clone(),
            )
            .unwrap();
        assert!(saved.title.contains("Cooked Dog"));
        assert!(saved.description.contains("When the deadline explodes"));
        assert!(saved.description.contains(&template().source_url));
        assert!(saved.last_used.is_some());
        assert_eq!(
            std::fs::read(store.media_path(&saved.id).unwrap()).unwrap(),
            ready.bytes
        );
        store
            .mutate(|library| {
                library.items[0].favorite = true;
                library.items[0].title = "My edited title".into();
                library.items[0].last_used = Some(1);
                Ok(())
            })
            .unwrap();
        let repeated = store
            .save_generated_png(&ready.bytes, ready.title, ready.description, ready.tags)
            .unwrap();
        assert_eq!(repeated.id, saved.id);
        assert!(repeated.favorite);
        assert_eq!(repeated.title, "My edited title");
        assert!(repeated.last_used.unwrap() > 1);
        let reopened =
            LibraryStore::load(root.path().join("library"), &root.path().join("assets")).unwrap();
        assert_eq!(reopened.library.items.len(), 1);
        assert_eq!(
            std::fs::read_dir(reopened.directory.join("media"))
                .unwrap()
                .count(),
            1
        );
        assert_eq!(
            crate::library::search(&reopened.library.items, "deadline explodes", "all").unwrap()[0]
                .id,
            saved.id
        );

        let failed_copy = CopyOutcome::after_copy(repeated, Err("Clipboard is occupied.".into()));
        assert!(!failed_copy.copied);
        assert!(failed_copy.message.contains("Saved to Your memes"));
        assert!(failed_copy
            .message
            .contains("clipboard could not be updated"));
        assert!(reopened.media_path(&failed_copy.item.id).is_ok());
    }

    #[test]
    fn autosave_rolls_back_new_media_if_metadata_commit_fails() {
        let root = tempfile::tempdir().unwrap();
        let mut store = store(root.path());
        let ready = prepare(&png_url(), &template(), &["Keep my draft".into()]).unwrap();
        // A directory at the metadata destination reliably prevents atomic rename.
        std::fs::remove_file(store.directory.join("library.json")).unwrap();
        std::fs::create_dir(store.directory.join("library.json")).unwrap();
        assert!(store
            .save_generated_png(&ready.bytes, ready.title, ready.description, ready.tags)
            .is_err());
        assert!(store.library.items.is_empty());
        assert_eq!(
            std::fs::read_dir(store.directory.join("media"))
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn captions_are_bounded_and_untrusted_template_sources_are_rejected() {
        let url = png_url();
        assert!(prepare(&url, &template(), &vec![String::new(); 7]).is_err());
        assert!(prepare(&url, &template(), &["x".repeat(401)]).is_err());
        assert!(prepare(&url, &template(), &["hidden\0caption".into()]).is_err());
        let maximal = prepare(&url, &template(), &vec!["x".repeat(400); 6]).unwrap();
        assert!(maximal.description.chars().count() <= 2000);
        assert!(maximal.description.ends_with(&template().source_url));
        let mut untrusted = template();
        untrusted.source_url = "https://localhost/private".into();
        assert!(prepare(&url, &untrusted, &[]).is_err());
        untrusted = template();
        untrusted.provider = "klipy-memes".into();
        assert!(prepare(&url, &untrusted, &[]).is_err());
    }

    #[test]
    fn content_address_does_not_overwrite_a_changed_existing_file() {
        let root = tempfile::tempdir().unwrap();
        let mut store = store(root.path());
        let ready = prepare(&png_url(), &template(), &["Original caption".into()]).unwrap();
        let saved = store
            .save_generated_png(
                &ready.bytes,
                ready.title.clone(),
                ready.description.clone(),
                ready.tags.clone(),
            )
            .unwrap();
        let path = store.media_path(&saved.id).unwrap();
        std::fs::write(&path, b"externally changed bytes").unwrap();
        assert!(store
            .save_generated_png(&ready.bytes, ready.title, ready.description, ready.tags)
            .is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"externally changed bytes");
        assert_eq!(store.library.items.len(), 1);
    }

    #[test]
    fn canvas_png_decodes_without_changing_pixels() {
        let original = image::RgbaImage::from_pixel(3, 2, image::Rgba([10, 20, 30, 255]));
        let mut png = Cursor::new(Vec::new());
        original.write_to(&mut png, ImageFormat::Png).unwrap();
        let (_, decoded) =
            decode(&format!("{PREFIX}{}", STANDARD.encode(png.into_inner()))).unwrap();
        assert_eq!(decoded.to_rgba8(), original);
    }
    #[test]
    fn canvas_rejects_wrong_types_bad_base64_animation_and_oversized_payloads() {
        for url in [
            "file:///etc/passwd",
            "data:image/svg+xml;base64,PHN2Zz4=",
            "data:image/png;base64,not valid!",
            "data:image/png;base64,YmFk",
        ] {
            assert!(decode(url).is_err());
        }
        let animated = format!(
            "{PREFIX}{}",
            STANDARD.encode(include_bytes!("../tests/fixtures/animated.png"))
        );
        assert!(decode(&animated).unwrap_err().contains("static PNG"));
        let oversized = format!(
            "{PREFIX}{}",
            "A".repeat((MAX_FILE_BYTES.div_ceil(3) * 4 + 4) as usize)
        );
        assert!(decode(&oversized).unwrap_err().contains("20 MB"));
    }
    #[test]
    fn canvas_rejects_excessive_pixel_dimensions_before_decoding() {
        let huge = image::RgbaImage::new(8193, 1);
        let mut png = Cursor::new(Vec::new());
        huge.write_to(&mut png, ImageFormat::Png).unwrap();
        let url = format!("{PREFIX}{}", STANDARD.encode(png.into_inner()));
        assert!(decode(&url).unwrap_err().contains("8,192"));
    }
}
