//! Sandbox inbox listing + consent-driven approval/summary.

use crate::error::AppResult;
use crate::llm::prompts::file_summary_prompt;
use crate::llm::provider::{LlmProvider, LlmRequest};
use crate::llm::CooldownManager;
use crate::sandbox::{list_inbox, read_inbox_by_name, write_note, InboxFile};
use crate::state::AppState;
use chrono::Utc;
use parking_lot::RwLock;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

use super::chat::sanitize_llm_text;

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
