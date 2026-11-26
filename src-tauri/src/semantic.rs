//! Local sentence embeddings: pinned MiniLM, CPU-only Candle, no inference service.
use crate::library::{MemeItem, Result};
use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config, DTYPE};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::Path};
use tokenizers::{Tokenizer, TruncationParams};

pub const MODEL: &str = "sentence-transformers/all-MiniLM-L6-v2";
pub const REVISION: &str = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41";
const DIMENSIONS: usize = 384;
const FILES: &[(&str, &str, u64)] = &[
    (
        "config.json",
        "953f9c0d463486b10a6871cc2fd59f223b2c70184f49815e7efbcab5d8908b41",
        612,
    ),
    (
        "tokenizer.json",
        "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037",
        466247,
    ),
    (
        "model.safetensors",
        "53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db",
        90868376,
    ),
];

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Deserialize, Serialize)]
struct Index {
    model: String,
    revision: String,
    dimensions: usize,
    entries: Vec<Entry>,
}
#[derive(Deserialize, Serialize)]
struct Entry {
    id: String,
    description_hash: String,
    vectors: Vec<Vec<f32>>,
}

#[cfg(test)]
fn passages(description: &str) -> Vec<&str> {
    let mut passages = vec![description];
    // A visual scene and its conversational intent can be quite different.
    // Preserve both, rather than averaging a long paragraph into one meaning.
    for sentence in description.split(['.', '!', '?']).map(str::trim) {
        if sentence.split_whitespace().count() >= 6
            && sentence != description.trim_end_matches(['.', '!', '?'])
        {
            passages.push(sentence);
        }
        if passages.len() == 4 {
            break;
        }
    }
    passages
}

pub struct SemanticEngine {
    model: BertModel,
    tokenizer: Tokenizer,
    entries: HashMap<String, Entry>,
}

impl SemanticEngine {
    /// Call on a worker, never the webview/main thread. Missing resources are a
    /// recoverable lexical-search fallback; no runtime network request is made.
    pub fn load(model_directory: &Path, index_path: &Path) -> Result<Self> {
        let mut engine = Self::load_model(model_directory)?;
        let file = fs::File::open(index_path).map_err(|_| "Semantic index is missing.")?;
        if file
            .metadata()
            .map_err(|_| "Could not inspect semantic index.")?
            .len()
            > 8 * 1024 * 1024
        {
            return Err("Semantic index exceeds the size limit.".into());
        }
        let index: Index =
            serde_json::from_reader(file).map_err(|_| "Semantic index is invalid.")?;
        if index.model != MODEL
            || index.revision != REVISION
            || index.dimensions != DIMENSIONS
            || index.entries.len() > 5000
        {
            return Err("Semantic index does not match the bundled model.".into());
        }
        for entry in index.entries {
            if entry.vectors.is_empty() || entry.vectors.len() > 4 {
                return Err("Semantic index has invalid passages.".into());
            }
            for vector in &entry.vectors {
                let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
                if vector.len() != DIMENSIONS
                    || vector.iter().any(|v| !v.is_finite())
                    || !(0.99..=1.01).contains(&norm)
                {
                    return Err("Semantic index contains invalid vectors.".into());
                }
            }
            if engine.entries.insert(entry.id.clone(), entry).is_some() {
                return Err("Semantic index contains invalid or duplicate entries.".into());
            }
        }
        Ok(engine)
    }

