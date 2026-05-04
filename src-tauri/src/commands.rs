use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::llm::ollama::OllamaProvider;
use crate::llm::prompts::{
    choreography_prompt, file_summary_prompt, interaction_report_prompt,
    memory_extraction_prompt, pet_reply_prompt, reflection_prompt, status_report_prompt,
    validate_choreography_json, validate_status_report_json, ChoreographyValidation,
    StatusReportValidation, ValidatedChoreography, ValidatedStatusReport,
};
use crate::llm::report::{
    build_report_markdown, canned_report_text, compress_events_for_report,
    deterministic_status_report, report_filename, summarize_window,
};
use crate::llm::provider::{LlmProvider, LlmRequest};
use crate::llm::CooldownManager;
use crate::models::{
    endpoint_is_loopback, now_rfc3339, parse_timestamp, DailyReflection, EventLogEntry,
    Interaction, Memory, NewInteraction, NewMemory, NewStatusReport, PetState, Settings,
    StatusReport,
};
use crate::sandbox::{
    builtin_skills, list_inbox, read_inbox_by_name, write_dream, write_export, write_note,
    InboxFile, SkillManifest,
};
use crate::state::AppState;
use chrono::{TimeZone, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

const SETTINGS_KEY: &str = "settings:v1";
const CLOUD_API_KEY_SECRET: &str = "cloud_api_key";
const PET_STATE_ID: &str = "default";
const LLM_REPLY_COOLDOWN: Duration = Duration::from_secs(2);
const MAX_MEMORY_RETRIEVAL: i64 = 6;
const MAX_INPUT_LEN: usize = 2_000;

// ============== Pet state ==============

#[tauri::command]
pub fn get_pet_state(state: State<'_, AppState>) -> AppResult<PetState> {
    load_or_init_pet_state(&state.db)
}

fn load_or_init_pet_state(db: &Db) -> AppResult<PetState> {
    if let Some(s) = db.load_pet_state(PET_STATE_ID)? {
        return Ok(s);
    }
    let settings = load_settings_raw(db)?;
    let mut s = PetState::new(settings.pet_name);
    s.id = PET_STATE_ID.to_string();
    db.save_pet_state(&s)?;
    Ok(s)
}

#[tauri::command]
pub fn save_pet_state(state: State<'_, AppState>, mut pet: PetState) -> AppResult<PetState> {
    pet.id = PET_STATE_ID.to_string();
    pet.updated_at = now_rfc3339();
    state.db.save_pet_state(&pet)?;
    Ok(pet)
}

/// Cleanly terminate the entire app process. Invoked from the pet's right-click
/// menu — the main window is frameless, so users have no native close button.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ============== Settings (secrets handled separately) ==============

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    let mut s = load_settings_raw(&state.db)?;
    s.cloud_api_key_set = key_present(&state.db)?;
    Ok(s)
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    if settings.local_only_mode
        && settings.llm_provider == "ollama"
        && !endpoint_is_loopback(&settings.ollama_endpoint)
    {
        return Err(AppError::InvalidInput(
            "local-only mode requires a loopback Ollama endpoint (localhost / 127.0.0.1 / ::1)".into(),
        ));
    }

    let mut to_persist = settings.clone();
    to_persist.cloud_api_key_set = false; // never persist this flag
    let json = serde_json::to_string(&to_persist)?;
    state.db.put_setting(SETTINGS_KEY, &json)?;

    // Re-bind the LLM provider so the new endpoint/model takes effect immediately
    // and so toggling provider to "none" clears the slot.
    let new_provider: Option<Arc<dyn LlmProvider>> = if settings.llm_provider == "ollama" {
        Some(Arc::new(OllamaProvider::new(
            settings.ollama_endpoint.clone(),
            settings.ollama_model.clone(),
        )))
    } else {
        None
    };
    state.set_llm(new_provider);

    let mut echoed = to_persist;
    echoed.cloud_api_key_set = key_present(&state.db)?;
    Ok(echoed)
}

/// True if a non-empty cloud API key is currently stored.
fn key_present(db: &Db) -> AppResult<bool> {
    Ok(matches!(db.get_setting(CLOUD_API_KEY_SECRET)?, Some(v) if !v.is_empty()))
}

