use image::{ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PIXELS: u64 = 16_000_000;
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+M";
pub type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemeItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub filename: String,
    pub kind: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub last_used: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Library {
    pub version: u32,
    pub items: Vec<MemeItem>,
    #[serde(default = "default_shortcut")]
    pub shortcut: String,
}

fn default_shortcut() -> String {
    DEFAULT_SHORTCUT.into()
}

pub struct LibraryStore {
    pub library: Library,
    pub directory: PathBuf,
}

pub fn valid_filename(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 180
        && !value.contains(['/', '\\', ':', '\0'])
        && Path::new(value).components().count() == 1
        && matches!(
            Path::new(value).components().next(),
            Some(Component::Normal(_))
        )
}

pub fn inspect_media(path: &Path) -> Result<String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("Cannot read media: {e}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Choose a regular image file, not a folder or symbolic link.".into());
    }
    if metadata.len() == 0 || metadata.len() > MAX_FILE_BYTES {
        return Err("Images must be nonempty and no larger than 20 MB.".into());
    }
    let reader = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let format = reader
        .format()
        .ok_or("The file is not a recognized image.")?;
    let kind = match format {
        ImageFormat::Png => "png",
        ImageFormat::Gif => "gif",
        ImageFormat::Jpeg => "jpeg",
        ImageFormat::WebP => "webp",
        _ => return Err("Supported formats: PNG, GIF, JPEG, WebP.".into()),
    };
    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| format!("Invalid image: {e}"))?;
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(
            "Image dimensions exceed the limit (8,192 pixels per side, 16 megapixels total)."
                .into(),
        );
    }
    let mut reader = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|e| format!("The image could not be decoded: {e}"))?;
    Ok(kind.into())
}

impl LibraryStore {
    pub fn load(directory: PathBuf, assets: &Path) -> Result<Self> {
        fs::create_dir_all(directory.join("media")).map_err(|e| e.to_string())?;
        let path = directory.join("library.json");
        let library = if path.exists() {
            serde_json::from_slice::<Library>(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| {
                    format!("Your library could not be read. It has not been overwritten: {e}")
                })?
        } else {
            Library {
                version: 1,
                items: Vec::new(),
                shortcut: default_shortcut(),
            }
        };
        if library.version != 1 {
            return Err("This library was written by a newer version of MemeIT.".into());
        }
        if library
            .items
            .iter()
            .any(|item| !valid_filename(&item.filename))
        {
            return Err("Library contains an invalid media filename.".into());
        }
        let mut store = Self { library, directory };
        let catalog = fs::read(assets.join("catalog.json"))
            .map_err(|e| format!("Bundled meme pack is missing: {e}"))?;
        let builtins: Vec<MemeItem> = serde_json::from_slice(&catalog)
            .map_err(|e| format!("Invalid bundled catalog: {e}"))?;
        for mut item in builtins {
            if store
                .library
                .items
                .iter()
                .any(|existing| existing.id == item.id)
            {
                continue;
            }
            if !valid_filename(&item.filename) || !valid_filename(&item.id) {
                return Err("Invalid bundled meme filename or ID.".into());
            }
            let source = assets.join(&item.filename);
            item.kind = inspect_media(&source)?;
            fs::copy(source, store.directory.join("media").join(&item.filename))
                .map_err(|e| e.to_string())?;
            store.library.items.push(item);
        }
        store.persist(&store.library)?;
        Ok(store)
    }

