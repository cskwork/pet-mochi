pub mod commands;
pub mod db;
pub mod error;
pub mod llm;
pub mod models;
pub mod sandbox;
pub mod state;
pub mod watcher;

use std::path::PathBuf;
use std::sync::Arc;

use crate::db::Db;
use crate::llm::ollama::OllamaProvider;
use crate::models::{endpoint_is_loopback, Settings};
use crate::sandbox::{default_pet_home, ensure_pet_home};
use crate::state::AppState;
use tauri::Manager;

const SETTINGS_KEY: &str = "settings:v1";
const DB_FILE: &str = "mochi.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::try_init();
    tauri::Builder::default()
        .setup(|app| {
            let pet_home = resolve_pet_home();
            ensure_pet_home(&pet_home).expect("could not create pet_home");
            let db_path = pet_home.join(DB_FILE);
            let db = Arc::new(Db::open(&db_path).expect("could not open mochi.db"));

            let app_state = AppState::new(db.clone(), pet_home.clone());

            let settings = db
                .get_setting(SETTINGS_KEY)
                .ok()
                .flatten()
                .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
                .unwrap_or_default();

            // Configure provider when ollama is selected. Cloud providers are stubbed.
            // Note on CSP and ollamaEndpoint: tauri.conf.json's connect-src whitelists
            // http://localhost:11434 (Ollama default) for the webview. The user can
            // override `ollama_endpoint` at runtime — that custom URL would be blocked
            // by CSP if the webview tried to reach it directly, but our LLM calls go
            // out from Rust via reqwest, not from the webview, so reachability is
            // unaffected. The CSP only protects the webview against XSS exfiltration.
            // local_only_mode IS enforced here: in that mode the endpoint must
            // resolve to a loopback address, otherwise the provider is not loaded.
            if settings.llm_provider == "ollama" {
                if settings.local_only_mode && !endpoint_is_loopback(&settings.ollama_endpoint) {
                    log::warn!(
                        "local_only_mode is on but ollama_endpoint is non-loopback ({}); LLM disabled",
                        settings.ollama_endpoint
                    );
                } else {
                    let provider = Arc::new(OllamaProvider::new(
                        settings.ollama_endpoint.clone(),
                        settings.ollama_model.clone(),
                    ));
                    app_state.set_llm(Some(provider));
                }
            }

            let app_handle = app.handle().clone();
            match crate::watcher::spawn_inbox_watcher(app_handle, pet_home) {
                Ok(handle) => app_state.set_watcher(handle),
                Err(e) => log::warn!("could not spawn inbox watcher: {e}"),
            }
            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_pet_state,
            commands::save_pet_state,
            commands::get_settings,
            commands::save_settings,
            commands::set_cloud_api_key,
            commands::list_memories,
            commands::create_memory,
            commands::delete_memory,
            commands::search_memories,
            commands::export_memories,
            commands::send_message,
            commands::autonomous_speak,
            commands::list_inbox_files,
            commands::approve_file,
            commands::run_daily_reflection,
            commands::get_last_reflection,
            commands::get_event_log,
            commands::log_event,
            commands::list_skills,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn resolve_pet_home() -> PathBuf {
    if let Ok(env_path) = std::env::var("MOCHI_HOME") {
        return PathBuf::from(env_path);
    }
    default_pet_home().unwrap_or_else(|_| PathBuf::from("./pet_home"))
}