    fn load_model(directory: &Path) -> Result<Self> {
        let mut verified = HashMap::new();
        for &(name, expected, size) in FILES {
            let path = directory.join(name);
            let metadata = fs::symlink_metadata(&path).map_err(|_| {
                "Local search model is not installed. Run npm run model:prepare before building."
            })?;
            if !metadata.is_file() || metadata.len() != size {
                return Err(
                    "Local search model is incomplete. Run npm run model:prepare again.".into(),
                );
            }
            let bytes = fs::read(path).map_err(|_| "Could not read local search model.")?;
            if digest(&bytes) != expected {
                return Err("Local search model failed its integrity check.".into());
            }
            verified.insert(name, bytes);
        }
        let config: Config = serde_json::from_slice(&verified["config.json"])
            .map_err(|_| "Invalid model configuration.")?;
        let mut tokenizer = Tokenizer::from_bytes(&verified["tokenizer.json"])
            .map_err(|_| "Invalid model tokenizer.")?;
        tokenizer.with_padding(None);
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: 256,
                ..Default::default()
            }))
            .map_err(|_| "Could not configure tokenizer.")?;
        // Owned bytes avoid unsafe memory mapping or executable model formats.
        let variables = VarBuilder::from_buffered_safetensors(
            verified.remove("model.safetensors").unwrap(),
            DTYPE,
            &Device::Cpu,
        )
        .map_err(|error| format!("Could not load local model weights: {error}"))?;
        let model = BertModel::load(variables, &config)
            .map_err(|error| format!("Could not initialize local model: {error}"))?;
        Ok(Self {
            model,
            tokenizer,
            entries: HashMap::new(),
        })
    }

    fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let encoded = self
            .tokenizer
            .encode(text, true)
            .map_err(|_| "Could not tokenize description.")?;
        let tokens = encoded.get_ids();
        let ids = Tensor::new(tokens, &Device::Cpu)
            .and_then(|v| v.unsqueeze(0))
            .map_err(|e| e.to_string())?;
        let types = ids.zeros_like().map_err(|e| e.to_string())?;
        // Single unpadded sequence: ordinary mean pooling is exactly attention-
        // masked mean pooling, including CLS/SEP as the model card specifies.
        let embeddings = self
            .model
            .forward(&ids, &types, None)
            .map_err(|e| e.to_string())?;
        let pooled = (embeddings.sum(1).map_err(|e| e.to_string())? / tokens.len() as f64)
            .map_err(|e| e.to_string())?;
        let mut vector = pooled
            .squeeze(0)
            .and_then(|v| v.to_vec1::<f32>())
            .map_err(|e| e.to_string())?;
        let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
        if vector.len() != DIMENSIONS || !norm.is_finite() || norm < 1e-8 {
            return Err("Model returned an invalid embedding.".into());
        }
        for value in &mut vector {
            *value /= norm;
        }
        Ok(vector)
    }

    pub fn scores(&self, query: &str, items: &[MemeItem]) -> Result<HashMap<String, f32>> {
        if query.trim().is_empty() {
            return Ok(HashMap::new());
        }
        if query.chars().count() > 2000 {
            return Err("Search description is too long.".into());
        }
        let query = self.embed(query)?;
        Ok(items
            .iter()
            .filter_map(|item| {
                let entry = self.entries.get(&item.id)?;
                // Never silently use stale vectors after an annotation changes.
                if entry.description_hash != digest(item.description.as_bytes()) {
                    return None;
                }
                let similarities: Vec<f32> = entry
                    .vectors
                    .iter()
                    .map(|vector| query.iter().zip(vector).map(|(a, b)| a * b).sum())
                    .collect();
                let best = similarities
                    .iter()
                    .copied()
                    .fold(f32::NEG_INFINITY, f32::max);
                let similarity = best * 0.85 + similarities[0] * 0.15;
                Some((item.id.clone(), similarity))
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Deserialize)]
    struct Annotation {
        source: String,
        id: String,
        description: String,
        tags: Vec<String>,
    }
    fn annotations() -> Vec<MemeItem> {
        let entries: Vec<Annotation> =
            serde_json::from_str(include_str!("../../assets/internet-metadata.json")).unwrap();
        entries
            .into_iter()
            .map(|entry| MemeItem {
                id: format!("{}:{}", entry.source, entry.id),
                title: entry.tags.first().cloned().unwrap_or_default(),
                description: entry.description,
                tags: entry.tags,
                filename: "fixture.png".into(),
                kind: "png".into(),
                favorite: false,
                last_used: None,
            })
            .collect()
    }
    fn resources() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../assets")
    }

    #[test]
    fn absent_model_is_a_recoverable_error() {
        let directory = tempfile::tempdir().unwrap();
        assert!(
            SemanticEngine::load(directory.path(), &directory.path().join("missing.json")).is_err()
        );
    }

    #[test]
    fn bundled_index_matches_every_current_description_and_model_contract() {
        let bytes = fs::read(resources().join("semantic-index.json"))
            .expect("Generate the committed semantic index");
        assert!(bytes.len() <= 8 * 1024 * 1024);
        let index: Index = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(index.model, MODEL);
        assert_eq!(index.revision, REVISION);
        assert_eq!(index.dimensions, DIMENSIONS);
        let entries: HashMap<_, _> = index
            .entries
            .iter()
            .map(|entry| (entry.id.as_str(), entry))
            .collect();
        assert_eq!(entries.len(), index.entries.len(), "Duplicate index IDs");
        let items = annotations();
        assert_eq!(items.len(), entries.len());
        for item in items {
            let entry = entries
                .get(item.id.as_str())
                .expect("Missing description vector");
            assert_eq!(
                entry.description_hash,
                digest(item.description.as_bytes()),
                "Stale index for {}: regenerate it",
                item.id
            );
            assert_eq!(entry.vectors.len(), passages(&item.description).len());
            for vector in &entry.vectors {
                assert_eq!(vector.len(), DIMENSIONS);
                assert!(vector.iter().all(|v| v.is_finite()));
                assert!((0.99..=1.01).contains(&vector.iter().map(|v| v * v).sum::<f32>().sqrt()));
            }
        }
    }

    #[test]
    #[ignore = "Explicit model-index generation; requires checksum-verified model resources"]
    fn generate_catalog_index() {
        let resources = resources();
        let model =
            SemanticEngine::load_model(&resources.parent().unwrap().join("models/minilm")).unwrap();
        let items = annotations();
        let started = std::time::Instant::now();
        let entries = items
            .iter()
            .map(|item| Entry {
                id: item.id.clone(),
                description_hash: digest(item.description.as_bytes()),
                vectors: passages(&item.description)
                    .iter()
                    .map(|text| model.embed(text).unwrap())
                    .collect(),
            })
            .collect();
        let index = Index {
            model: MODEL.into(),
            revision: REVISION.into(),
            dimensions: DIMENSIONS,
            entries,
        };
        let bytes = serde_json::to_vec(&index).unwrap();
        assert!(
            bytes.len() <= 8 * 1024 * 1024,
            "Index exceeds runtime limit"
        );
        let staged = tempfile::NamedTempFile::new_in(&resources).unwrap();
        fs::write(staged.path(), bytes).unwrap();
        staged
            .persist(resources.join("semantic-index.json"))
            .unwrap();
        println!(
            "Indexed {} descriptions in {:?}",
            items.len(),
            started.elapsed()
        );
    }

    #[test]
    #[ignore = "Actual local CPU inference smoke test; requires model and generated index"]
    fn actual_model_generalizes_descriptions() {
        let resources = resources();
        let model = SemanticEngine::load(
            &resources.parent().unwrap().join("models/minilm"),
            &resources.join("semantic-index.json"),
        )
        .unwrap();
        let items = annotations();
        let mut failed = Vec::new();
        for (query, expected, top) in [
            ("dog cooked", "imgflip:574931918", 1),
            ("god eye closed", "imgflip:574931918", 1),
            (
                "brown lab shutting its eyes in sunlight",
                "imgflip:574931918",
                3,
            ),
            ("accepting my fate after messing up", "imgflip:574931918", 3),
            ("dog in room on fire", "imgflip:55311130", 3),
            ("tiny victory clenched toddler fist", "memegen:success", 3),
            (
                "man's attention caught by another woman",
                "imgflip:112126428",
                3,
            ),
            ("conflicting red switches", "imgflip:87743020", 3),
            ("polite smile hiding misery", "imgflip:27813981", 3),
            (
                "attempting to look cheerful despite being miserable",
                "imgflip:27813981",
                3,
            ),
            (
                "squinting cartoon doubting what he sees",
                "imgflip:61520",
                3,
            ),
        ] {
            let start = std::time::Instant::now();
            let scores = model.scores(query, &items).unwrap();
            let ranked = crate::library::hybrid_search(&items, query, "all", &scores).unwrap();
            println!(
                "{query:?} {:?} {:?}",
                start.elapsed(),
                ranked
                    .iter()
                    .take(5)
                    .map(|i| (&i.id, scores.get(&i.id)))
                    .collect::<Vec<_>>()
            );
            if !ranked.iter().take(top).any(|item| item.id == expected) {
                failed.push(format!(
                    "{query:?}: expected {expected} in top {top}; rank {:?}, semantic {:?}",
                    ranked
                        .iter()
                        .position(|item| item.id == expected)
                        .map(|index| index + 1),
                    scores.get(expected)
                ));
            }
        }
        // Without a visual clue several choice formats are valid; do not tune
        // a generic query to insist on one hand-selected template.
        let query = "forced to pick between incompatible options";
        let scores = model.scores(query, &items).unwrap();
        let ranked = crate::library::hybrid_search(&items, query, "all", &scores).unwrap();
        assert!(ranked.iter().take(3).any(|item| [
            "imgflip:87743020",
            "imgflip:91998305",
            "imgflip:129315248",
            "memegen:both"
        ]
        .contains(&item.id.as_str())));
        assert!(failed.is_empty(), "{}", failed.join("\n"));
    }
}
