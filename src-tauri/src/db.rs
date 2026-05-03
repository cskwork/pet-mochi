use crate::error::{AppError, AppResult};
use crate::models::{
    now_rfc3339, parse_timestamp, DailyReflection, EventLogEntry, Interaction, Memory,
    NewInteraction, NewMemory, PetState, Skill,
};
use chrono::Utc;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS pet_state (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mood TEXT NOT NULL,
    hunger INTEGER NOT NULL,
    energy INTEGER NOT NULL,
    affection INTEGER NOT NULL,
    boredom INTEGER NOT NULL,
    curiosity INTEGER NOT NULL,
    stress INTEGER NOT NULL,
    trust INTEGER NOT NULL,
    relationship_level INTEGER NOT NULL,
    current_animation TEXT,
    current_intent TEXT,
    last_interaction_at TEXT,
    last_llm_call_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    importance INTEGER DEFAULT 1,
    confidence REAL DEFAULT 0.7,
    source_interaction_id TEXT,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT,
    decay_score REAL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    content='memories',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    user_input TEXT,
    pet_response TEXT,
    mood TEXT,
    state_snapshot_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interactions_created_at ON interactions(created_at DESC);

CREATE TABLE IF NOT EXISTS daily_reflections (
    id TEXT PRIMARY KEY,
    reflection_date TEXT NOT NULL,
    learned TEXT,
    noticed TEXT,
    wants TEXT,
    raw_text TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(reflection_date)
);

CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    permissions_json TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_log (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    salience INTEGER,
    handled INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"#;

pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA_SQL)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA_SQL)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Run a synchronous DB closure on tokio's blocking pool so async tauri
    /// commands don't stall a runtime worker while holding the rusqlite mutex.
    /// The mutex guard is never held across an `.await` because the closure
    /// itself is sync.
    pub async fn run<F, R>(self: Arc<Self>, f: F) -> AppResult<R>
    where
        F: FnOnce(&Db) -> AppResult<R> + Send + 'static,
        R: Send + 'static,
    {
        tokio::task::spawn_blocking(move || f(&self))
            .await
            .map_err(|e| AppError::Internal(format!("db join: {e}")))?
    }

    // ------- Pet state -------
    pub fn save_pet_state(&self, state: &PetState) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO pet_state (id, name, mood, hunger, energy, affection, boredom, curiosity, stress, trust, relationship_level, current_animation, current_intent, last_interaction_at, last_llm_call_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                mood=excluded.mood,
                hunger=excluded.hunger,
                energy=excluded.energy,
                affection=excluded.affection,
                boredom=excluded.boredom,
                curiosity=excluded.curiosity,
                stress=excluded.stress,
                trust=excluded.trust,
                relationship_level=excluded.relationship_level,
                current_animation=excluded.current_animation,
                current_intent=excluded.current_intent,
                last_interaction_at=excluded.last_interaction_at,
                last_llm_call_at=excluded.last_llm_call_at,
                updated_at=excluded.updated_at",
            params![
                state.id,
                state.name,
                state.mood,
                state.hunger,
                state.energy,
                state.affection,
                state.boredom,
                state.curiosity,
                state.stress,
                state.trust,
                state.relationship_level,
                state.current_animation,
                state.current_intent,
                state.last_interaction_at,
                state.last_llm_call_at,
                state.created_at,
                state.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn load_pet_state(&self, id: &str) -> AppResult<Option<PetState>> {
        let conn = self.conn.lock();
        let res = conn
            .query_row(
                "SELECT id, name, mood, hunger, energy, affection, boredom, curiosity, stress, trust, relationship_level, current_animation, current_intent, last_interaction_at, last_llm_call_at, created_at, updated_at
                 FROM pet_state WHERE id = ?1",
                params![id],
                |row| {
                    Ok(PetState {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        mood: row.get(2)?,
                        hunger: row.get(3)?,
                        energy: row.get(4)?,
                        affection: row.get(5)?,
                        boredom: row.get(6)?,
                        curiosity: row.get(7)?,
                        stress: row.get(8)?,
                        trust: row.get(9)?,
                        relationship_level: row.get(10)?,
                        current_animation: row.get(11)?,
                        current_intent: row.get(12)?,
                        last_interaction_at: row.get(13)?,
                        last_llm_call_at: row.get(14)?,
                        created_at: row.get(15)?,
                        updated_at: row.get(16)?,
                    })
                },
            )
            .optional()?;
        Ok(res)
    }

    // ------- Memories -------
    pub fn create_memory(&self, mem: NewMemory) -> AppResult<Memory> {
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let importance = mem.importance.unwrap_or(1);
        let confidence = mem.confidence.unwrap_or(0.7);
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO memories (id, type, content, importance, confidence, source_interaction_id, created_at, last_accessed_at, decay_score)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                mem.r#type,
                mem.content,
                importance,
                confidence,
                mem.source_interaction_id,
                now,
                now,
                1.0_f32,
            ],
        )?;
        Ok(Memory {
            id,
            r#type: mem.r#type,
            content: mem.content,
            importance,
            confidence,
            source_interaction_id: mem.source_interaction_id,
            created_at: now.clone(),
            last_accessed_at: Some(now),
            decay_score: 1.0,
        })
    }

    pub fn delete_memory(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM memories WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_memories(&self, limit: i64) -> AppResult<Vec<Memory>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, type, content, importance, confidence, source_interaction_id, created_at, last_accessed_at, decay_score
             FROM memories ORDER BY created_at DESC LIMIT ?1",
        )?;
        let iter = stmt.query_map(params![limit], map_memory)?;
        Ok(collect_tolerant(iter, "memories"))
    }

    /// Retrieve relevant memories blending FTS text relevance with recency and importance.
    /// Score = importance * 0.4 + recency * 0.3 + relevance * 0.3.
    pub fn search_memories(&self, query: &str, limit: i64) -> AppResult<Vec<Memory>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return self.list_memories(limit);
        }
        let conn = self.conn.lock();
        let now = Utc::now();
        let fts_query = sanitize_fts_query(trimmed);
        let mut stmt = conn.prepare(
            "SELECT m.id, m.type, m.content, m.importance, m.confidence, m.source_interaction_id, m.created_at, m.last_accessed_at, m.decay_score
             FROM memories m
             JOIN memories_fts f ON f.rowid = m.rowid
             WHERE memories_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;
        let iter = stmt.query_map(params![fts_query, limit * 2], map_memory)?;
        let mut rows = collect_tolerant(iter, "memories");

        // If FTS yields nothing, fall back to LIKE on content for partial matches.
        if rows.is_empty() {
            let like = format!("%{}%", trimmed);
            let mut alt = conn.prepare(
                "SELECT id, type, content, importance, confidence, source_interaction_id, created_at, last_accessed_at, decay_score
                 FROM memories WHERE content LIKE ?1 ORDER BY created_at DESC LIMIT ?2",
            )?;
            let alt_iter = alt.query_map(params![like, limit], map_memory)?;
            rows = collect_tolerant(alt_iter, "memories");
        }

        rows.sort_by(|a, b| {
            let sa = scored(a, now);
            let sb = scored(b, now);
            sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
        });
        rows.truncate(limit as usize);
        Ok(rows)
    }

    pub fn touch_memory_access(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE memories SET last_accessed_at = ?1 WHERE id = ?2",
            params![now_rfc3339(), id],
        )?;
        Ok(())
    }

    // ------- Interactions -------
    pub fn create_interaction(&self, ix: NewInteraction) -> AppResult<Interaction> {
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO interactions (id, event_type, user_input, pet_response, mood, state_snapshot_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                ix.event_type,
                ix.user_input,
                ix.pet_response,
                ix.mood,
                ix.state_snapshot_json,
                now,
            ],
        )?;
        Ok(Interaction {
            id,
            event_type: ix.event_type,
            user_input: ix.user_input,
            pet_response: ix.pet_response,
            mood: ix.mood,
            state_snapshot_json: ix.state_snapshot_json,
            created_at: now,
        })
    }

    pub fn recent_interactions(&self, limit: i64) -> AppResult<Vec<Interaction>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, user_input, pet_response, mood, state_snapshot_json, created_at
             FROM interactions ORDER BY created_at DESC LIMIT ?1",
        )?;
        let iter = stmt.query_map(params![limit], map_interaction)?;
        Ok(collect_tolerant(iter, "interactions"))
    }

    /// Interactions whose `created_at` is between `start` and `end` (inclusive).
    /// Both bounds are RFC3339 strings; sortable as text since RFC3339 with the
    /// same timezone is lexicographically ordered.
    pub fn interactions_between(&self, start: &str, end: &str, limit: i64) -> AppResult<Vec<Interaction>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, user_input, pet_response, mood, state_snapshot_json, created_at
             FROM interactions
             WHERE created_at >= ?1 AND created_at <= ?2
             ORDER BY created_at DESC LIMIT ?3",
        )?;
        let iter = stmt.query_map(params![start, end, limit], map_interaction)?;
        Ok(collect_tolerant(iter, "interactions"))
    }

    // ------- Daily reflections -------
    pub fn save_reflection(&self, r: &DailyReflection) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO daily_reflections (id, reflection_date, learned, noticed, wants, raw_text, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(reflection_date) DO UPDATE SET
                learned=excluded.learned,
                noticed=excluded.noticed,
                wants=excluded.wants,
                raw_text=excluded.raw_text",
            params![r.id, r.reflection_date, r.learned, r.noticed, r.wants, r.raw_text, r.created_at],
        )?;
        Ok(())
    }

    pub fn last_reflection(&self) -> AppResult<Option<DailyReflection>> {
        let conn = self.conn.lock();
        let r = conn
            .query_row(
                "SELECT id, reflection_date, learned, noticed, wants, raw_text, created_at
                 FROM daily_reflections ORDER BY reflection_date DESC LIMIT 1",
                [],
                |row| {
                    Ok(DailyReflection {
                        id: row.get(0)?,
                        reflection_date: row.get(1)?,
                        learned: row.get(2)?,
                        noticed: row.get(3)?,
                        wants: row.get(4)?,
                        raw_text: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                },
            )
            .optional()?;
        Ok(r)
    }

    // ------- Event log -------
    pub fn log_event(&self, event_type: &str, payload: Option<&str>, salience: Option<i32>) -> AppResult<EventLogEntry> {
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO event_log (id, event_type, payload_json, salience, handled, created_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![id, event_type, payload, salience, now],
        )?;
        Ok(EventLogEntry {
            id,
            event_type: event_type.to_string(),
            payload_json: payload.map(|s| s.to_string()),
            salience,
            handled: false,
            created_at: now,
        })
    }

    pub fn recent_events(&self, limit: i64) -> AppResult<Vec<EventLogEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, payload_json, salience, handled, created_at
             FROM event_log ORDER BY created_at DESC LIMIT ?1",
        )?;
        let iter = stmt.query_map(params![limit], |row| {
            Ok(EventLogEntry {
                id: row.get(0)?,
                event_type: row.get(1)?,
                payload_json: row.get(2)?,
                salience: row.get(3)?,
                handled: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
            })
        })?;
        Ok(collect_tolerant(iter, "event_log"))
    }

    // ------- Skills -------
    pub fn upsert_skill(&self, skill: &Skill) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO skills (id, name, description, permissions_json, enabled, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                description=excluded.description,
                permissions_json=excluded.permissions_json,
                enabled=excluded.enabled",
            params![
                skill.id,
                skill.name,
                skill.description,
                skill.permissions_json,
                if skill.enabled { 1 } else { 0 },
                skill.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_skills(&self) -> AppResult<Vec<Skill>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, permissions_json, enabled, created_at FROM skills ORDER BY name",
        )?;
        let iter = stmt.query_map([], |row| {
            Ok(Skill {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                permissions_json: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
            })
        })?;
        Ok(collect_tolerant(iter, "skills"))
    }

    // ------- Settings -------
    pub fn get_setting(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock();
        let val = conn
            .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get::<_, String>(0))
            .optional()?;
        Ok(val)
    }

    pub fn put_setting(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![key, value, now_rfc3339()],
        )?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}