    pub fn persist(&self, library: &Library) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(library).map_err(|e| e.to_string())?;
        let mut temp =
            tempfile::NamedTempFile::new_in(&self.directory).map_err(|e| e.to_string())?;
        temp.write_all(&bytes).map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(self.directory.join("library.json"))
            .map_err(|e| format!("Could not save library: {e}"))?;
        Ok(())
    }

    pub fn mutate<T>(&mut self, update: impl FnOnce(&mut Library) -> Result<T>) -> Result<T> {
        let mut next = self.library.clone();
        let value = update(&mut next)?;
        self.persist(&next)?;
        self.library = next;
        Ok(value)
    }

    pub fn item(&self, id: &str) -> Result<&MemeItem> {
        self.library
            .items
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(|| "Meme not found.".into())
    }

    pub fn media_path(&self, id: &str) -> Result<PathBuf> {
        let item = self.item(id)?;
        if !valid_filename(&item.filename) {
            return Err("Invalid media filename.".into());
        }
        let root = self
            .directory
            .join("media")
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let path = root.join(&item.filename);
        let metadata =
            fs::symlink_metadata(&path).map_err(|e| format!("Media file is missing: {e}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Invalid media file.".into());
        }
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        if canonical.parent() != Some(root.as_path()) {
            return Err("Media must belong to this library.".into());
        }
        Ok(canonical)
    }

    pub fn import(&mut self, paths: Vec<PathBuf>) -> Result<Vec<MemeItem>> {
        if paths.len() > 50 {
            return Err("Import up to 50 images at a time.".into());
        }
        // Validate the complete selection before copying any files.
        let validated: Vec<_> = paths
            .iter()
            .map(|path| inspect_media(path).map(|kind| (path, kind)))
            .collect::<Result<_>>()?;
        let mut added = Vec::new();
        for (source, kind) in validated {
            let id = uuid::Uuid::new_v4().to_string();
            let filename = format!("{id}.{kind}");
            let destination = self.directory.join("media").join(&filename);
            if let Err(error) = fs::copy(source, &destination) {
                for item in &added {
                    let item: &MemeItem = item;
                    let _ = fs::remove_file(self.directory.join("media").join(&item.filename));
                }
                return Err(format!("Could not import image: {error}"));
            }
            let title = source
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("My meme")
                .chars()
                .take(160)
                .collect();
            added.push(MemeItem {
                id,
                title,
                description: String::new(),
                tags: Vec::new(),
                filename,
                kind,
                favorite: false,
                last_used: None,
            });
        }
        if let Err(error) = self.mutate(|library| {
            library.items.extend(added.clone());
            Ok(())
        }) {
            for item in &added {
                let _ = fs::remove_file(self.directory.join("media").join(&item.filename));
            }
            return Err(error);
        }
        Ok(added)
    }
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn tokenize(text: &str) -> Vec<String> {
    let stop = [
        "a",
        "an",
        "the",
        "i",
        "im",
        "i'm",
        "me",
        "my",
        "of",
        "to",
        "in",
        "is",
        "it",
        "and",
        "for",
        "that",
        "this",
        "when",
        "with",
        "someone",
        "something",
        "meme",
        "gif",
        "image",
        "show",
        "find",
        "feeling",
        "like",
        "being",
        "but",
        "so",
        "at",
        "be",
        "you",
        "your",
    ];
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty() && !stop.contains(word))
        .map(str::to_owned)
        .collect()
}