/// Write-only setter for the cloud API key. Pass `null` (or an empty string) to
/// remove it. Returns the resulting "set" state — true iff a non-empty key is on
/// disk after the call.
#[tauri::command]
pub fn set_cloud_api_key(state: State<'_, AppState>, key: Option<String>) -> AppResult<bool> {
    match key {
        Some(k) if !k.is_empty() => {
            if k.len() > 4_096 {
                return Err(AppError::InvalidInput("api key too long".into()));
            }
            state.db.put_setting(CLOUD_API_KEY_SECRET, &k)?;
            Ok(true)
        }
        _ => {
            // Truly delete the row so `key_present` reports false afterwards.
            state.db.delete_setting(CLOUD_API_KEY_SECRET)?;
            Ok(false)
        }
    }
}

fn load_settings_raw(db: &Db) -> AppResult<Settings> {
    if let Some(raw) = db.get_setting(SETTINGS_KEY)? {
        if let Ok(s) = serde_json::from_str::<Settings>(&raw) {
            return Ok(s);
        }
    }
    Ok(Settings::default())
}

// ============== Memories ==============

#[tauri::command]
pub fn list_memories(state: State<'_, AppState>, limit: Option<i64>) -> AppResult<Vec<Memory>> {
    let lim = limit.unwrap_or(100).clamp(1, 1_000);
    state.db.list_memories(lim)
}

#[tauri::command]
pub fn create_memory(state: State<'_, AppState>, memory: NewMemory) -> AppResult<Memory> {
    let m = state.db.create_memory(memory)?;
    let _ = state.db.log_event("MEMORY_CREATED", Some(&m.id), Some(40));
    Ok(m)
}

#[tauri::command]
pub fn delete_memory(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete_memory(&id)
}

#[tauri::command]
pub fn search_memories(state: State<'_, AppState>, query: String, limit: Option<i64>) -> AppResult<Vec<Memory>> {
    let lim = limit.unwrap_or(MAX_MEMORY_RETRIEVAL).clamp(1, 50);
    state.db.search_memories(&query, lim)
}

#[tauri::command]
pub fn export_memories(state: State<'_, AppState>, format: String) -> AppResult<String> {
    let memories = state.db.list_memories(10_000)?;
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let (file_name, contents) = match format.as_str() {
        "md" => {
            let mut buf = String::from("# Mochi memories\n\n");
            for m in &memories {
                buf.push_str(&format!("- **{}** (importance {}): {}\n", m.r#type, m.importance, m.content));
            }
            (format!("memories-{}.md", stamp), buf)
        }
        _ => (format!("memories-{}.json", stamp), serde_json::to_string_pretty(&memories)?),
    };
    let path = write_export(&state.pet_home, &file_name, &contents)?;
    Ok(path.to_string_lossy().to_string())
}

// ============== Chat ==============

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
    pub used_llm: bool,
    pub model: Option<String>,
    pub interaction_id: String,
    /// Pet state after the chat-side mutations (affection, boredom,
    /// last_interaction_at, last_llm_call_at). Frontend should adopt this so a
    /// later debounced save doesn't overwrite backend-owned fields.
    pub pet: PetState,
}

#[tauri::command]
pub async fn send_message(state: State<'_, AppState>, message: String) -> AppResult<ChatReply> {
    let trimmed = message.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("empty message".into()));
    }
    if trimmed.chars().count() > MAX_INPUT_LEN {
        return Err(AppError::InvalidInput("message too long".into()));
    }

    let db = state.db.clone();
    let llm_slot = state.llm.clone();
    let cooldown = state.cooldown.clone();
    let settings = db.clone().run(|db| load_settings_raw(db)).await?;
    let pet = db.clone().run(|db| load_or_init_pet_state(db)).await?;

    if !cooldown.try_acquire("llm_user_reply", LLM_REPLY_COOLDOWN) {
        return Err(AppError::LlmCooldown {
            key: "llm_user_reply".into(),
        });
    }

    // Honor the user's memory toggle: when disabled, skip both retrieval and
    // (further down) the post-reply extraction step so nothing is leaked into
    // the prompt or persisted as a durable memory.
    let memories = if settings.memory_enabled {
        let query = trimmed.clone();
        db.clone()
            .run(move |db| Ok(db.search_memories(&query, MAX_MEMORY_RETRIEVAL).unwrap_or_default()))
            .await?
    } else {
        Vec::new()
    };

    let mut reply_text = canned_reply(&pet);
    let mut used_llm = false;
    let mut model = None;

    let provider_opt = llm_slot.read().clone();
    if let Some(provider) = provider_opt {
        let (system, prompt) = pet_reply_prompt(&pet, &memories, &trimmed);
        let req = LlmRequest {
            system: Some(system),
            prompt,
            max_tokens: Some(120),
            temperature: Some(0.7),
            model: Some(settings.ollama_model.clone()),
        };
        match provider.complete(req).await {
            Ok(resp) if !resp.text.is_empty() => {
                reply_text = sanitize_llm_text(&resp.text);
                used_llm = true;
                model = Some(resp.model);
            }
            Ok(_) => {}
            Err(e) => log::warn!("llm reply failed, falling back: {e}"),
        }
    }

    let snapshot = serde_json::to_string(&pet).ok();
    let new_interaction = NewInteraction {
        event_type: "chat".into(),
        user_input: Some(trimmed.clone()),
        pet_response: Some(reply_text.clone()),
        mood: Some(pet.mood.clone()),
        state_snapshot_json: snapshot,
    };
    let interaction = db
        .clone()
        .run(move |db| db.create_interaction(new_interaction))
        .await?;

    let mut updated = pet.clone();
    updated.last_interaction_at = Some(now_rfc3339());
    updated.affection = (updated.affection + 1).min(100);
    updated.boredom = (updated.boredom - 5).max(0);
    if used_llm {
        updated.last_llm_call_at = Some(now_rfc3339());
    }
    let to_save = updated.clone();
    db.clone().run(move |db| db.save_pet_state(&to_save)).await?;

    if used_llm && settings.memory_enabled {
        let prompt_input = format!("user: {}\npet: {}", trimmed, reply_text);
        let interaction_id = interaction.id.clone();
        let db_for_task = db.clone();
        let llm_for_task = llm_slot.clone();
        let cooldown_for_task = cooldown.clone();
        tokio::spawn(async move {
            if let Err(e) = extract_and_store_memories(
                db_for_task,
                llm_for_task,
                cooldown_for_task,
                prompt_input,
                interaction_id,
            )
            .await
            {
                log::warn!("memory extraction failed: {e}");
            }
        });
    }

    Ok(ChatReply {
        text: reply_text,
        used_llm,
        model,
        interaction_id: interaction.id,
        pet: updated,
    })
}

