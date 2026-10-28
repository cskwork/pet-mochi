use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetState {
    pub id: String,
    pub name: String,
    pub mood: String,
    pub hunger: i32,
    pub energy: i32,
    pub affection: i32,
    pub boredom: i32,
    pub curiosity: i32,
    pub stress: i32,
    pub trust: i32,
    pub relationship_level: i32,
    pub current_animation: Option<String>,
    pub current_intent: Option<String>,
    pub last_interaction_at: Option<String>,
    pub last_llm_call_at: Option<String>,
    /// RFC3339 timestamp of the last idle-triggered status report (PRD §9.8).
    /// Drives the 12-hour cadence gate; null means a report has never run.
    pub last_report_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl PetState {
    pub fn new(name: impl Into<String>) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id: "default".to_string(),
            name: name.into(),
            mood: "happy".to_string(),
            hunger: 30,
            energy: 80,
            affection: 50,
            boredom: 20,
            curiosity: 60,
            stress: 10,
            trust: 50,
            relationship_level: 1,
            current_animation: Some("idle".to_string()),
            current_intent: Some("idle".to_string()),
            last_interaction_at: None,
            last_llm_call_at: None,
            last_report_at: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub r#type: String,
    pub content: String,
    pub importance: i32,
    pub confidence: f32,
    pub source_interaction_id: Option<String>,
    pub created_at: String,
    pub last_accessed_at: Option<String>,
    pub decay_score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMemory {
    pub r#type: String,
    pub content: String,
    pub importance: Option<i32>,
    pub confidence: Option<f32>,
    pub source_interaction_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Interaction {
    pub id: String,
    pub event_type: String,
    pub user_input: Option<String>,
    pub pet_response: Option<String>,
    pub mood: Option<String>,
    pub state_snapshot_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewInteraction {
    pub event_type: String,
    pub user_input: Option<String>,
    pub pet_response: Option<String>,
    pub mood: Option<String>,
    pub state_snapshot_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyReflection {
    pub id: String,
    pub reflection_date: String,
    pub learned: Option<String>,
    pub noticed: Option<String>,
    pub wants: Option<String>,
    pub raw_text: Option<String>,
    pub created_at: String,
}

/// 12-hour idle-triggered status report (PRD §9.8, REQ-070..076).
/// Replaces the daily-cadence reflection model. `daily_reflections` is kept in
/// the schema for backwards compatibility with old user databases.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    pub id: String,
    /// RFC3339 — start of the analyzed 12h window.
    pub window_start: String,
    /// RFC3339 — end of the analyzed window (= report fire time).
    pub window_end: String,
    pub learned: Option<String>,
    pub noticed: Option<String>,
    pub wants: Option<String>,
    /// 200-400 character paragraph interpreting the window. Optional because
    /// the deterministic fallback may produce a shorter line.
    pub prose: Option<String>,
    /// Path under `pet_home/dreams/` where the markdown copy lives, or null
    /// if file write failed (the row is still recorded).
    pub file_path: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewStatusReport {
    pub window_start: String,
    pub window_end: String,
    pub learned: Option<String>,
    pub noticed: Option<String>,
    pub wants: Option<String>,
    pub prose: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLogEntry {
    pub id: String,
    pub event_type: String,
    pub payload_json: Option<String>,
    pub salience: Option<i32>,
    pub handled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub permissions_json: String,
    pub enabled: bool,
    pub created_at: String,
}

/// User-visible settings. Secrets like API keys are intentionally NOT in this
/// struct — they live in the dedicated `secrets` table and are write-only from
/// the frontend's perspective. The `cloudApiKeySet` flag tells the UI whether a
/// key is currently stored without ever returning the key itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub pet_name: String,
    pub personality_preset: String,
    pub llm_provider: String,
    pub ollama_endpoint: String,
    pub ollama_model: String,
    pub local_only_mode: bool,
    pub autonomous_speech: bool,
    pub memory_enabled: bool,
    pub animation_intensity: f32,
    pub always_on_top: bool,
    pub start_on_login: bool,
    pub pet_home_path: Option<String>,
    pub developer_event_log: bool,
    /// Stage background behind the pet (PRD §27.6 REQ-114): "transparent"
    /// keeps the classic desktop overlay; the themed values render a soft
    /// card. Unknown values normalize to "transparent" on save. Defaulted so
    /// settings blobs persisted before v0.2 still deserialize.
    #[serde(default = "default_stage_background")]
    pub stage_background: String,
    /// Sound effects (PRD §27.6 REQ-117). Synth-only chirps for
    /// user-initiated actions; autonomous behaviors always stay silent.
    /// Defaulted so pre-v0.2 settings blobs still deserialize.
    #[serde(default = "default_true")]
    pub sound_effects: bool,
    /// Desktop notifications for critical needs (PRD §28 REQ-122).
    /// Opt-in only — default off, silent per §27.2.2. Defaulted so settings
    /// blobs persisted before v0.2.x still deserialize.
    #[serde(default)]
    pub desktop_notifications: bool,
    /// Read-only flag: true if a cloud API key is on disk. Never carries the key value.
    #[serde(default)]
    pub cloud_api_key_set: bool,
}

/// Closed list of stage backgrounds the frontend styles (REQ-114). "auto"
/// (REQ-118) resolves to a themed card from the current time of day.
pub const STAGE_BACKGROUNDS: [&str; 6] =
    ["transparent", "auto", "cream", "blossom", "mint", "night"];

fn default_stage_background() -> String {
    "transparent".to_string()
}

fn default_true() -> bool {
    true
}

/// Clamp a requested stage background to the closed list (REQ-114).
pub fn normalize_stage_background(value: &str) -> &'static str {
    STAGE_BACKGROUNDS
        .iter()
        .find(|v| **v == value)
        .copied()
        .unwrap_or("transparent")
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            pet_name: "Mochi".to_string(),
            personality_preset: "curious".to_string(),
            llm_provider: "ollama".to_string(),
            ollama_endpoint: "http://localhost:11434".to_string(),
            ollama_model: "gemma4:e2b".to_string(),
            local_only_mode: true,
            autonomous_speech: true,
            memory_enabled: true,
            animation_intensity: 1.0,
            always_on_top: true,
            start_on_login: false,
            pet_home_path: None,
            developer_event_log: false,
            stage_background: default_stage_background(),
            sound_effects: true,
            desktop_notifications: false,
            cloud_api_key_set: false,
        }
    }
}

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

pub fn parse_timestamp(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|dt| dt.with_timezone(&Utc))
}

/// True when the host portion of `endpoint` is a loopback address. Used to
/// enforce `local_only_mode` for the Ollama provider — outbound LLM calls go
/// from Rust via reqwest and bypass the webview CSP, so we must validate here.
///
/// Use reqwest's URL parser so userinfo, paths, queries, and fragments cannot
/// change which host is classified. Only HTTP(S) endpoints are supported.
pub fn endpoint_is_loopback(endpoint: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(endpoint) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    if let Some(domain) = url.domain() {
        return domain == "localhost";
    }
    url.host_str()
        .and_then(|host| host.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

#[cfg(test)]
mod model_tests {
    use super::{endpoint_is_loopback, normalize_stage_background, Settings};

    /// REQ-114/117 — settings blobs persisted before the fields existed must
    /// still deserialize, defaulting to the transparent overlay and sounds on.
    #[test]
    fn settings_legacy_json_defaults_new_fields() {
        let legacy = r#"{"petName":"Mochi","personalityPreset":"curious","llmProvider":"ollama","ollamaEndpoint":"http://localhost:11434","ollamaModel":"gemma4:e2b","localOnlyMode":true,"autonomousSpeech":true,"memoryEnabled":true,"animationIntensity":1.0,"alwaysOnTop":true,"startOnLogin":false,"petHomePath":null,"developerEventLog":false}"#;
        let s: Settings = serde_json::from_str(legacy).unwrap();
        assert_eq!(s.stage_background, "transparent");
        assert!(s.sound_effects);
        // REQ-122 — notifications are opt-in; legacy blobs default to off.
        assert!(!s.desktop_notifications);
    }

    #[test]
    fn stage_background_normalizes_to_closed_list() {
        assert_eq!(normalize_stage_background("night"), "night");
        assert_eq!(normalize_stage_background("transparent"), "transparent");
        // REQ-118 — "auto" is a first-class value and passes through unchanged.
        assert_eq!(normalize_stage_background("auto"), "auto");
        assert_eq!(normalize_stage_background("hotpink; url(evil)"), "transparent");
        assert_eq!(normalize_stage_background(""), "transparent");
    }

    #[test]
    fn loopback_classification_basic() {
        assert!(endpoint_is_loopback("http://localhost:11434"));
        assert!(endpoint_is_loopback("http://127.0.0.1:11434"));
        assert!(endpoint_is_loopback("http://127.1.2.3:8080/api"));
        assert!(endpoint_is_loopback("http://[::1]:11434"));
        assert!(endpoint_is_loopback("HTTP://LOCALHOST"));
        assert!(!endpoint_is_loopback("https://api.openai.com/v1"));
        assert!(!endpoint_is_loopback("http://10.0.0.5:11434"));
        assert!(!endpoint_is_loopback("http://example.com"));
    }

    #[test]
    fn loopback_blocks_url_tricks() {
        // userinfo trick — host is evil.com, "127.0.0.1" is the username
        assert!(!endpoint_is_loopback("http://127.0.0.1@evil.com"));
        assert!(!endpoint_is_loopback("http://127.0.0.1@evil.com:11434"));
        assert!(!endpoint_is_loopback("http://localhost@evil.com"));
        // '@' in a query or fragment is not userinfo.
        assert!(!endpoint_is_loopback("http://example.com?@localhost"));
        assert!(!endpoint_is_loopback("http://example.com#@localhost"));
        // hostname that merely *starts* with "127." but is not a real IP
        assert!(!endpoint_is_loopback("http://127.0.0.1.evil.com"));
        assert!(!endpoint_is_loopback("http://localhost.evil.com"));
        // empty / malformed should not pass either
        assert!(!endpoint_is_loopback(""));
        assert!(!endpoint_is_loopback("http://"));
        assert!(!endpoint_is_loopback("http://["));
        assert!(!endpoint_is_loopback("ftp://localhost:11434"));
        assert!(!endpoint_is_loopback("file://localhost/path"));
        assert!(!endpoint_is_loopback("http://localhost:invalid"));
    }
}