fn concept(word: &str) -> &str {
    match word {
        "happy" | "happiness" | "joy" | "excited" | "excitement" | "celebrate" | "celebrating"
        | "celebration" | "party" | "win" | "winning" | "victory" | "success" | "yay" => {
            "celebration"
        }
        "sad" | "sadness" | "cry" | "crying" | "tears" | "heartbroken" | "disappointed"
        | "disappointment" | "depressed" => "sadness",
        "angry" | "anger" | "rage" | "furious" | "annoyed" | "annoying" | "frustrated"
        | "frustration" | "mad" => "anger",
        "confused" | "confusion" | "huh" | "what" | "understand" | "understanding" | "puzzled"
        | "math" | "calculating" => "confusion",
        "shocked" | "shock" | "surprised" | "surprise" | "unbelievable" | "speechless" | "wow"
        | "astonished" => "surprise",
        "awkward" | "awkwardness" | "embarrassed" | "embarrassing" | "cringe" | "nervous"
        | "uncomfortable" => "awkward",
        "tired" | "exhausted" | "sleepy" | "sleep" | "sleeping" | "burnout" | "drained"
        | "yawn" => "tired",
        "laugh" | "laughing" | "laughter" | "funny" | "hilarious" | "lol" | "lmao" | "rofl" => {
            "laughter"
        }
        "agree" | "agreed" | "yes" | "exactly" | "approval" | "approve" | "nod" | "nodding" => {
            "approval"
        }
        "no" | "nope" | "disagree" | "refuse" | "rejection" | "reject" => "rejection",
        "wait" | "waiting" | "patience" | "patient" | "loading" | "buffering" => "waiting",
        "panic" | "panicking" | "stressed" | "stress" | "anxiety" | "anxious" | "chaos"
        | "chaotic" | "overwhelmed" | "disaster" => "panic",
        "suspicious" | "sus" | "doubt" | "doubtful" | "skeptical" | "skepticism" | "distrust" => {
            "suspicious"
        }
        "love" | "loving" | "heart" | "adorable" | "cute" | "affection" | "wholesome" => "love",
        "work" | "office" | "meeting" | "meetings" | "boss" | "job" | "deadline" | "coworker"
        | "colleague" => "work",
        "code" | "coding" | "programming" | "developer" | "bug" | "debugging" | "deploy"
        | "deployment" => "coding",
        other => other,
    }
}

