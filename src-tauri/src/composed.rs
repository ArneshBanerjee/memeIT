use crate::library::{Result, MAX_FILE_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat, ImageReader};
use std::io::Cursor;

const PREFIX: &str = "data:image/png;base64,";

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
