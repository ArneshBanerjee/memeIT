//! Internet providers. URLs originate in validated provider responses, never IPC arguments.
use crate::library::{self, MemeItem, Result, MAX_FILE_BYTES};
use reqwest::{
    blocking::{Client, Response},
    redirect::Policy,
    Url,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};

const API_LIMIT: u64 = 8 * 1024 * 1024;
const CATALOG_TTL: u64 = 6 * 60 * 60;
const PARTIAL_CATALOG_TTL: u64 = 60;
const PAGE_SIZE: usize = 48;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineItem {
    pub id: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub kind: String,
    pub preview_url: String,
    pub media_url: String,
    pub source_url: String,
    pub provider: String,
    pub is_template: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub items: Vec<OnlineItem>,
    pub next_page: Option<u32>,
    pub notice: String,
    pub configured: bool,
}

#[derive(Serialize)]
pub struct ProviderConfig {
    pub imgflip: bool,
    pub klipy: bool,
    pub storage: &'static str,
}

#[derive(Default)]
struct Keys {
    imgflip: String,
    klipy: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Catalog {
    fetched_at: u64,
    items: Vec<OnlineItem>,
    #[serde(default)]
    warning: String,
    #[serde(default)]
    partial: bool,
}

impl Catalog {
    fn is_fresh(&self, now: u64) -> bool {
        let ttl = if self.partial {
            PARTIAL_CATALOG_TTL
        } else {
            CATALOG_TTL
        };
        self.fetched_at <= now && now - self.fetched_at < ttl
    }
}

/// Refresh each provider independently. An outage must not erase that provider's
/// last successful catalog or make a partial result appear fresh for six hours.
fn merge_catalogs(
    previous: Option<&Catalog>,
    imgflip: Result<Vec<OnlineItem>>,
    memegen: Result<Vec<OnlineItem>>,
    fetched_at: u64,
) -> Result<Catalog> {
    let mut items = Vec::new();
    let mut warnings = Vec::new();
    for (provider, label, response) in [
        ("imgflip", "Imgflip", imgflip),
        ("memegen", "Memegen", memegen),
    ] {
        match response {
            Ok(fresh) => items.extend(fresh),
            Err(error) => {
                let fallback: Vec<_> = previous
                    .into_iter()
                    .flat_map(|catalog| catalog.items.iter())
                    .filter(|item| item.provider == provider)
                    .cloned()
                    .collect();
                warnings.push(if fallback.is_empty() {
                    format!("{error} {label} formats are temporarily unavailable.")
                } else {
                    format!("{error} Showing previously cached {label} formats.")
                });
                items.extend(fallback);
            }
        }
    }
    if items.is_empty() {
        return Err(if warnings.is_empty() {
            "The providers returned an empty catalog. Try again shortly.".into()
        } else {
            warnings.join(" ")
        });
    }
    Ok(Catalog {
        fetched_at,
        items,
        partial: !warnings.is_empty(),
        warning: warnings.join(" "),
    })
}

#[derive(Deserialize)]
struct Annotation {
    source: String,
    id: String,
    description: String,
    tags: Vec<String>,
}

pub struct OnlineState {
    client: Result<Client>,
    directory: PathBuf,
    keys: Mutex<Keys>,
    results: Mutex<HashMap<String, OnlineItem>>,
    catalog: Mutex<Option<Catalog>>,
    annotations: HashMap<(String, String), Annotation>,
    refresh: Mutex<()>,
    customer_id: String,
}

fn media_host(provider: &str, host: &str) -> bool {
    match provider {
        "imgflip" => host == "i.imgflip.com",
        "memegen" => host == "api.memegen.link",
        "klipy-gifs" | "klipy-memes" => {
            ["static.klipy.com", "static1.klipy.com", "static2.klipy.com"].contains(&host)
        }
        _ => false,
    }
}

fn checked_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| "Provider returned an invalid URL.")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
    {
        return Err("Provider returned a URL that is not a standard HTTPS address.".into());
    }
    Ok(url)
}