pub fn search(items: &[MemeItem], query: &str, filter: &str) -> Result<Vec<MemeItem>> {
    if !["all", "favorites", "recent", "gif", "image"].contains(&filter) {
        return Err("Unknown search filter.".into());
    }
    if query.len() > 2000 {
        return Err("Search descriptions must be shorter than 2,000 characters.".into());
    }
    let words = tokenize(query);
    let concepts: HashSet<_> = words.iter().map(|word| concept(word).to_string()).collect();
    let phrase = query.trim().to_lowercase();
    let mut ranked: Vec<(i64, &MemeItem)> = items
        .iter()
        .filter(|item| match filter {
            "favorites" => item.favorite,
            "recent" => item.last_used.is_some(),
            "gif" => item.kind == "gif",
            "image" => item.kind != "gif",
            _ => true,
        })
        .filter_map(|item| {
            if words.is_empty() {
                return Some((0, item));
            }
            let title = item.title.to_lowercase();
            let tags = item.tags.join(" ").to_lowercase();
            let body = format!("{title} {tags} {}", item.description.to_lowercase());
            let title_tokens = tokenize(&title);
            let tag_tokens = tokenize(&tags);
            let body_tokens = tokenize(&body);
            let body_concepts: HashSet<_> = body_tokens.iter().map(|word| concept(word)).collect();
            let mut score = if !phrase.is_empty() && title.contains(&phrase) {
                20
            } else {
                0
            };
            for word in &words {
                if title_tokens.contains(word) {
                    score += 7;
                } else if tag_tokens.contains(word) {
                    score += 6;
                } else if body_tokens.contains(word) {
                    score += 3;
                } else if word.len() >= 4 && body_tokens.iter().any(|token| token.starts_with(word))
                {
                    score += 1;
                }
            }
            for term in &concepts {
                if body_concepts.contains(term.as_str()) {
                    score += 4;
                }
            }
            if score == 0 {
                None
            } else {
                Some((score, item))
            }
        })
        .collect();
    ranked.sort_by(|(sa, a), (sb, b)| {
        sb.cmp(sa)
            .then_with(|| {
                if filter == "recent" {
                    b.last_used.cmp(&a.last_used)
                } else {
                    b.favorite.cmp(&a.favorite)
                }
            })
            .then_with(|| a.title.cmp(&b.title))
    });
    Ok(ranked.into_iter().map(|(_, item)| item.clone()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn meme(title: &str, description: &str, tags: &[&str]) -> MemeItem {
        MemeItem {
            id: title.into(),
            title: title.into(),
            description: description.into(),
            tags: tags.iter().map(|tag| (*tag).into()).collect(),
            filename: "test.png".into(),
            kind: "png".into(),
            favorite: false,
            last_used: None,
        }
    }
    #[test]
    fn descriptions_match_emotion_synonyms_and_rank_relevant_results() {
        let items = vec![
            meme("Tiny celebration", "A dance after a victory", &["happy"]),
            meme(
                "System overload",
                "Too much work at once",
                &["panic", "overwhelmed"],
            ),
            meme("Loading", "Thinking very slowly", &["confused"]),
        ];
        assert_eq!(
            search(&items, "when I'm stressed at my job", "all").unwrap()[0].title,
            "System overload"
        );
        assert_eq!(
            search(&items, "feeling excited about success", "all").unwrap()[0].title,
            "Tiny celebration"
        );
        assert!(search(&items, "penguin astronaut", "all")
            .unwrap()
            .is_empty());
    }
    #[test]
    fn filters_do_not_leak_other_results_and_recent_is_ordered() {
        let mut a = meme("A", "", &[]);
        a.favorite = true;
        a.last_used = Some(10);
        let mut b = meme("B", "", &[]);
        b.last_used = Some(20);
        b.kind = "gif".into();
        let items = vec![a, b, meme("C", "", &[])];
        assert_eq!(search(&items, "", "favorites").unwrap().len(), 1);
        assert_eq!(search(&items, "", "gif").unwrap()[0].title, "B");
        assert_eq!(
            search(&items, "", "recent")
                .unwrap()
                .iter()
                .map(|i| i.title.as_str())
                .collect::<Vec<_>>(),
            vec!["B", "A"]
        );
        assert!(search(&items, "", "unknown").is_err());
    }
    #[test]
    fn filenames_cannot_escape_the_media_directory() {
        for invalid in [
            "",
            "..",
            ".",
            "../secret",
            "/etc/passwd",
            "C:\\secret",
            "folder/file.png",
            "folder\\file.png",
            "a\0.png",
        ] {
            assert!(!valid_filename(invalid), "{invalid:?}");
        }
        assert!(valid_filename("a-valid-meme.png"));
    }
    #[test]
    fn import_rejects_oversized_and_fake_images() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake.png");
        fs::write(&fake, b"not an image").unwrap();
        assert!(inspect_media(&fake).is_err());
        let huge = dir.path().join("huge.png");
        let file = fs::File::create(&huge).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        assert!(inspect_media(&huge).unwrap_err().contains("20 MB"));
    }
    #[test]
    fn media_type_comes_from_bytes_and_failed_batch_does_not_mutate_library() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("media")).unwrap();
        let image_path = dir.path().join("pretends.gif");
        image::RgbaImage::new(2, 2)
            .save_with_format(&image_path, ImageFormat::Png)
            .unwrap();
        assert_eq!(inspect_media(&image_path).unwrap(), "png");
        let fake = dir.path().join("bad.png");
        fs::write(&fake, "bad").unwrap();
        let mut store = LibraryStore {
            directory: dir.path().into(),
            library: Library {
                version: 1,
                items: vec![],
                shortcut: default_shortcut(),
            },
        };
        assert!(store.import(vec![image_path.clone(), fake]).is_err());
        assert!(store.library.items.is_empty());
        assert_eq!(fs::read_dir(dir.path().join("media")).unwrap().count(), 0);
        let imported = store.import(vec![image_path]).unwrap();
        assert_eq!(imported[0].kind, "png");
        assert!(store.media_path(&imported[0].id).unwrap().exists());
        let saved: Library =
            serde_json::from_slice(&fs::read(dir.path().join("library.json")).unwrap()).unwrap();
        assert_eq!(saved.items.len(), 1);
    }
}
