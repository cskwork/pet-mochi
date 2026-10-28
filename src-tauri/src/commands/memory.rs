//! Memory CRUD, search, and export.

use crate::db::Db;
use crate::error::AppResult;
use crate::models::{Memory, NewMemory};
use crate::sandbox::write_export;
use crate::state::AppState;
use chrono::Utc;
use std::path::PathBuf;
use std::sync::Arc;
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
pub async fn export_memories(state: State<'_, AppState>, format: String) -> AppResult<String> {
    export_memories_to_file(state.db.clone(), state.pet_home.clone(), format).await
}

async fn export_memories_to_file(db: Arc<Db>, home: PathBuf, format: String) -> AppResult<String> {
    // Keep database work, serialization, and file IO together on the blocking pool.
    db.run(move |db| {
        let memories = db.list_all_memories()?;
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
        let path = write_export(&home, &file_name, &contents)?;
        Ok(path.to_string_lossy().to_string())
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn export_includes_more_than_ten_thousand_memories() {
        let db = Arc::new(Db::open_in_memory().unwrap());
        for i in 0..10_001 {
            db.create_memory(NewMemory {
                r#type: "user_fact".into(),
                content: format!("memory {i}"),
                importance: None,
                confidence: None,
                source_interaction_id: None,
            }).unwrap();
        }
        let home = tempfile::tempdir().unwrap();
        let path = export_memories_to_file(db, home.path().to_path_buf(), "json".into()).await.unwrap();
        let exported: Vec<Memory> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let contents: std::collections::HashSet<_> = exported.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(contents.len(), 10_001);
        assert!(contents.contains("memory 0"));
        assert!(contents.contains("memory 10000"));
    }

    #[tokio::test]
    async fn markdown_export_and_file_errors_are_preserved() {
        let db = Arc::new(Db::open_in_memory().unwrap());
        db.create_memory(NewMemory {
            r#type: "preference".into(),
            content: "likes tea".into(),
            importance: Some(5),
            confidence: None,
            source_interaction_id: None,
        }).unwrap();
        let home = tempfile::tempdir().unwrap();
        let path = export_memories_to_file(db.clone(), home.path().to_path_buf(), "md".into()).await.unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "# Mochi memories\n\n- **preference** (importance 5): likes tea\n");

        let blocked = home.path().join("not-a-directory");
        std::fs::write(&blocked, "x").unwrap();
        assert!(export_memories_to_file(db, blocked, "json".into()).await.is_err());
    }
}