fn canned_reply(state: &PetState) -> String {
    match state.mood.as_str() {
        "tired" => format!("*{} yawns* talk soon…", state.name),
        "hungry" => format!("*{} sniffs around hopefully*", state.name),
        "bored" => format!("*{} pokes you to play*", state.name),
        "lonely" => format!("*{} stays close to you*", state.name),
        _ => format!("*{} blinks at you warmly*", state.name),
    }
}

/// Trim and cap LLM-generated text before it reaches the UI. Strips control
/// characters that could break the chat bubble or terminal rendering.
fn sanitize_llm_text(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.chars().count() > 1_000 {
        trimmed.chars().take(1_000).collect::<String>() + "…"
    } else {
        trimmed.to_string()
    }
}

async fn extract_and_store_memories(
    db: Arc<Db>,
    llm_slot: Arc<RwLock<Option<Arc<dyn LlmProvider>>>>,
    cooldown: Arc<CooldownManager>,
    interaction_text: String,
    source_id: String,
) -> AppResult<()> {
    let provider = match llm_slot.read().clone() {
        Some(p) => p,
        None => return Ok(()),
    };
    if !cooldown.try_acquire("llm_memory_extract", Duration::from_secs(20)) {
        return Ok(());
    }
    let (system, prompt) = memory_extraction_prompt(&interaction_text);
    let resp = provider
        .complete(LlmRequest {
            system: Some(system),
            prompt,
            max_tokens: Some(400),
            temperature: Some(0.2),
            model: None,
        })
        .await?;

    let parsed: Vec<NewMemory> = match parse_json_array(&resp.text) {
        Some(v) => v,
        None => {
            log::warn!("memory extraction returned non-json");
            return Ok(());
        }
    };
    for mut nm in parsed {
        nm.source_interaction_id = Some(source_id.clone());
        let _ = db.clone().run(move |db| db.create_memory(nm)).await;
    }
    Ok(())
}

fn parse_json_array<T: for<'de> serde::Deserialize<'de>>(text: &str) -> Option<Vec<T>> {
    if let Ok(v) = serde_json::from_str::<Vec<T>>(text) {
        return Some(v);
    }
    let start = text.find('[')?;
    let end = text.rfind(']')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&text[start..=end]).ok()
}

fn parse_json_object<T: for<'de> serde::Deserialize<'de>>(text: &str) -> Option<T> {
    if let Ok(v) = serde_json::from_str::<T>(text) {
        return Some(v);
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&text[start..=end]).ok()
}

// ============== Autonomous speech ==============

