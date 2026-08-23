//! Daily reflection, idle status reports, choreography, interaction
//! reports, and the event log.

use crate::error::{AppError, AppResult};
use crate::llm::prompts::{
    choreography_prompt, interaction_report_prompt, reflection_prompt, status_report_prompt,
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
    now_rfc3339, parse_timestamp, DailyReflection, EventLogEntry, Interaction, NewStatusReport,
    PetState, StatusReport,
};
use crate::sandbox::{write_dream, write_note};
use crate::state::AppState;
use chrono::{TimeZone, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

use super::chat::{parse_json_object, sanitize_llm_text};
use super::state::load_or_init_pet_state;

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