/// Collect rows from a `query_map` iterator, skipping any individual rows that
/// fail to decode (e.g. a corrupt cell with a wrong-type value, or NULL where a
/// non-null type is expected). Connection-level / query-level errors are caught
/// upstream by the `?` on `query_map`; only per-row decode failures are tolerated
/// here. PRD §10.2: corrupt records must be ignored or repairable.
fn collect_tolerant<I, T>(iter: I, table: &str) -> Vec<T>
where
    I: IntoIterator<Item = rusqlite::Result<T>>,
{
    let mut out = Vec::new();
    let mut skipped = 0_usize;
    for row in iter {
        match row {
            Ok(v) => out.push(v),
            Err(e) => {
                skipped += 1;
                log::warn!("skipping corrupt row in {}: {}", table, e);
            }
        }
    }
    if skipped > 0 {
        log::warn!("skipped {} corrupt row(s) loading {}", skipped, table);
    }
    out
}

fn map_interaction(row: &rusqlite::Row<'_>) -> rusqlite::Result<Interaction> {
    Ok(Interaction {
        id: row.get(0)?,
        event_type: row.get(1)?,
        user_input: row.get(2)?,
        pet_response: row.get(3)?,
        mood: row.get(4)?,
        state_snapshot_json: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn map_memory(row: &rusqlite::Row<'_>) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: row.get(0)?,
        r#type: row.get(1)?,
        content: row.get(2)?,
        importance: row.get(3)?,
        confidence: row.get(4)?,
        source_interaction_id: row.get(5)?,
        created_at: row.get(6)?,
        last_accessed_at: row.get(7)?,
        decay_score: row.get(8)?,
    })
}

fn scored(m: &Memory, now: chrono::DateTime<chrono::Utc>) -> f32 {
    let recency = parse_timestamp(&m.created_at)
        .map(|t| {
            let age_days = (now - t).num_seconds() as f32 / 86_400.0;
            (-age_days / 30.0).exp()
        })
        .unwrap_or(0.5);
    let importance_norm = (m.importance.clamp(1, 10) as f32) / 10.0;
    let confidence = m.confidence.clamp(0.0, 1.0);
    (importance_norm * 0.4) + (recency * 0.3) + (confidence * 0.3) + (m.decay_score * 0.0)
}

/// Sanitize a free-form query for FTS5 — strip unsafe characters and turn each
/// term into a prefix match so partial words still hit (e.g. "Type" → "TypeScript").
fn sanitize_fts_query(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect();
    let terms: Vec<String> = cleaned
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|t| format!("\"{}\"*", t))
        .collect();
    if terms.is_empty() {
        "\"\"".to_string()
    } else {
        terms.join(" OR ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Db {
        Db::open_in_memory().unwrap()
    }

    #[test]
    fn pet_state_round_trip() {
        let db = fresh();
        let state = PetState::new("Mochi");
        db.save_pet_state(&state).unwrap();
        let loaded = db.load_pet_state("default").unwrap().unwrap();
        assert_eq!(loaded.name, "Mochi");
        assert_eq!(loaded.energy, 80);
    }

    /// PRD §21.3 acceptance: `last_interaction_at` must survive a process
    /// restart and the derived "away minutes" must be computed from that
    /// persisted timestamp, not from session start.
    ///
    /// Simulates a restart by saving to a tempdir DB, dropping the Db (which
    /// closes the rusqlite Connection), and re-opening at the same path.
    #[test]
    fn last_interaction_at_persists_across_restart_and_drives_away_minutes() {
        use chrono::Duration;

        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("mochi.sqlite");

        // Pretend the user last interacted 90 minutes ago.
        let away_minutes_expected: i64 = 90;
        let saved_at = Utc::now() - Duration::minutes(away_minutes_expected);
        let saved_at_iso = saved_at.to_rfc3339();

        // --- Pre-restart: save a state with last_interaction_at set ---
        {
            let db = Db::open(&db_path).unwrap();
            let mut state = PetState::new("Mochi");
            state.id = "default".to_string();
            state.last_interaction_at = Some(saved_at_iso.clone());
            db.save_pet_state(&state).unwrap();
            // db drops here, closing the connection.
        }

        // --- Post-restart: re-open and verify the timestamp survived ---
        let db = Db::open(&db_path).unwrap();
        let loaded = db
            .load_pet_state("default")
            .unwrap()
            .expect("pet state must be present after restart");

        assert_eq!(
            loaded.last_interaction_at.as_deref(),
            Some(saved_at_iso.as_str()),
            "last_interaction_at must round-trip byte-for-byte"
        );

        // Compute away minutes from the persisted timestamp the same way the
        // app would (parse + diff against now).
        let parsed = parse_timestamp(loaded.last_interaction_at.as_deref().unwrap())
            .expect("persisted timestamp must parse as RFC3339");
        let away_minutes = (Utc::now() - parsed).num_seconds() as f64 / 60.0;

        let drift = (away_minutes - away_minutes_expected as f64).abs();
        assert!(
            drift <= 1.0,
            "away minutes derived from persisted timestamp should be ~{} (got {:.3}, drift {:.3})",
            away_minutes_expected,
            away_minutes,
            drift,
        );
    }

    #[test]
    fn memory_create_and_search() {
        let db = fresh();
        db.create_memory(NewMemory {
            r#type: "preference".into(),
            content: "user prefers dark mode".into(),
            importance: Some(5),
            confidence: Some(0.9),
            source_interaction_id: None,
        })
        .unwrap();
        db.create_memory(NewMemory {
            r#type: "user_fact".into(),
            content: "user lives in Seoul".into(),
            importance: Some(3),
            confidence: Some(0.8),
            source_interaction_id: None,
        })
        .unwrap();

        let results = db.search_memories("dark mode", 10).unwrap();
        assert!(results.iter().any(|m| m.content.contains("dark mode")));
    }

    #[test]
    fn fts_query_safe_against_special_chars() {
        let db = fresh();
        db.create_memory(NewMemory {
            r#type: "preference".into(),
            content: "uses TypeScript".into(),
            importance: Some(2),
            confidence: Some(0.7),
            source_interaction_id: None,
        })
        .unwrap();
        // Special chars must not crash FTS.
        let results = db.search_memories("Type*Script!()", 5).unwrap();
        assert!(!results.is_empty());
    }

    #[test]
    fn delete_memory_works() {
        let db = fresh();
        let m = db
            .create_memory(NewMemory {
                r#type: "preference".into(),
                content: "likes tea".into(),
                importance: Some(1),
                confidence: Some(0.7),
                source_interaction_id: None,
            })
            .unwrap();
        db.delete_memory(&m.id).unwrap();
        let all = db.list_memories(10).unwrap();
        assert!(all.is_empty());
    }

    #[test]
    fn settings_round_trip() {
        let db = fresh();
        db.put_setting("foo", "bar").unwrap();
        assert_eq!(db.get_setting("foo").unwrap(), Some("bar".to_string()));
        db.put_setting("foo", "baz").unwrap();
        assert_eq!(db.get_setting("foo").unwrap(), Some("baz".to_string()));
    }

    #[test]
    fn event_log_records_events() {
        let db = fresh();
        db.log_event("APP_STARTED", None, Some(50)).unwrap();
        db.log_event("USER_CLICKED_PET", Some("{}"), Some(20)).unwrap();
        let recent = db.recent_events(10).unwrap();
        assert_eq!(recent.len(), 2);
    }

    /// PRD §10.2: a single corrupt memory row must not abort the whole load.
    /// We insert one well-formed row and one row whose `importance` cell holds a
    /// non-numeric string, which fails rusqlite's `i32` decoding for that row only.
    #[test]
    fn list_memories_skips_corrupt_rows() {
        let db = fresh();
        // Well-formed row via the normal API.
        db.create_memory(NewMemory {
            r#type: "preference".into(),
            content: "good row".into(),
            importance: Some(5),
            confidence: Some(0.9),
            source_interaction_id: None,
        })
        .unwrap();

        // Corrupt row: bypass the API and stuff a non-numeric string into the
        // INTEGER column (SQLite is dynamically typed, so it stores it as TEXT).
        {
            let conn = db.conn.lock();
            conn.execute(
                "INSERT INTO memories (id, type, content, importance, confidence, source_interaction_id, created_at, last_accessed_at, decay_score)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    "corrupt-1",
                    "preference",
                    "bad row",
                    "not-a-number",   // wrong type for i32
                    0.5_f32,
                    Option::<String>::None,
                    "2024-01-01T00:00:00Z",
                    "2024-01-01T00:00:00Z",
                    1.0_f32,
                ],
            ).unwrap();
        }

        // Loader must succeed and return only the well-formed row.
        let rows = db.list_memories(10).expect("loader must not error on corrupt row");
        assert_eq!(rows.len(), 1, "exactly the good row should survive");
        assert_eq!(rows[0].content, "good row");

        // search_memories shares the same tolerance path (fallback LIKE branch
        // when FTS misses). The corrupt row was indexed by the FTS trigger, so
        // a query that matches "bad" should still return zero rows without
        // erroring; "good" should return exactly the good row.
        let bad_search = db.search_memories("bad", 10).expect("must not error");
        assert!(
            bad_search.iter().all(|m| m.content != "bad row"),
            "corrupt row must never be returned"
        );
        let good_search = db.search_memories("good", 10).expect("must not error");
        assert_eq!(good_search.len(), 1);
        assert_eq!(good_search[0].content, "good row");
    }

    /// Same shape for interactions: insert one good + one with non-string `id`
    /// (NULL where the struct expects `String`), loader returns the good row only.
    #[test]
    fn recent_interactions_skips_corrupt_rows() {
        let db = fresh();
        db.create_interaction(NewInteraction {
            event_type: "chat".into(),
            user_input: Some("hi".into()),
            pet_response: Some("hello".into()),
            mood: Some("happy".into()),
            state_snapshot_json: Some("{\"ok\":true}".into()),
        })
        .unwrap();

        // Corrupt row: NULL id where the model declares `id: String` (non-Option).
        {
            let conn = db.conn.lock();
            conn.execute(
                "INSERT INTO interactions (id, event_type, user_input, pet_response, mood, state_snapshot_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    Option::<String>::None,  // NULL where String is required
                    "chat",
                    Option::<String>::None,
                    Option::<String>::None,
                    Option::<String>::None,
                    "{not valid json",  // also malformed JSON, but we don't parse it
                    "2024-01-01T00:00:00Z",
                ],
            ).unwrap();
        }

        let rows = db.recent_interactions(10).expect("loader must not error");
        assert_eq!(rows.len(), 1, "only the well-formed interaction survives");
        assert_eq!(rows[0].user_input.as_deref(), Some("hi"));
    }

    /// Event log: NULL `handled` column where the loader expects an `i64`.
    /// (`event_type` is NOT NULL at the schema level, so we corrupt the
    /// `handled` cell instead — this still hits the per-row decode failure path.)
    #[test]
    fn recent_events_skips_corrupt_rows() {
        let db = fresh();
        db.log_event("APP_STARTED", None, Some(50)).unwrap();
        {
            let conn = db.conn.lock();
            conn.execute(
                "INSERT INTO event_log (id, event_type, payload_json, salience, handled, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    "evt-corrupt",
                    "BAD_EVENT",
                    "{not json",            // we don't parse this column; harmless
                    Option::<i32>::None,
                    Option::<i64>::None,    // NULL where i64 is required
                    "2024-01-01T00:00:00Z",
                ],
            ).unwrap();
        }
        let rows = db.recent_events(10).expect("loader must not error");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].event_type, "APP_STARTED");
    }

    /// Skills loader: NULL `enabled` column where the loader expects an `i64`.
    /// (`permissions_json` is NOT NULL at the schema level.)
    #[test]
    fn list_skills_skips_corrupt_rows() {
        let db = fresh();
        db.upsert_skill(&Skill {
            id: "skill-1".into(),
            name: "Notes".into(),
            description: Some("write notes".into()),
            permissions_json: "[]".into(),
            enabled: true,
            created_at: "2024-01-01T00:00:00Z".into(),
        }).unwrap();
        {
            let conn = db.conn.lock();
            conn.execute(
                "INSERT INTO skills (id, name, description, permissions_json, enabled, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    "skill-corrupt",
                    "Bad",
                    Option::<String>::None,
                    "{not valid",          // permissions_json is opaque text, not parsed at load
                    Option::<i64>::None,   // NULL where i64 is required → per-row decode fails
                    "2024-01-01T00:00:00Z",
                ],
            ).unwrap();
        }
        let rows = db.list_skills().expect("loader must not error");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Notes");
    }
}
