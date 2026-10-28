//! Pet state, settings, secrets, and the app/window commands.

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::llm::ollama::OllamaProvider;
use crate::llm::provider::LlmProvider;
use crate::models::{
    endpoint_is_loopback, normalize_pet_accessory, normalize_pet_name, normalize_pet_scale,
    normalize_pet_skin, normalize_personality_preset, normalize_stage_background, now_rfc3339,
    PetState, Settings,
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
    save_settings_inner(&state, settings)
}

fn save_settings_inner(state: &AppState, settings: Settings) -> AppResult<Settings> {
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
    to_persist.pet_scale = normalize_pet_scale(to_persist.pet_scale);
    to_persist.pet_skin = normalize_pet_skin(&to_persist.pet_skin).to_string();
    to_persist.pet_accessory = normalize_pet_accessory(&to_persist.pet_accessory).to_string();
    to_persist.personality_preset =
        normalize_personality_preset(&to_persist.personality_preset).to_string();
    to_persist.pet_name = normalize_pet_name(&to_persist.pet_name);
    let json = serde_json::to_string(&to_persist)?;
    state.db.put_settings_and_rename_pet(SETTINGS_KEY, &json, PET_STATE_ID, &to_persist.pet_name)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    fn app_state() -> AppState {
        AppState::new(Arc::new(Db::open_in_memory().unwrap()), std::path::PathBuf::new())
    }

    #[test]
    fn settings_save_echoes_and_persists_normalized_customization() {
        let state = app_state();
        let mut settings = Settings::default();
        settings.llm_provider = "none".into();
        settings.pet_name = format!("  {}extra  ", "가🐾".repeat(12));
        settings.pet_scale = f32::NAN;
        settings.pet_skin = "unknown".into();
        settings.pet_accessory = "unknown".into();
        settings.personality_preset = "unknown".into();
        settings.stage_background = "unknown".into();
        settings.cloud_api_key_set = true;

        let echoed = save_settings_inner(&state, settings).unwrap();
        assert_eq!(echoed.pet_name, "가🐾".repeat(12));
        assert_eq!(echoed.pet_scale, 1.0);
        assert_eq!(echoed.pet_skin, "classic");
        assert_eq!(echoed.pet_accessory, "none");
        assert_eq!(echoed.personality_preset, "curious");
        assert_eq!(echoed.stage_background, "transparent");
        assert!(!echoed.cloud_api_key_set);
        let persisted = load_settings_raw(&state.db).unwrap();
        assert_eq!(serde_json::to_value(&persisted).unwrap(), serde_json::to_value(&echoed).unwrap());
        // Saving from Settings before the first pet load must still work.
        assert!(state.db.load_pet_state(PET_STATE_ID).unwrap().is_none());
        assert_eq!(load_or_init_pet_state(&state.db).unwrap().name, echoed.pet_name);
    }

    #[test]
    fn settings_save_preserves_valid_customization_and_clamps_scale() {
        let state = app_state();
        let mut settings = Settings::default();
        settings.llm_provider = "none".into();
        settings.pet_name = " \tPeach\n".into();
        settings.pet_skin = "peach".into();
        settings.pet_accessory = "bow".into();
        settings.personality_preset = "quiet".into();
        for (value, expected) in [(0.1, 0.75), (2.0, 1.5), (1.25, 1.25), (f32::INFINITY, 1.0)] {
            settings.pet_scale = value;
            let echoed = save_settings_inner(&state, settings.clone()).unwrap();
            assert_eq!(echoed.pet_name, "Peach");
            assert_eq!(echoed.pet_skin, "peach");
            assert_eq!(echoed.pet_accessory, "bow");
            assert_eq!(echoed.personality_preset, "quiet");
            assert_eq!(echoed.pet_scale, expected);
            assert_eq!(load_settings_raw(&state.db).unwrap().pet_scale, expected);
        }
        settings.pet_name = " \t\n".into();
        assert_eq!(save_settings_inner(&state, settings).unwrap().pet_name, "Mochi");
    }

    #[test]
    fn settings_rename_changes_only_live_name_and_updated_at() {
        let state = app_state();
        let mut pet = PetState::new("Old name");
        pet.mood = "curious".into();
        pet.hunger = 17;
        pet.energy = 42;
        pet.affection = 93;
        pet.current_animation = Some("peek".into());
        pet.last_interaction_at = Some("2026-10-28T01:00:00Z".into());
        pet.last_llm_call_at = Some("2026-10-28T02:00:00Z".into());
        pet.last_report_at = Some("2026-10-28T03:00:00Z".into());
        pet.updated_at = "2026-10-28T00:00:00Z".into();
        state.db.save_pet_state(&pet).unwrap();
        let mut other = PetState::new("Other pet");
        other.id = "other".into();
        state.db.save_pet_state(&other).unwrap();

        let mut settings = Settings::default();
        settings.llm_provider = "none".into();
        settings.pet_name = "  New name  ".into();
        let echoed = save_settings_inner(&state, settings).unwrap();
        let renamed = state.db.load_pet_state(&pet.id).unwrap().unwrap();
        assert_eq!(renamed.name, "New name");
        assert_eq!(renamed.name, echoed.pet_name);
        assert_ne!(renamed.updated_at, pet.updated_at);
        let mut before = serde_json::to_value(&pet).unwrap();
        before["name"] = renamed.name.clone().into();
        before["updatedAt"] = renamed.updated_at.clone().into();
        assert_eq!(serde_json::to_value(renamed).unwrap(), before);
        assert_eq!(
            serde_json::to_value(state.db.load_pet_state(&other.id).unwrap().unwrap()).unwrap(),
            serde_json::to_value(other).unwrap(),
        );
    }

    #[test]
    fn invalid_endpoint_does_not_save_settings_or_rename_pet() {
        let state = app_state();
        let pet = load_or_init_pet_state(&state.db).unwrap();
        let mut settings = Settings::default();
        settings.pet_name = "Should not save".into();
        settings.ollama_endpoint = "http://example.com".into();
        assert!(matches!(save_settings_inner(&state, settings), Err(AppError::InvalidInput(_))));
        assert!(state.db.get_setting(SETTINGS_KEY).unwrap().is_none());
        assert_eq!(
            serde_json::to_value(state.db.load_pet_state(&pet.id).unwrap().unwrap()).unwrap(),
            serde_json::to_value(pet).unwrap(),
        );
    }
}
