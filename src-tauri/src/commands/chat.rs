//! Chat replies + autonomous speech, including the LLM text/JSON helpers
//! shared with the inbox and reports domains.

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::llm::prompts::{memory_extraction_prompt, pet_reply_prompt};
use crate::llm::provider::{LlmProvider, LlmRequest};
use crate::llm::CooldownManager;
use crate::models::{now_rfc3339, NewInteraction, NewMemory, PetState};
use crate::state::AppState;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

use super::memory::MAX_MEMORY_RETRIEVAL;
use super::state::{load_or_init_pet_state, load_settings_raw};

const LLM_REPLY_COOLDOWN: Duration = Duration::from_secs(2);
const MAX_INPUT_LEN: usize = 2_000;

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
pub(crate) fn sanitize_llm_text(s: &str) -> String {
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

pub(crate) fn parse_json_object<T: for<'de> serde::Deserialize<'de>>(text: &str) -> Option<T> {
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