/// Generate a short autonomous in-character bubble for high-salience events
/// like USER_RETURNED. Distinct from `send_message`: no chat record is written
/// (this is volatile ambient behavior, not user-initiated dialogue), and it
/// respects the `autonomous_speech` setting + a longer dedicated cooldown.
#[tauri::command]
pub async fn autonomous_speak(
    state: State<'_, AppState>,
    kind: String,
    away_minutes: Option<f64>,
) -> AppResult<ChatReply> {
    let db = state.db.clone();
    let llm_slot = state.llm.clone();
    let cooldown = state.cooldown.clone();
    let settings = db.clone().run(|db| load_settings_raw(db)).await?;
    if !settings.autonomous_speech {
        return Err(AppError::Permission("autonomous speech disabled".into()));
    }
    if !cooldown.try_acquire("llm_autonomous", Duration::from_secs(90)) {
        return Err(AppError::LlmCooldown { key: "llm_autonomous".into() });
    }
    let pet = db.clone().run(|db| load_or_init_pet_state(db)).await?;
    let provider_opt = llm_slot.read().clone();
    let prompt_seed = match kind.as_str() {
        "returned" => format!(
            "(autonomous: user just returned after {:.0} minutes away)",
            away_minutes.unwrap_or(0.0)
        ),
        "morning" => "(autonomous: a new morning has begun)".to_string(),
        "evening" => "(autonomous: it is evening)".to_string(),
        other => format!("(autonomous: event {})", other),
    };

    let mut text = canned_autonomous(&pet, &kind);
    let mut used_llm = false;
    let mut model = None;

    if let Some(provider) = provider_opt {
        let (system, prompt) = pet_reply_prompt(&pet, &[], &prompt_seed);
        match provider
            .complete(LlmRequest {
                system: Some(system),
                prompt,
                max_tokens: Some(60),
                temperature: Some(0.8),
                model: Some(settings.ollama_model.clone()),
            })
            .await
        {
            Ok(resp) if !resp.text.is_empty() => {
                text = sanitize_llm_text(&resp.text);
                used_llm = true;
                model = Some(resp.model);
            }
            Ok(_) => {}
            Err(e) => log::warn!("autonomous llm failed: {e}"),
        }
    }

    let mut updated = pet.clone();
    if used_llm {
        updated.last_llm_call_at = Some(now_rfc3339());
        let to_save = updated.clone();
        db.clone().run(move |db| db.save_pet_state(&to_save)).await?;
    }

    Ok(ChatReply {
        text,
        used_llm,
        model,
        interaction_id: String::new(),
        pet: updated,
    })
}

fn canned_autonomous(state: &PetState, kind: &str) -> String {
    match kind {
        "returned" => format!("welcome back. {} guarded the corner.", state.name),
        "morning" => format!("{} stretches. good morning.", state.name),
        "evening" => format!("{} watches the lights soften.", state.name),
        _ => format!("{} blinks at you.", state.name),
    }
}

// ============== Sandbox / inbox ==============

#[tauri::command]
pub fn list_inbox_files(state: State<'_, AppState>) -> AppResult<Vec<InboxFile>> {
    list_inbox(&state.pet_home)
}