fn checked_media(raw: &str, provider: &str) -> Result<Url> {
    let url = checked_url(raw)?;
    if !url
        .host_str()
        .is_some_and(|host| media_host(provider, host))
    {
        return Err("Provider returned an unsupported media host. Please update MemeIT.".into());
    }
    Ok(url)
}

pub fn checked_source(raw: &str) -> Result<Url> {
    let url = checked_url(raw)?;
    let host = url.host_str().ok_or("Invalid source URL.")?;
    if ![
        "imgflip.com",
        "i.imgflip.com",
        "memegen.link",
        "api.memegen.link",
        "knowyourmeme.com",
        "klipy.com",
        "static.klipy.com",
        "static1.klipy.com",
        "static2.klipy.com",
    ]
    .contains(&host)
    {
        return Err("This source page is not supported by MemeIT.".into());
    }
    Ok(url)
}

fn text(value: &Value, key: &str, fallback: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .chars()
        .take(2000)
        .collect()
}

fn id_string(value: &Value) -> Result<String> {
    let id = match value {
        Value::String(id) => id.clone(),
        Value::Number(id) => id.to_string(),
        _ => return Err("Provider returned an invalid media ID.".into()),
    };
    if id.is_empty()
        || id.len() > 180
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ['-', '_'].contains(&c))
    {
        return Err("Provider returned an invalid media ID.".into());
    }
    Ok(id)
}

fn kind_from_url(url: &str) -> String {
    let path = Url::parse(url)
        .map(|url| url.path().to_lowercase())
        .unwrap_or_default();
    if path.ends_with(".gif") {
        "gif"
    } else if path.ends_with(".png") {
        "png"
    } else if path.ends_with(".webp") {
        "webp"
    } else {
        "jpeg"
    }
    .into()
}

fn bounded_body(mut response: Response, limit: u64) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err("Provider response exceeds the size limit.".into());
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The download was interrupted. Try again.")?;
    if bytes.len() as u64 > limit {
        return Err("Provider response exceeds the size limit.".into());
    }
    Ok(bytes)
}

fn response_json(
    response: std::result::Result<Response, reqwest::Error>,
    provider: &str,
) -> Result<Value> {
    // reqwest errors can contain the URL, which embeds KLIPY's key. Never return them.
    let response = response.map_err(|_| {
        format!("{provider} could not be reached. Check your connection and try again.")
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "{provider} returned HTTP {}. Check your API key, plan, or rate limit and try again.",
            response.status().as_u16()
        ));
    }
    let bytes = bounded_body(response, API_LIMIT)?;
    serde_json::from_slice(&bytes)
        .map_err(|_| format!("{provider} returned an unexpected response."))
}

pub fn parse_imgflip(value: &Value) -> Result<Vec<OnlineItem>> {
    if value.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(
            "Imgflip declined this request. Full-database search requires a valid API Premium key."
                .into(),
        );
    }
    let memes = value
        .pointer("/data/memes")
        .and_then(Value::as_array)
        .ok_or("Imgflip returned an unexpected response.")?;
    if memes.len() > 5000 {
        return Err("Imgflip returned too many results.".into());
    }
    memes.iter().map(|meme| {
        let id = id_string(meme.get("id").ok_or("Missing Imgflip ID.")?)?;
        let media = text(meme, "url", ""); checked_media(&media, "imgflip")?;
        let name = text(meme, "name", "Untitled meme");
        Ok(OnlineItem { id: format!("imgflip:{id}"), title: name.clone(), description: format!("{name} — a popular internet meme format from Imgflip. This is a template, not a captioned post."), tags: vec![], kind: kind_from_url(&media), preview_url: media.clone(), media_url: media, source_url: format!("https://imgflip.com/memetemplate/{id}"), provider: "imgflip".into(), is_template: true })
    }).collect()
}

