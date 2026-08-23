//! Memory CRUD, search, and export.

use crate::error::AppResult;
use crate::models::{Memory, NewMemory};
use crate::sandbox::write_export;
use crate::state::AppState;
use chrono::Utc;
use tauri::State;

/// Cap used both by `search_memories`'s default and the chat prompt's
/// retrieval window (shared so prompt size and search stay in lockstep).
pub(crate) const MAX_MEMORY_RETRIEVAL: i64 = 6;

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