/// Approve and summarize an inbox file by *file name only*. Absolute paths and
/// path traversal sequences are rejected upstream by `read_inbox_by_name`.
#[tauri::command]
pub async fn approve_file(state: State<'_, AppState>, file_name: String) -> AppResult<String> {
    let home = state.pet_home.clone();
    let db = state.db.clone();
    let llm_slot = state.llm.clone();
    let cooldown = state.cooldown.clone();

    let inbox_read = read_inbox_by_name(&home, &file_name)?;
    let summary = summarize_file_text(&llm_slot, &cooldown, &inbox_read.file_name, &inbox_read.content).await?;
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let safe_stem: String = std::path::Path::new(&inbox_read.file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let note_name = format!("inbox-{}-{}.md", stamp, safe_stem);
    // Embed only the file name (already validated through read_inbox_by_name).
    // Never embed the canonical path to keep notes free of host-specific data.
    let body = format!(
        "# {}\n\nSource: inbox/{}\n\n{}\n",
        inbox_read.file_name, inbox_read.file_name, summary
    );
    write_note(&home, &note_name, &body)?;
    let logged_name = inbox_read.file_name.clone();
    db.clone()
        .run(move |db| db.log_event("FILE_INSPECTION_APPROVED", Some(&logged_name), Some(60)).map(|_| ()))
        .await?;
    Ok(summary)
}

async fn summarize_file_text(
    llm_slot: &Arc<RwLock<Option<Arc<dyn LlmProvider>>>>,
    cooldown: &Arc<CooldownManager>,
    file_name: &str,
    content: &str,
) -> AppResult<String> {
    let provider_opt = llm_slot.read().clone();
    if let Some(provider) = provider_opt {
        if cooldown.try_acquire("llm_file_summary", Duration::from_secs(10)) {
            let (system, prompt) = file_summary_prompt(file_name, content);
            match provider
                .complete(LlmRequest {
                    system: Some(system),
                    prompt,
                    max_tokens: Some(180),
                    temperature: Some(0.3),
                    model: None,
                })
                .await
            {
                Ok(r) if !r.text.is_empty() => return Ok(sanitize_llm_text(&r.text)),
                Ok(_) => {}
                Err(e) => log::warn!("file summary llm failed: {e}"),
            }
        }
    }
    let head: String = content.lines().take(3).collect::<Vec<_>>().join(" / ");
    Ok(format!("(local summary) {}", sanitize_llm_text(&head)))
}

// ============== Daily reflection ==============

#[tauri::command]
pub async fn run_daily_reflection(state: State<'_, AppState>) -> AppResult<DailyReflection> {
    let db = state.db.clone();
    let llm_slot = state.llm.clone();
    let cooldown = state.cooldown.clone();
    let home = state.pet_home.clone();

    // Use the user's *local* day for both the date stamp and the interaction
    // window — a reflection at 11pm should not roll into "tomorrow" via UTC.
    let local_now = chrono::Local::now();
    let local_date = local_now.format("%Y-%m-%d").to_string();
    let day_start_utc = local_now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|n| local_now.timezone().from_local_datetime(&n).single())
        .map(|dt| dt.with_timezone(&Utc).to_rfc3339())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let day_end_utc = Utc::now().to_rfc3339();

    let start_clone = day_start_utc.clone();
    let end_clone = day_end_utc.clone();
    let interactions = db
        .clone()
        .run(move |db| db.interactions_between(&start_clone, &end_clone, 200))
        .await?;
    let memories = db.clone().run(|db| db.list_memories(20)).await?;

    let events_text = if interactions.is_empty() {
        "(no interactions today)".to_string()
    } else {
        interactions
            .iter()
            .take(15)
            .map(format_interaction_line)
            .collect::<Vec<_>>()
            .join("\n")
    };

    let date = local_date;
    let mut learned = None;
    let mut noticed = None;
    let mut wants = None;
    let mut raw_text = None;

    let provider_opt = llm_slot.read().clone();
    if let Some(provider) = provider_opt {
        if cooldown.try_acquire("llm_reflection", Duration::from_secs(60)) {
            let (system, prompt) = reflection_prompt(&events_text, &memories);
            match provider
                .complete(LlmRequest {
                    system: Some(system),
                    prompt,
                    max_tokens: Some(220),
                    temperature: Some(0.6),
                    model: None,
                })
                .await
            {
                Ok(resp) => {
                    raw_text = Some(sanitize_llm_text(&resp.text));
                    if let Some(parsed) = parse_json_object::<ReflectionJson>(&resp.text) {
                        learned = parsed.learned.map(|s| sanitize_llm_text(&s));
                        noticed = parsed.noticed.map(|s| sanitize_llm_text(&s));
                        wants = parsed.wants.map(|s| sanitize_llm_text(&s));
                    }
                }
                Err(e) => log::warn!("reflection llm failed: {e}"),
            }
        }
    }

    if learned.is_none() {
        learned = Some(format!("had {} interactions today", interactions.len()));
        noticed = Some(format!("memories total: {}", memories.len()));
        wants = Some("stay near the cursor more".to_string());
    }

    let reflection = DailyReflection {
        id: Uuid::new_v4().to_string(),
        reflection_date: date,
        learned,
        noticed,
        wants,
        raw_text,
        created_at: now_rfc3339(),
    };
    let to_save = reflection.clone();
    db.clone().run(move |db| db.save_reflection(&to_save)).await?;

    let body = format!(
        "# Dream {}\n\n- learned: {}\n- noticed: {}\n- wants: {}\n",
        reflection.reflection_date,
        reflection.learned.clone().unwrap_or_default(),
        reflection.noticed.clone().unwrap_or_default(),
        reflection.wants.clone().unwrap_or_default(),
    );
    let _ = write_dream(&home, &format!("{}.md", reflection.reflection_date), &body);
    db.clone()
        .run(|db| db.log_event("DAILY_REFLECTION_DUE", None, Some(70)).map(|_| ()))
        .await?;
    Ok(reflection)
}