pub fn parse_memegen(value: &Value) -> Result<Vec<OnlineItem>> {
    let memes = value
        .as_array()
        .ok_or("Memegen returned an unexpected response.")?;
    if memes.len() > 5000 {
        return Err("Memegen returned too many results.".into());
    }
    memes.iter().map(|meme| {
        let id = id_string(meme.get("id").ok_or("Missing Memegen ID.")?)?;
        let media = text(meme, "blank", ""); checked_media(&media, "memegen")?;
        let name = text(meme, "name", "Untitled meme");
        let source = text(meme, "source", "https://memegen.link/");
        let source = if checked_source(&source).is_ok() { source } else { "https://memegen.link/".into() };
        let tags = meme.get("keywords").and_then(Value::as_array).map(|tags| tags.iter().filter_map(Value::as_str).take(50).map(str::to_owned).collect()).unwrap_or_default();
        Ok(OnlineItem { id: format!("memegen:{id}"), title: name.clone(), description: format!("{name} — a classic internet meme format from Memegen. This is a template, not a captioned post."), tags, kind: kind_from_url(&media), preview_url: media.clone(), media_url: media, source_url: source, provider: "memegen".into(), is_template: true })
    }).collect()
}

fn klipy_format(value: &Value, sizes: &[&str], formats: &[&str]) -> Option<String> {
    for size in sizes {
        for format in formats {
            if let Some(url) = value
                .get("file")
                .and_then(|file| file.get(*size))
                .and_then(|size| size.get(*format))
                .and_then(|format| format.get("url"))
                .and_then(Value::as_str)
            {
                return Some(url.to_string());
            }
        }
    }
    None
}

