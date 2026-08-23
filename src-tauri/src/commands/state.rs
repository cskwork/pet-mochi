//! Pet state, settings, secrets, and the app/window commands.

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::llm::ollama::OllamaProvider;
use crate::llm::provider::LlmProvider;
use crate::models::{
    endpoint_is_loopback, normalize_stage_background, now_rfc3339, PetState, Settings,
};
use crate::sandbox::{builtin_skills, SkillManifest};
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

const SETTINGS_KEY: &str = "settings:v1";
const CLOUD_API_KEY_SECRET: &str = "cloud_api_key";
const PET_STATE_ID: &str = "default";

// ============== Pet state ==============

#[tauri::command]
pub fn get_pet_state(state: State<'_, AppState>) -> AppResult<PetState> {
    load_or_init_pet_state(&state.db)
}

pub(crate) fn load_or_init_pet_state(db: &Db) -> AppResult<PetState> {
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

/// REQ-115 — show the settings window. It is declared `visible: false` in
/// tauri.conf.json and hidden-on-close (see lib.rs), so the pet's context
/// menu is the one and only way users reach Settings.
#[tauri::command]
pub fn open_settings(app: tauri::AppHandle) -> AppResult<()> {
    use tauri::Manager;
    let window = app
        .get_webview_window("settings")
        .ok_or_else(|| AppError::NotFound("settings window".to_string()))?;
    window
        .show()
        .map_err(|e| AppError::Internal(format!("show settings window: {e}")))?;
    let _ = window.unminimize();
    let _ = window.set_focus();
    Ok(())
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
    // REQ-114 — clamp to the closed background list so an arbitrary string
    // can never reach the frontend's data attribute.
    to_persist.stage_background =
        normalize_stage_background(&to_persist.stage_background).to_string();
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

pub(crate) fn load_settings_raw(db: &Db) -> AppResult<Settings> {
    if let Some(raw) = db.get_setting(SETTINGS_KEY)? {
        if let Ok(s) = serde_json::from_str::<Settings>(&raw) {
            return Ok(s);
        }
    }
    Ok(Settings::default())
}

// ============== Skills ==============

#[tauri::command]
pub fn list_skills(_state: State<'_, AppState>) -> AppResult<Vec<SkillManifest>> {
    Ok(builtin_skills())
}