#[derive(Deserialize)]
struct ReflectionJson {
    learned: Option<String>,
    noticed: Option<String>,
    wants: Option<String>,
}

fn format_interaction_line(ix: &Interaction) -> String {
    let user = ix.user_input.clone().unwrap_or_default();
    let pet = ix.pet_response.clone().unwrap_or_default();
    format!("- ({}) user: {} | pet: {}", ix.event_type, user, pet)
}

// ============== Status Report (idle-triggered, §9.8 / REQ-070..076) ==============

/// Generate a 12-hour status report. Caller (frontend gate) is responsible
/// for the 12h-elapsed AND idle-window check (REQ-070..074); this command
/// just runs the analysis honestly with whatever window is available.
///
/// Writes:
/// - one row in `status_reports`
/// - one markdown file under `pet_home/dreams/YYYY-MM-DD-HHMM.md`
/// - updates `pet_state.last_report_at = window_end`
/// - logs `STATUS_REPORT_DUE` event
///
/// On LLM failure (offline, timeout, malformed JSON) the deterministic
/// fallback produces an equivalent report — REQ-076.
#[tauri::command]
pub async fn run_status_report(state: State<'_, AppState>) -> AppResult<StatusReport> {
    let db = state.db.clone();
    let llm_slot = state.llm.clone();
    let cooldown = state.cooldown.clone();
    let home = state.pet_home.clone();

    // Load pet (frontend gate already verified `last_report_at` cadence, but
    // we re-read to compute the analysis window from the persisted timestamp).
    let pet = db
        .clone()
        .run(|db| Ok(load_or_init_pet_state(db)?))
        .await?;

    // Compute analysis window: from `last_report_at` (or now-12h on first run)
    // through now. Caller's gate ensures these are reasonable bounds.
    let window_end = chrono::Utc::now();
    let window_start = pet
        .last_report_at
        .as_deref()
        .and_then(parse_timestamp)
        .unwrap_or_else(|| window_end - chrono::Duration::hours(12));
    let window_start_iso = window_start.to_rfc3339();
    let window_end_iso = window_end.to_rfc3339();

    let ws = window_start_iso.clone();
    let we = window_end_iso.clone();
    let events = db
        .clone()
        .run(move |db| db.events_between(&ws, &we, 500))
        .await?;
    let ws = window_start_iso.clone();
    let we = window_end_iso.clone();
    let interactions = db
        .clone()
        .run(move |db| db.interactions_between(&ws, &we, 200))
        .await?;
    // Top-3 memories — kept tiny per REQ-075.
    let memories = db.clone().run(|db| db.list_memories(3)).await?;

    let summary = summarize_window(
        &events,
        &interactions,
        &memories,
        &window_start_iso,
        &window_end_iso,
    );

    // Try LLM, fall back deterministically. Cooldown key is dedicated so the
    // chat-reply cooldown doesn't interact with reports.
    let validated = run_status_report_llm_or_fallback(&pet, &summary, &llm_slot, &cooldown).await;

    // File path: dreams/YYYY-MM-DD-HHMM.md (filesystem-safe, sortable).
    let file_name = report_filename(&window_end_iso);
    // report_filename returns "report-..."; we want a YYYY-MM-DD-HHMM.md style
    // file under dreams/ to match REQ-071. Strip the "report-" prefix.
    let dream_name = file_name.strip_prefix("report-").unwrap_or(&file_name);
    let body = build_status_report_markdown(&pet, &summary, &validated, &window_end_iso);
    let file_path = match write_dream(&home, dream_name, &body) {
        Ok(p) => Some(p.to_string_lossy().into_owned()),
        Err(e) => {
            log::warn!("status report file write failed: {e}");
            None
        }
    };

    // Persist row + update pet.last_report_at + log the event.
    let new_row = NewStatusReport {
        window_start: window_start_iso.clone(),
        window_end: window_end_iso.clone(),
        learned: validated.learned.clone(),
        noticed: validated.noticed.clone(),
        wants: validated.wants.clone(),
        prose: Some(validated.prose.clone()),
        file_path: file_path.clone(),
    };
    let saved = db
        .clone()
        .run(move |db| db.save_status_report(new_row))
        .await?;

    let mut next_pet = pet.clone();
    next_pet.last_report_at = Some(window_end_iso.clone());
    next_pet.updated_at = now_rfc3339();
    db.clone()
        .run(move |db| db.save_pet_state(&next_pet))
        .await?;
    db.clone()
        .run(|db| db.log_event("STATUS_REPORT_DUE", None, Some(70)).map(|_| ()))
        .await?;

    Ok(saved)
}