pub fn parse_klipy(value: &Value, provider: &str) -> Result<(Vec<OnlineItem>, bool)> {
    if value.get("result").and_then(Value::as_bool) != Some(true) {
        return Err("KLIPY declined this request. Check your app key and approved integration configuration.".into());
    }
    let values = value
        .pointer("/data/data")
        .and_then(Value::as_array)
        .ok_or("KLIPY returned an unexpected response.")?;
    if values.len() > 100 {
        return Err("KLIPY returned too many results.".into());
    }
    let formats: &[&str] = if provider == "klipy-gifs" {
        &["gif"]
    } else {
        &["png", "jpg", "jpeg", "webp"]
    };
    // Preserve the complete response and order. Unsupported entries fail visibly,
    // rather than silently filtering the provider's result composition.
    let items = values
        .iter()
        .map(|item| {
            let id = id_string(item.get("id").ok_or("Missing KLIPY ID.")?)?;
            let media = klipy_format(item, &["hd", "md", "sm", "xs"], formats)
                .ok_or("KLIPY returned an unsupported content format. Please update MemeIT.")?;
            let preview = klipy_format(item, &["sm", "md", "xs", "hd"], formats)
                .unwrap_or_else(|| media.clone());
            checked_media(&media, provider)?;
            checked_media(&preview, provider)?;
            let title = text(item, "title", "KLIPY reaction");
            let mut description = text(item, "description", &title);
            let creator = item
                .get("username")
                .or_else(|| item.pointer("/user/username"))
                .or_else(|| item.pointer("/creator/username"))
                .and_then(Value::as_str);
            if let Some(creator) = creator {
                description.push_str(&format!(
                    " · Creator: {}",
                    creator.chars().take(120).collect::<String>()
                ));
            }
            let tags = item
                .get("tags")
                .and_then(Value::as_array)
                .map(|tags| {
                    tags.iter()
                        .filter_map(Value::as_str)
                        .take(50)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            let source = item
                .get("url")
                .and_then(Value::as_str)
                .filter(|url| checked_source(url).is_ok())
                .unwrap_or(&media)
                .to_owned();
            Ok(OnlineItem {
                id: format!("{provider}:{id}"),
                title: title.clone(),
                description,
                tags,
                kind: kind_from_url(&media),
                preview_url: preview,
                media_url: media,
                source_url: source,
                provider: provider.into(),
                is_template: false,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok((
        items,
        value
            .pointer("/data/has_next")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    ))
}

impl OnlineState {
    pub fn new(directory: PathBuf) -> Self {
        let client = Client::builder()
            .https_only(true)
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(8))
            .redirect(Policy::none())
            .user_agent("MemeIT/0.1.0")
            .build()
            .map_err(|_| "The internet connection could not be initialized.".into());
        let catalog = fs::read(directory.join("internet-catalog.json"))
            .ok()
            .filter(|bytes| bytes.len() as u64 <= API_LIMIT)
            .and_then(|bytes| serde_json::from_slice::<Catalog>(&bytes).ok())
            .filter(|catalog| {
                catalog.items.len() <= 10000
                    && catalog.items.iter().all(|item| {
                        ["imgflip", "memegen"].contains(&item.provider.as_str())
                            && checked_media(&item.media_url, &item.provider).is_ok()
                            && checked_media(&item.preview_url, &item.provider).is_ok()
                    })
            });
        let annotations: Vec<Annotation> =
            serde_json::from_str(include_str!("../../assets/internet-metadata.json"))
                .unwrap_or_default();
        let annotations = annotations
            .into_iter()
            .map(|item| ((item.source.clone(), item.id.clone()), item))
            .collect();
        let customer_path = directory.join("provider-client-id");
        let customer_id = fs::read_to_string(&customer_path)
            .ok()
            .filter(|id| uuid::Uuid::parse_str(id.trim()).is_ok())
            .unwrap_or_else(|| {
                let id = uuid::Uuid::new_v4().to_string();
                let _ = fs::create_dir_all(&directory);
                let _ = fs::write(customer_path, &id);
                id
            });
        Self {
            client,
            directory,
            keys: Mutex::new(Keys {
                imgflip: String::new(),
                klipy: option_env!("MEMEIT_PUBLIC_KLIPY_APP_KEY")
                    .unwrap_or("")
                    .into(),
            }),
            results: Mutex::new(HashMap::new()),
            catalog: Mutex::new(catalog),
            annotations,
            refresh: Mutex::new(()),
            customer_id,
        }
    }

    fn client(&self) -> Result<&Client> {
        self.client.as_ref().map_err(Clone::clone)
    }

    pub fn config(&self) -> Result<ProviderConfig> {
        let keys = self
            .keys
            .lock()
            .map_err(|_| "Provider settings are unavailable.")?;
        Ok(ProviderConfig {
            imgflip: !keys.imgflip.is_empty(),
            klipy: !keys.klipy.is_empty(),
            storage: "session",
        })
    }

    pub fn set_key(&self, provider: &str, key: String) -> Result<ProviderConfig> {
        let key = key.trim().to_string();
        if key.len() > 512
            || !key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || ['-', '_', '.'].contains(&c))
        {
            return Err("The API key contains invalid characters.".into());
        }
        let mut keys = self
            .keys
            .lock()
            .map_err(|_| "Provider settings are unavailable.")?;
        match provider {
            "imgflip" => keys.imgflip = key,
            "klipy" => keys.klipy = key,
            _ => return Err("Unknown provider.".into()),
        }
        drop(keys);
        self.config()
    }

    fn annotate(&self, item: &mut OnlineItem) {
        if let Some((_, id)) = item.id.split_once(':') {
            if let Some(annotation) = self
                .annotations
                .get(&(item.provider.clone(), id.to_string()))
            {
                item.description = annotation.description.clone();
                item.tags.extend(annotation.tags.clone());
                item.tags.sort();
                item.tags.dedup();
            }
        }
    }

    fn popular_catalog(&self) -> Result<(Vec<OnlineItem>, String)> {
        let _refresh = self
            .refresh
            .lock()
            .map_err(|_| "Catalog refresh is unavailable.")?;
        let cached = self
            .catalog
            .lock()
            .map_err(|_| "Catalog is unavailable.")?
            .clone();
        if let Some(catalog) = &cached {
            if catalog.is_fresh(library::now()) {
                return Ok((catalog.items.clone(), catalog.warning.clone()));
            }
        }
        let client = self.client()?;
        let (imgflip, memegen) = std::thread::scope(|scope| {
            let a = scope.spawn(|| {
                response_json(
                    client.get("https://api.imgflip.com/get_memes").send(),
                    "Imgflip",
                )
                .and_then(|value| parse_imgflip(&value))
            });
            let b = scope.spawn(|| {
                response_json(
                    client.get("https://api.memegen.link/templates").send(),
                    "Memegen",
                )
                .and_then(|value| parse_memegen(&value))
            });
            (
                a.join()
                    .unwrap_or_else(|_| Err("Imgflip request failed.".into())),
                b.join()
                    .unwrap_or_else(|_| Err("Memegen request failed.".into())),
            )
        });
        let mut catalog = merge_catalogs(cached.as_ref(), imgflip, memegen, library::now())?;
        // Observed public Imgflip classic missing from the changing top-100 list.
        if !catalog
            .items
            .iter()
            .any(|item| item.id == "imgflip:80996545")
        {
            catalog.items.push(OnlineItem { id: "imgflip:80996545".into(), title: "Math Lady / Confused Lady".into(), description: "A confused woman works through equations. Trying to understand something complicated.".into(), tags: vec!["confused".into(), "math".into()], kind: "jpeg".into(), preview_url: "https://i.imgflip.com/1c81c1.jpg".into(), media_url: "https://i.imgflip.com/1c81c1.jpg".into(), source_url: "https://imgflip.com/memetemplate/80996545/Math-ladyConfused-lady".into(), provider: "imgflip".into(), is_template: true });
        }
        if let Ok(bytes) = serde_json::to_vec(&catalog) {
            if let Ok(mut file) = tempfile::NamedTempFile::new_in(&self.directory) {
                if file.write_all(&bytes).is_ok() {
                    let _ = file.persist(self.directory.join("internet-catalog.json"));
                }
            }
        }
        let response = (catalog.items.clone(), catalog.warning.clone());
        *self.catalog.lock().map_err(|_| "Catalog is unavailable.")? = Some(catalog);
        Ok(response)
    }

    fn remember(&self, items: &[OnlineItem]) -> Result<()> {
        let mut results = self
            .results
            .lock()
            .map_err(|_| "Search results are unavailable.")?;
        if results.len() + items.len() > 5000 {
            results.clear();
        }
        results.extend(items.iter().cloned().map(|item| (item.id.clone(), item)));
        Ok(())
    }

    pub fn item(&self, id: &str) -> Result<OnlineItem> {
        self.results
            .lock()
            .map_err(|_| "Search results are unavailable.")?
            .get(id)
            .cloned()
            .ok_or_else(|| "This result has expired. Search again to load it.".into())
    }

    pub fn search(&self, query: &str, provider: &str, page: u32) -> Result<SearchResponse> {
        if query.chars().count() > 300 || page == 0 || page > 1000 {
            return Err("Use a search of up to 300 characters and a valid page.".into());
        }
        match provider {
            "popular" => {
                let (mut items, warning) = self.popular_catalog()?;
                for item in &mut items {
                    self.annotate(item);
                }
                let count = items.len();
                if !query.trim().is_empty() {
                    let library: Vec<_> = items
                        .iter()
                        .map(|item| MemeItem {
                            id: item.id.clone(),
                            title: item.title.clone(),
                            description: item.description.clone(),
                            tags: item.tags.clone(),
                            filename: String::new(),
                            kind: item.kind.clone(),
                            favorite: false,
                            last_used: None,
                        })
                        .collect();
                    let ranked = library::search(&library, query, "all")?;
                    let lookup: HashMap<_, _> = items
                        .into_iter()
                        .map(|item| (item.id.clone(), item))
                        .collect();
                    items = ranked
                        .into_iter()
                        .filter_map(|item| lookup.get(&item.id).cloned())
                        .collect();
                }
                let start = (page as usize - 1) * PAGE_SIZE;
                let next = (start + PAGE_SIZE < items.len()).then_some(page + 1);
                let items: Vec<_> = items.into_iter().skip(start).take(PAGE_SIZE).collect();
                self.remember(&items)?;
                Ok(SearchResponse { items, next_page: next, notice: format!("{count} real meme formats from public Imgflip and Memegen catalogs. These are templates, not all internet memes or captioned posts. {warning}").trim().into(), configured: true })
            }
            "imgflip" => {
                let key = self
                    .keys
                    .lock()
                    .map_err(|_| "Provider settings are unavailable.")?
                    .imgflip
                    .clone();
                if key.is_empty() {
                    return Ok(SearchResponse { items: vec![], next_page: None, notice: "Add your Imgflip API Premium key in Settings to search its full template database. Popular formats work without a key.".into(), configured: false });
                }
                if query.trim().is_empty() {
                    return Ok(SearchResponse { items: vec![], next_page: None, notice: "Describe a meme or enter its name to search Imgflip's full template database. Searches use your paid API quota.".into(), configured: true });
                }
                let value = response_json(
                    self.client()?
                        .post("https://api.imgflip.com/search_memes")
                        .bearer_auth(key)
                        .form(&[
                            ("query", query),
                            ("type", "gif,image"),
                            ("include_nsfw", "0"),
                        ])
                        .send(),
                    "Imgflip",
                )?;
                let mut items = parse_imgflip(&value)?;
                for item in &mut items {
                    self.annotate(item);
                }
                self.remember(&items)?;
                Ok(SearchResponse {
                    items,
                    next_page: None,
                    notice: "Imgflip API Premium · template search · provider order preserved."
                        .into(),
                    configured: true,
                })
            }
            "klipy-gifs" | "klipy-memes" => {
                let key = self
                    .keys
                    .lock()
                    .map_err(|_| "Provider settings are unavailable.")?
                    .klipy
                    .clone();
                if key.is_empty() {
                    return Ok(SearchResponse { items: vec![], next_page: None, notice: "Add a KLIPY app key in Settings to search GIFs and captioned memes. Keys are kept only for this app session.".into(), configured: false });
                }
                let category = if provider == "klipy-gifs" {
                    "gifs"
                } else {
                    "static-memes"
                };
                let operation = if query.trim().is_empty() {
                    "trending"
                } else {
                    "search"
                };
                let url = format!("https://api.klipy.com/api/v1/{key}/{category}/{operation}");
                let mut request = self.client()?.get(url).query(&[
                    ("page", page.to_string()),
                    ("per_page", "24".into()),
                    ("customer_id", self.customer_id.clone()),
                    ("content_filter", "high".into()),
                ]);
                if !query.trim().is_empty() {
                    request = request.query(&[("q", query)]);
                }
                if provider == "klipy-gifs" {
                    request = request.query(&[("format_filter", "gif")]);
                }
                let value = response_json(request.send(), "KLIPY")?;
                let (items, more) = parse_klipy(&value, provider)?;
                self.remember(&items)?;
                Ok(SearchResponse { items, next_page: more.then_some(page + 1), notice: "KLIPY · original provider order · Copy link preserves the provider's delivery URL. File downloads and offline saving need an approved KLIPY integration.".into(), configured: true })
            }
            _ => Err("Unknown internet provider.".into()),
        }
    }

    pub fn download(&self, item: &OnlineItem) -> Result<tempfile::NamedTempFile> {
        if item.provider.starts_with("klipy") {
            return Err("KLIPY media must use its original delivery URL. Use Copy link; file copying needs an approved provider integration.".into());
        }
        let mut url = checked_media(&item.media_url, &item.provider)?;
        for attempt in 0..4 {
            let response = self
                .client()?
                .get(url.clone())
                .send()
                .map_err(|_| "Media download failed. Check your connection and try again.")?;
            if response.status().is_redirection() {
                if attempt == 3 {
                    return Err("The media download redirected too many times.".into());
                }
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or("Invalid media redirect.")?;
                let redirected = url.join(location).map_err(|_| "Invalid media redirect.")?;
                url = checked_media(redirected.as_str(), &item.provider)?;
                continue;
            }
            if !response.status().is_success() {
                return Err(format!(
                    "Media download returned HTTP {}.",
                    response.status().as_u16()
                ));
            }
            let mime = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .split(';')
                .next()
                .unwrap_or("");
            if ![
                "image/png",
                "image/jpeg",
                "image/gif",
                "image/webp",
                "application/octet-stream",
            ]
            .contains(&mime)
            {
                return Err("The provider did not return a supported image.".into());
            }
            let bytes = bounded_body(response, MAX_FILE_BYTES)?;
            let mut file = tempfile::NamedTempFile::new()
                .map_err(|_| "Could not create temporary media file.")?;
            file.write_all(&bytes)
                .map_err(|_| "Could not save downloaded media.")?;
            library::inspect_media(file.path())?;
            return Ok(file);
        }
        Err("Media download failed.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample(provider: &str, id: &str) -> OnlineItem {
        OnlineItem {
            id: format!("{provider}:{id}"),
            title: id.into(),
            description: String::new(),
            tags: vec![],
            kind: "jpeg".into(),
            preview_url: String::new(),
            media_url: String::new(),
            source_url: String::new(),
            provider: provider.into(),
            is_template: true,
        }
    }

    #[test]
    fn partial_refresh_retains_failed_source_and_warning_across_cache_reads() {
        let previous = Catalog {
            fetched_at: 10,
            items: vec![sample("imgflip", "old"), sample("memegen", "classic")],
            partial: false,
            warning: String::new(),
        };
        let refreshed = merge_catalogs(
            Some(&previous),
            Ok(vec![sample("imgflip", "new")]),
            Err("Memegen connection failed.".into()),
            100,
        )
        .unwrap();
        assert_eq!(
            refreshed
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["imgflip:new", "memegen:classic"]
        );
        assert!(refreshed.partial);
        assert!(refreshed.warning.contains("cached Memegen"));
        let restored: Catalog =
            serde_json::from_slice(&serde_json::to_vec(&refreshed).unwrap()).unwrap();
        assert_eq!(restored.warning, refreshed.warning);
        assert!(restored.is_fresh(159));
        assert!(!restored.is_fresh(160));
        let recovered = merge_catalogs(
            Some(&restored),
            Ok(vec![sample("imgflip", "newer")]),
            Ok(vec![sample("memegen", "fresh")]),
            200,
        )
        .unwrap();
        assert!(!recovered.partial);
        assert!(recovered.warning.is_empty());
        assert!(recovered.is_fresh(200 + CATALOG_TTL - 1));
        assert!(!recovered.is_fresh(200 + CATALOG_TTL));
    }

    #[test]
    fn complete_outage_keeps_cached_sources_and_first_run_reports_missing_sources() {
        let previous = Catalog {
            fetched_at: 10,
            items: vec![sample("imgflip", "old"), sample("memegen", "classic")],
            partial: false,
            warning: String::new(),
        };
        let offline = merge_catalogs(
            Some(&previous),
            Err("Imgflip offline.".into()),
            Err("Memegen offline.".into()),
            100,
        )
        .unwrap();
        assert_eq!(offline.items.len(), 2);
        assert!(offline.warning.contains("cached Imgflip"));
        assert!(offline.warning.contains("cached Memegen"));
        assert!(!offline.is_fresh(160));
        let partial_first_run = merge_catalogs(
            None,
            Ok(vec![sample("imgflip", "new")]),
            Err("Memegen offline.".into()),
            100,
        )
        .unwrap();
        assert_eq!(partial_first_run.items.len(), 1);
        assert!(partial_first_run
            .warning
            .contains("Memegen formats are temporarily unavailable"));
        assert!(merge_catalogs(
            None,
            Err("Imgflip offline.".into()),
            Err("Memegen offline.".into()),
            100
        )
        .is_err());
    }

    #[test]
    fn media_urls_reject_non_https_credentials_lookalikes_and_internal_hosts() {
        for url in [
            "http://i.imgflip.com/a.jpg",
            "https://i.imgflip.com.evil.test/a.jpg",
            "https://i.imgflip.com@localhost/a.jpg",
            "https://127.0.0.1/a.jpg",
            "file:///tmp/a.jpg",
            "https://i.imgflip.com:444/a.jpg",
        ] {
            assert!(checked_media(url, "imgflip").is_err(), "{url}");
        }
        assert!(checked_media("https://i.imgflip.com/a.jpg", "imgflip").is_ok());
        assert!(checked_media(
            "https://static.klipy.com/a.gif?delivery=keep-me",
            "klipy-gifs"
        )
        .is_ok());
        assert!(checked_media("https://static1.klipy.com/a.gif", "klipy-gifs").is_ok());
        assert!(checked_media("https://static2.klipy.com/a.gif", "klipy-gifs").is_ok());
        assert!(checked_media("https://api.memegen.link/images/ds.jpg", "memegen").is_ok());
    }
    #[test]
    fn catalog_parsing_keeps_real_source_ids_and_rejects_host_injection() {
        let mut payload = json!({"success":true,"data":{"memes":[{"id":"61579","name":"One Does Not Simply","url":"https://i.imgflip.com/1bij.jpg"}]}});
        let items = parse_imgflip(&payload).unwrap();
        assert_eq!(items[0].id, "imgflip:61579");
        assert!(items[0].is_template);
        payload["data"]["memes"][0]["url"] = json!("https://localhost/secret");
        assert!(parse_imgflip(&payload).is_err());
    }

    #[test]
    fn request_errors_never_expose_key_bearing_urls() {
        let client = Client::builder().build().unwrap();
        let request = client
            .get("https://api.klipy.com:invalid-port/api/v1/SECRET_KEY/gifs/search")
            .send();
        let message = response_json(request, "KLIPY").unwrap_err();
        assert!(!message.contains("SECRET_KEY"));
        assert!(!message.contains("api/v1"));
        assert!(message.contains("could not be reached"));
    }
    #[test]
    fn klipy_keeps_provider_order_and_exact_delivery_urls() {
        let payload = json!({"result":true,"data":{"has_next":true,"data":[
            {"id":9,"title":"Second alphabetically","file":{"hd":{"gif":{"url":"https://static.klipy.com/z.gif?tracking=original"}}}},
            {"id":1,"title":"Alphabetically first","file":{"hd":{"gif":{"url":"https://static.klipy.com/a.gif?tracking=stay"}}}}
        ]}});
        let (items, more) = parse_klipy(&payload, "klipy-gifs").unwrap();
        assert!(more);
        assert_eq!(items[0].id, "klipy-gifs:9");
        assert_eq!(
            items[0].media_url,
            "https://static.klipy.com/z.gif?tracking=original"
        );
        assert_eq!(items[1].id, "klipy-gifs:1");
        assert!(!items[0].is_template);
    }

    #[test]
    #[ignore = "Explicit network smoke test against public provider APIs"]
    fn live_public_catalogs_and_original_media_download() {
        let directory = tempfile::tempdir().unwrap();
        let state = OnlineState::new(directory.path().to_path_buf());
        let (catalog, warning) = state.popular_catalog().unwrap();
        assert!(warning.is_empty(), "{warning}");
        assert!(catalog.iter().any(|item| item.provider == "imgflip"));
        assert!(catalog.iter().any(|item| item.provider == "memegen"));
        assert!(catalog.len() > 200);
        let first = state.search("", "popular", 1).unwrap();
        assert_eq!(first.items.len(), PAGE_SIZE);
        assert_eq!(first.next_page, Some(2));
        let sample = first
            .items
            .iter()
            .find(|item| item.provider == "imgflip")
            .unwrap();
        let file = state.download(sample).unwrap();
        assert!(file.as_file().metadata().unwrap().len() > 0);
        assert!(["jpeg", "png", "gif", "webp"]
            .contains(&library::inspect_media(file.path()).unwrap().as_str()));
        let memegen = catalog
            .iter()
            .find(|item| item.provider == "memegen")
            .unwrap();
        let file = state.download(memegen).unwrap();
        assert_eq!(library::inspect_media(file.path()).unwrap(), "jpeg");
        println!(
            "Verified {} real catalog entries and original images from both public providers.",
            catalog.len()
        );
    }
}