/// Attempt the LLM call; on any failure (no provider, cooldown blocked,
/// network error, validator rejection) fall back to the deterministic
/// generator. REQ-076: cadence is preserved regardless of LLM availability.
async fn run_status_report_llm_or_fallback(
    pet: &PetState,
    summary: &crate::llm::report::WindowSummary,
    llm_slot: &Arc<RwLock<Option<Arc<dyn LlmProvider>>>>,
    cooldown: &Arc<CooldownManager>,
) -> ValidatedStatusReport {
    let provider_opt = llm_slot.read().clone();
    if let Some(provider) = provider_opt {
        if cooldown.try_acquire("llm_status_report", Duration::from_secs(60)) {
            let (system, prompt) = status_report_prompt(summary);
            match provider
                .complete(LlmRequest {
                    system: Some(system),
                    prompt,
                    max_tokens: Some(420),
                    temperature: Some(0.55),
                    model: None,
                })
                .await
            {
                Ok(resp) => match validate_status_report_json(&resp.text) {
                    StatusReportValidation::Ok(v) => return v,
                    StatusReportValidation::Reject(reason) => {
                        log::warn!("status report JSON rejected: {reason}; using deterministic fallback");
                    }
                },
                Err(e) => log::warn!("status report llm failed: {e}; using deterministic fallback"),
            }
        }
    }
    deterministic_status_report(pet, summary)
}

/// Build the markdown body written under `dreams/`. Format mirrors the
/// existing dream files but adds the prose paragraph and window range.
fn build_status_report_markdown(
    pet: &PetState,
    summary: &crate::llm::report::WindowSummary,
    r: &ValidatedStatusReport,
    now_iso: &str,
) -> String {
    format!(
        "# 📔 Mochi's status report\n\n_Window: {start} → {end} ({hours:.1}h)_\n\n{prose}\n\n- **learned:** {learned}\n- **noticed:** {noticed}\n- **wants:** {wants}\n\n_pet: {name} · mood: {mood} · bond: ♥ {bond} · written: {ts}_\n",
        start   = summary.window_start,
        end     = summary.window_end,
        hours   = summary.window_hours,
        prose   = r.prose,
        learned = r.learned.clone().unwrap_or_else(|| "—".into()),
        noticed = r.noticed.clone().unwrap_or_else(|| "—".into()),
        wants   = r.wants.clone().unwrap_or_else(|| "—".into()),
        name    = pet.name,
        mood    = pet.mood,
        bond    = pet.relationship_level,
        ts      = now_iso,
    )
}

/// Settings → "Recent Reports" list. Most-recent first.
#[tauri::command]
pub async fn list_status_reports(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> AppResult<Vec<StatusReport>> {
    let cap = limit.unwrap_or(10).clamp(1, 100);
    state.db.clone().run(move |db| db.list_status_reports(cap)).await
}

// ============== Behavior Choreography (§9.11 / REQ-094..099) ==============

/// Ask the LLM to pick a choreography preset + variant + bubble for a
/// salient event. The frontend invokes this only when (salience ≥ 70 AND
/// 90s autonomous cooldown elapsed). If this command returns `Err`, the
/// frontend MUST fall back to its deterministic `pickFallbackPreset` (REQ-098).
///
/// Validation is strict: an unknown preset, free-text bubble, or non-JSON
/// reply all return `Err`. The frontend never sees an invalid choreography.
#[tauri::command]
pub async fn choose_choreography(
    state: State<'_, AppState>,
    event_type: String,
) -> AppResult<ValidatedChoreography> {
    let llm_slot = state.llm.clone();
    let cooldown = state.cooldown.clone();
    let db = state.db.clone();

    let pet = db.clone().run(|db| Ok(load_or_init_pet_state(db)?)).await?;

    let provider = match llm_slot.read().clone() {
        Some(p) => p,
        None => return Err(AppError::Internal("no LLM provider configured".into())),
    };

    // REQ-097: share the existing 90s autonomous cooldown so chat replies
    // and choreography compete for the same budget. A second call within
    // 90s is rejected here without burning tokens.
    if !cooldown.try_acquire("llm_autonomous", Duration::from_secs(90)) {
        return Err(AppError::Internal("autonomous LLM cooldown active".into()));
    }

    let (system, prompt) = choreography_prompt(&pet, &event_type);
    let response = provider
        .complete(LlmRequest {
            system: Some(system),
            prompt,
            // Choreography output is tiny — a single JSON object with three
            // short fields. Keep tokens low so the LLM has no room to ramble.
            max_tokens: Some(80),
            // Low temperature: we want consistent picks, not creative riffing.
            temperature: Some(0.3),
            model: None,
        })
        .await?;

    match validate_choreography_json(&response.text) {
        ChoreographyValidation::Ok(v) => Ok(v),
        ChoreographyValidation::Reject(reason) => {
            log::warn!("choreography JSON rejected: {reason}");
            Err(AppError::Internal(format!(
                "invalid choreography reply: {reason}"
            )))
        }
    }
}

#[tauri::command]
pub fn get_last_reflection(state: State<'_, AppState>) -> AppResult<Option<DailyReflection>> {
    state.db.last_reflection()
}

// ============== Interaction report ==============

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionReport {
    pub text: String,
    pub saved_path: String,
    pub used_llm: bool,
    pub event_count: usize,
}

/// Generate a short, friendly note from Mochi summarising recent interactions.
/// Uses the LLM when available; falls back to a deterministic canned line so a
/// missing Ollama never breaks the button. Either way, a markdown file is
/// written into the sandbox's `notes/` folder.
#[tauri::command]
pub async fn generate_interaction_report(
    state: State<'_, AppState>,
) -> AppResult<InteractionReport> {
    let db = state.db.clone();
    let llm_slot = state.llm.clone();
    let cooldown = state.cooldown.clone();
    let home = state.pet_home.clone();

    let pet = db.clone().run(|db| load_or_init_pet_state(db)).await?;
    // 50 most recent events is enough for a "today-ish" feel without bloating
    // the prompt context (gemma4:e2b has a small window).
    let events = db.clone().run(|db| db.recent_events(50)).await?;
    let compressed = compress_events_for_report(&events);

    let mut summary_text = canned_report_text(&pet, &events);
    let mut used_llm = false;

    let provider_opt = llm_slot.read().clone();
    if let Some(provider) = provider_opt {
        if cooldown.try_acquire("llm_report", Duration::from_secs(30)) {
            let (system, prompt) = interaction_report_prompt(&pet, &compressed);
            match provider
                .complete(LlmRequest {
                    system: Some(system),
                    prompt,
                    max_tokens: Some(80),
                    temperature: Some(0.7),
                    model: None,
                })
                .await
            {
                Ok(resp) if !resp.text.trim().is_empty() => {
                    summary_text = sanitize_llm_text(&resp.text);
                    used_llm = true;
                }
                Ok(_) => log::warn!("interaction report LLM returned empty text"),
                Err(e) => log::warn!("interaction report LLM failed: {e}"),
            }
        }
    }

    let now = now_rfc3339();
    let markdown = build_report_markdown(&pet, &summary_text, &events, &now);
    let file_name = report_filename(&now);
    let written = write_note(&home, &file_name, &markdown)?;

    Ok(InteractionReport {
        text: summary_text,
        saved_path: written.to_string_lossy().to_string(),
        used_llm,
        event_count: events.len(),
    })
}

// ============== Event log ==============

#[tauri::command]
pub fn get_event_log(state: State<'_, AppState>, limit: Option<i64>) -> AppResult<Vec<EventLogEntry>> {
    let lim = limit.unwrap_or(100).clamp(1, 500);
    state.db.recent_events(lim)
}

#[tauri::command]
pub fn log_event(
    state: State<'_, AppState>,
    event_type: String,
    payload: Option<String>,
    salience: Option<i32>,
) -> AppResult<EventLogEntry> {
    if event_type.is_empty() || event_type.len() > 64 {
        return Err(AppError::InvalidInput("invalid event_type".into()));
    }
    state.db.log_event(&event_type, payload.as_deref(), salience)
}

// ============== Skills ==============

#[tauri::command]
pub fn list_skills(_state: State<'_, AppState>) -> AppResult<Vec<SkillManifest>> {
    Ok(builtin_skills())
}

#[cfg(test)]
mod tests {
    use super::sanitize_llm_text;

    #[test]
    fn sanitize_llm_text_strips_controls_and_caps_length() {
        let s = "hello\u{0007}\u{0001}world\nok\t!";
        let out = sanitize_llm_text(s);
        assert!(!out.contains('\u{0007}'));
        assert!(out.contains('\n'));
        assert!(out.contains('\t'));
    }

    #[test]
    fn sanitize_llm_text_caps_long_strings() {
        let big = "x".repeat(2_000);
        let out = sanitize_llm_text(&big);
        assert!(out.chars().count() <= 1_001);
    }
}
