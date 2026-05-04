use crate::llm::prompts::ValidatedStatusReport;
use crate::models::{parse_timestamp, EventLogEntry, Interaction, Memory, PetState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Summary statistics over a 12-hour idle window (PRD §9.8 / REQ-075).
/// Sent to the LLM in place of raw events so prompts stay small and the
/// surface area for prompt-injection from logged user input is minimized.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSummary {
    /// RFC3339 — start of the analyzed window.
    pub window_start: String,
    /// RFC3339 — end of the analyzed window (= report fire time).
    pub window_end: String,
    /// Length of the window in hours, used for interaction-rate normalization.
    /// Always > 0; `summarize_window` clamps to 0.5h minimum to avoid divide-by-zero.
    pub window_hours: f32,
    /// Event-type → count, sorted descending by count for stable rendering.
    pub event_counts: Vec<(String, u32)>,
    /// Sum of `salience` over all events in the window. None salience contributes 0.
    pub salience_sum: i64,
    /// Mood (from `interactions.mood`) → count.
    pub mood_dist: Vec<(String, u32)>,
    /// User interactions per hour over the window.
    pub interaction_rate: f32,
    /// Up to 3 most-relevant memories, already ranked by the caller.
    pub top_memories: Vec<MemoryDigest>,
    /// Total interaction count, used by deterministic fallback templates.
    pub interaction_count: u32,
}

/// Compact memory shape for the prompt — keeps the LLM payload small and
/// avoids leaking internal IDs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDigest {
    pub r#type: String,
    pub content: String,
    pub importance: i32,
}

impl From<&Memory> for MemoryDigest {
    fn from(m: &Memory) -> Self {
        Self {
            r#type: m.r#type.clone(),
            content: m.content.clone(),
            importance: m.importance,
        }
    }
}

/// Compute summary statistics for a 12h window. Pure: caller pre-filters
/// events/interactions to the window and pre-ranks memories. The function
/// only counts and bucketizes — it does not sort by relevance or decide
/// which events "matter".
///
/// `top_memories` should already be capped at 3 by the caller so the prompt
/// stays compact; this function only enforces an upper bound, not a lower.
pub fn summarize_window(
    events: &[EventLogEntry],
    interactions: &[Interaction],
    top_memories: &[Memory],
    window_start: &str,
    window_end: &str,
) -> WindowSummary {
    // Event-type counts, sorted desc by count for stable, readable output.
    let mut event_counts_map: HashMap<&str, u32> = HashMap::new();
    let mut salience_sum: i64 = 0;
    for e in events {
        *event_counts_map.entry(e.event_type.as_str()).or_insert(0) += 1;
        salience_sum += e.salience.unwrap_or(0) as i64;
    }
    let mut event_counts: Vec<(String, u32)> = event_counts_map
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    event_counts.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    // Mood distribution from interactions (skips interactions with NULL mood).
    let mut mood_map: HashMap<&str, u32> = HashMap::new();
    for ix in interactions {
        if let Some(m) = ix.mood.as_deref() {
            *mood_map.entry(m).or_insert(0) += 1;
        }
    }
    let mut mood_dist: Vec<(String, u32)> = mood_map
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    mood_dist.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    // Window length in hours — clamped to 0.5h minimum so a malformed or
    // very short window doesn't produce an absurd interactions/hour rate.
    let window_hours = window_hours(window_start, window_end).max(0.5);
    let interaction_rate = interactions.len() as f32 / window_hours;

    // Cap memories at 3 — REQ-075 says "top-3", caller may have passed more.
    let top_memories: Vec<MemoryDigest> = top_memories
        .iter()
        .take(3)
        .map(MemoryDigest::from)
        .collect();

    WindowSummary {
        window_start: window_start.to_string(),
        window_end: window_end.to_string(),
        window_hours,
        event_counts,
        salience_sum,
        mood_dist,
        interaction_rate,
        top_memories,
        interaction_count: interactions.len() as u32,
    }
}

fn window_hours(start: &str, end: &str) -> f32 {
    match (parse_timestamp(start), parse_timestamp(end)) {
        (Some(s), Some(e)) => {
            let secs = (e - s).num_seconds();
            (secs as f32 / 3600.0).max(0.0)
        }
        _ => 0.0,
    }
}

/// One compact tally line per event_type, e.g. "USER_FED_PET × 3".
/// Output is sorted by descending count so the most frequent show first.
/// Pure: caller filters the time window before passing in.
pub fn compress_events_for_report(events: &[EventLogEntry]) -> String {
    if events.is_empty() {
        return "(no events in window)".to_string();
    }
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for e in events {
        *counts.entry(e.event_type.as_str()).or_insert(0) += 1;
    }
    let mut pairs: Vec<(&str, u32)> = counts.into_iter().collect();
    // Sort by count desc, then event_type asc for stable output.
    pairs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    pairs
        .into_iter()
        .map(|(k, n)| format!("- {k} × {n}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// REQ-076 deterministic fallback. Produces a `ValidatedStatusReport` from
/// summary statistics alone — no LLM, no network. Cadence MUST be preserved
/// even when Ollama is offline; this is what runs in that case.
///
/// Prose length is tuned to land in the 180-440 char window the validator
/// accepts so the same downstream code path can persist the result.
pub fn deterministic_status_report(
    pet: &PetState,
    summary: &WindowSummary,
) -> ValidatedStatusReport {
    let learned = derive_learned(summary);
    let noticed = derive_noticed(summary);
    let wants = derive_wants(pet, summary);
    let prose = derive_prose(pet, summary);

    ValidatedStatusReport {
        learned: Some(learned),
        noticed: Some(noticed),
        wants: Some(wants),
        prose,
    }
}

fn derive_learned(s: &WindowSummary) -> String {
    if let Some((event, count)) = s.event_counts.first() {
        let label = friendly_event_label(event);
        return format!("we did {} {} together", count, label);
    }
    "the day was quiet".to_string()
}

fn derive_noticed(s: &WindowSummary) -> String {
    if let Some((mood, _count)) = s.mood_dist.first() {
        return format!("the user mostly seemed {}", mood);
    }
    if s.interaction_count == 0 {
        return "the user was busy elsewhere".to_string();
    }
    format!("we shared about {:.1} moments per hour", s.interaction_rate)
}

fn derive_wants(pet: &PetState, s: &WindowSummary) -> String {
    // Pick a small intention based on the dominant mood + pet stats.
    let dominant_mood = s.mood_dist.first().map(|(m, _)| m.as_str()).unwrap_or("");
    match (dominant_mood, pet.energy, pet.affection) {
        ("tired",  _, _)         => "let the user rest a little longer".to_string(),
        ("bored",  _, _)         => "find something gently surprising".to_string(),
        ("lonely", _, _)         => "stay closer to the cursor".to_string(),
        ("hungry", _, _)         => "remember which snacks made them smile".to_string(),
        (_, e, _) if e < 30      => "nap when they nap".to_string(),
        (_, _, a) if a < 30      => "earn one more pat".to_string(),
        _                         => "keep the next twelve hours soft".to_string(),
    }
}

fn derive_prose(pet: &PetState, s: &WindowSummary) -> String {
    // Build a 200-300 char paragraph from stats. The validator accepts 180+,
    // so we aim for ~240 to leave headroom.
    let mood_phrase = s
        .mood_dist
        .first()
        .map(|(m, n)| format!("Most of the window felt {} ({} moments).", m, n))
        .unwrap_or_else(|| "The window had no clear mood.".to_string());

    let activity_phrase = if s.interaction_count == 0 {
        format!("{} sat quietly while the user worked elsewhere.", pet.name)
    } else if s.interaction_count == 1 {
        format!("{} and the user shared one small moment.", pet.name)
    } else {
        format!(
            "{} and the user shared {} small moments — about {:.1} an hour.",
            pet.name, s.interaction_count, s.interaction_rate
        )
    };

    let event_phrase = if let Some((kind, n)) = s.event_counts.first() {
        format!("The most-repeated thing was {} ({} times).", friendly_event_label(kind), n)
    } else {
        "Nothing big happened.".to_string()
    };

    let memory_phrase = if let Some(m) = s.top_memories.first() {
        let snippet = first_words(&m.content, 8);
        format!("Mochi kept thinking about: {}.", snippet)
    } else {
        "Mochi has no strong memories yet.".to_string()
    };

    let mut prose = format!(
        "{} {} {} {} A calm, ordinary stretch of time.",
        activity_phrase, mood_phrase, event_phrase, memory_phrase
    );

    // Pad to floor (180 chars) if too short, trim to ceiling (440) if somehow
    // too long. Pure deterministic; never panics.
    while prose.chars().count() < 200 {
        prose.push_str(" Soft minutes between the bigger ones.");
    }
    let chars: Vec<char> = prose.chars().collect();
    if chars.len() > 420 {
        // Hard cap with an ellipsis so the boundary is human-readable.
        let mut out: String = chars.iter().take(417).collect();
        out.push_str("...");
        return out;
    }
    prose
}

fn friendly_event_label(event_type: &str) -> &'static str {
    match event_type {
        "USER_FED_PET"          => "snacks",
        "USER_PLAYED_WITH_PET"  => "play",
        "USER_CLICKED_PET"      => "pats",
        "USER_PUT_PET_TO_REST"  => "naps",
        "USER_SENT_MESSAGE"     => "chats",
        "USER_RETURNED"         => "reunions",
        "FILE_FOUND_IN_INBOX"   => "letters",
        _                        => "moments",
    }
}

fn first_words(s: &str, n: usize) -> String {
    let words: Vec<&str> = s.split_whitespace().take(n).collect();
    let joined = words.join(" ");
    if s.split_whitespace().count() > n {
        format!("{}…", joined)
    } else {
        joined
    }
}

/// Fallback report text used when the LLM is unavailable. Always returns
/// something cute and useful — never empty, never an error.
pub fn canned_report_text(pet: &PetState, events: &[EventLogEntry]) -> String {
    if events.is_empty() {
        return format!("{} sat quietly. A peaceful little stretch of time. ✨", pet.name);
    }
    // Pick out the most prominent action types for a friendly one-liner.
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for e in events {
        *counts.entry(e.event_type.as_str()).or_insert(0) += 1;
    }
    let fed   = counts.get("USER_FED_PET").copied().unwrap_or(0);
    let play  = counts.get("USER_PLAYED_WITH_PET").copied().unwrap_or(0);
    let pat   = counts.get("USER_CLICKED_PET").copied().unwrap_or(0);
    let rest  = counts.get("USER_PUT_PET_TO_REST").copied().unwrap_or(0);
    let total = events.len();

    let highlights = [
        ("snacks",  fed),
        ("playing", play),
        ("pats",    pat),
        ("naps",    rest),
    ];
    let parts: Vec<String> = highlights
        .iter()
        .filter(|(_, n)| *n > 0)
        .map(|(label, n)| format!("{n} {label}"))
        .collect();

    if parts.is_empty() {
        format!(
            "{} and you shared {total} little moments. Quiet, but together. ♥",
            pet.name,
            total = total
        )
    } else {
        format!(
            "{name} and you shared {parts}. A cozy {total}-moment stretch. ♥",
            name = pet.name,
            parts = parts.join(", "),
            total = total,
        )
    }
}

/// Build the markdown body that gets written to `notes/`. Header has a friendly
/// title, then the LLM/canned text, then a raw event tally so the file is
/// useful even without the LLM line.
pub fn build_report_markdown(
    pet: &PetState,
    summary_text: &str,
    events: &[EventLogEntry],
    now_rfc3339: &str,
) -> String {
    let date_part = now_rfc3339.split('T').next().unwrap_or(now_rfc3339);
    let tally = compress_events_for_report(events);
    format!(
        "# 📔 Time with {name} — {date}\n\n{summary}\n\n## What we did\n\n{tally}\n\n_mood: {mood} · bond: ♥ {bond} · written: {ts}_\n",
        name = pet.name,
        date = date_part,
        summary = summary_text.trim(),
        tally = tally,
        mood = pet.mood,
        bond = pet.relationship_level,
        ts = now_rfc3339,
    )
}

/// File-name slug like `report-2026-05-03-2110.md`. Cross-platform safe
/// (no `:` or `+`). Pure: caller passes the timestamp.
pub fn report_filename(now_rfc3339: &str) -> String {
    // RFC3339 looks like "2026-05-03T21:10:42+09:00".
    // We want "report-2026-05-03-2110.md" — strip seconds and tz, drop separators.
    let mut date = "0000-00-00".to_string();
    let mut hhmm = "0000".to_string();

    if let Some((d, rest)) = now_rfc3339.split_once('T') {
        date = d.to_string();
        // rest looks like "21:10:42+09:00" — take the first two HH:MM groups.
        let mut parts = rest.split(':');
        let hh = parts.next().unwrap_or("00");
        let mm = parts.next().unwrap_or("00");
        // mm may have trailing seconds attached; keep only the first two digits.
        let mm: String = mm.chars().take(2).collect();
        hhmm = format!("{hh}{mm}");
    }
    format!("report-{date}-{hhmm}.md")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::EventLogEntry;

    fn evt(t: &str, ts: &str) -> EventLogEntry {
        EventLogEntry {
            id: format!("id-{ts}"),
            event_type: t.to_string(),
            payload_json: None,
            salience: Some(20),
            handled: false,
            created_at: ts.to_string(),
        }
    }

    fn sample() -> Vec<EventLogEntry> {
        vec![
            evt("USER_FED_PET",          "2026-05-03T10:00:00Z"),
            evt("USER_FED_PET",          "2026-05-03T11:00:00Z"),
            evt("USER_PLAYED_WITH_PET",  "2026-05-03T12:00:00Z"),
            evt("USER_CLICKED_PET",      "2026-05-03T13:00:00Z"),
            evt("USER_CLICKED_PET",      "2026-05-03T13:30:00Z"),
            evt("USER_CLICKED_PET",      "2026-05-03T14:00:00Z"),
        ]
    }

    #[test]
    fn compress_groups_and_counts() {
        let out = compress_events_for_report(&sample());
        assert!(out.contains("USER_CLICKED_PET"));
        assert!(out.contains("× 3"));
        assert!(out.contains("USER_FED_PET"));
        assert!(out.contains("× 2"));
        assert!(out.contains("USER_PLAYED_WITH_PET"));
        assert!(out.contains("× 1"));
    }

    #[test]
    fn compress_orders_by_count_desc() {
        let out = compress_events_for_report(&sample());
        let click_pos = out.find("USER_CLICKED_PET").expect("clicked present");
        let fed_pos   = out.find("USER_FED_PET").expect("fed present");
        let play_pos  = out.find("USER_PLAYED_WITH_PET").expect("play present");
        assert!(click_pos < fed_pos, "clicked (3) should come before fed (2)");
        assert!(fed_pos < play_pos, "fed (2) should come before play (1)");
    }

    #[test]
    fn compress_handles_empty_input() {
        let out = compress_events_for_report(&[]);
        // Must still be a printable hint string, not panic, not empty.
        assert!(!out.is_empty());
    }

    #[test]
    fn canned_report_includes_pet_name_and_is_short() {
        let pet = PetState::new("Mochi");
        let text = canned_report_text(&pet, &sample());
        assert!(text.contains("Mochi"), "canned text should name the pet");
        // Cute & concise — keep it under ~200 chars so the bubble fits.
        assert!(text.len() < 280, "canned report should be brief, got {} chars", text.len());
    }

    #[test]
    fn canned_report_handles_zero_events() {
        let pet = PetState::new("Mochi");
        let text = canned_report_text(&pet, &[]);
        // Should still be cute and never empty.
        assert!(!text.is_empty());
        assert!(text.contains("Mochi"));
    }

    #[test]
    fn markdown_has_title_summary_and_tally() {
        let pet = PetState::new("Mochi");
        let md = build_report_markdown(
            &pet,
            "We had a sweet quiet morning together. ✨",
            &sample(),
            "2026-05-03T21:10:00Z",
        );
        assert!(md.starts_with("# "), "should start with an h1 title");
        assert!(md.contains("Mochi"));
        assert!(md.contains("2026-05-03"));
        assert!(md.contains("We had a sweet quiet morning"));
        assert!(md.contains("USER_CLICKED_PET"));
    }

    #[test]
    fn report_filename_is_filesystem_safe() {
        let name = report_filename("2026-05-03T21:10:42+09:00");
        assert!(name.starts_with("report-"));
        assert!(name.ends_with(".md"));
        assert!(!name.contains(':'), "must avoid ':' (Windows)");
        assert!(!name.contains('+'));
        assert!(!name.contains('/'));
    }

    // ----- §9.8 / REQ-075 window summary -----

    use crate::models::{Interaction, Memory};

    fn ix(event: &str, mood: Option<&str>, ts: &str) -> Interaction {
        Interaction {
            id: format!("ix-{ts}"),
            event_type: event.to_string(),
            user_input: None,
            pet_response: None,
            mood: mood.map(String::from),
            state_snapshot_json: None,
            created_at: ts.to_string(),
        }
    }

    fn mem(content: &str, importance: i32) -> Memory {
        Memory {
            id: format!("mem-{content}"),
            r#type: "preference".to_string(),
            content: content.to_string(),
            importance,
            confidence: 0.8,
            source_interaction_id: None,
            created_at: "2026-05-03T00:00:00Z".to_string(),
            last_accessed_at: None,
            decay_score: 1.0,
        }
    }

    #[test]
    fn summarize_window_counts_events_and_sums_salience() {
        let events = sample();  // 6 events, salience 20 each
        let s = summarize_window(
            &events,
            &[],
            &[],
            "2026-05-03T08:00:00Z",
            "2026-05-03T20:00:00Z",
        );
        assert_eq!(s.salience_sum, 6 * 20);
        // event_counts sorted desc by count then asc by name
        assert_eq!(s.event_counts[0].0, "USER_CLICKED_PET");
        assert_eq!(s.event_counts[0].1, 3);
        assert_eq!(s.event_counts[1].0, "USER_FED_PET");
        assert_eq!(s.event_counts[1].1, 2);
        assert_eq!(s.event_counts[2].0, "USER_PLAYED_WITH_PET");
        assert_eq!(s.event_counts[2].1, 1);
    }

    #[test]
    fn summarize_window_buckets_mood_distribution() {
        let interactions = vec![
            ix("chat", Some("happy"),  "2026-05-03T10:00:00Z"),
            ix("chat", Some("happy"),  "2026-05-03T11:00:00Z"),
            ix("chat", Some("bored"),  "2026-05-03T12:00:00Z"),
            ix("chat", None,           "2026-05-03T13:00:00Z"), // skipped
        ];
        let s = summarize_window(
            &[],
            &interactions,
            &[],
            "2026-05-03T08:00:00Z",
            "2026-05-03T20:00:00Z",
        );
        // happy=2, bored=1; null mood ignored
        assert_eq!(s.mood_dist.len(), 2);
        assert_eq!(s.mood_dist[0], ("happy".to_string(), 2));
        assert_eq!(s.mood_dist[1], ("bored".to_string(), 1));
    }

    #[test]
    fn summarize_window_caps_top_memories_at_three() {
        let mems = vec![
            mem("a", 9),
            mem("b", 8),
            mem("c", 7),
            mem("d", 6), // must be dropped
            mem("e", 5),
        ];
        let s = summarize_window(
            &[],
            &[],
            &mems,
            "2026-05-03T08:00:00Z",
            "2026-05-03T20:00:00Z",
        );
        assert_eq!(s.top_memories.len(), 3);
        assert_eq!(s.top_memories[0].content, "a");
        assert_eq!(s.top_memories[2].content, "c");
    }

    #[test]
    fn summarize_window_handles_empty_window() {
        let s = summarize_window(
            &[],
            &[],
            &[],
            "2026-05-03T08:00:00Z",
            "2026-05-03T20:00:00Z",
        );
        assert!(s.event_counts.is_empty());
        assert!(s.mood_dist.is_empty());
        assert_eq!(s.salience_sum, 0);
        assert_eq!(s.interaction_count, 0);
        assert_eq!(s.interaction_rate, 0.0);
        // 12h window
        assert!((s.window_hours - 12.0).abs() < 0.01);
    }

    #[test]
    fn summarize_window_clamps_window_hours_to_avoid_divide_by_zero() {
        // Identical timestamps would give 0h; clamp protects rate calc.
        let interactions = vec![ix("chat", Some("happy"), "2026-05-03T10:00:00Z")];
        let s = summarize_window(
            &[],
            &interactions,
            &[],
            "2026-05-03T10:00:00Z",
            "2026-05-03T10:00:00Z",
        );
        // Clamped to 0.5h → 1 interaction / 0.5h = 2.0 rate
        assert!(
            s.interaction_rate.is_finite() && s.interaction_rate > 0.0,
            "interaction_rate must be finite and > 0, got {}",
            s.interaction_rate
        );
        assert_eq!(s.window_hours, 0.5);
    }

    // ----- §9.8 / REQ-076 deterministic fallback -----

    #[test]
    fn deterministic_report_prose_lands_inside_validator_window() {
        // The validator (prompts::validate_status_report_json) accepts 180-440
        // chars. The deterministic generator MUST produce something parseable
        // by the same code path so the cadence survives an LLM outage.
        let summary = summarize_window(
            &sample(),  // 6 events
            &[
                ix("chat", Some("happy"), "2026-05-03T10:00:00Z"),
                ix("chat", Some("happy"), "2026-05-03T11:00:00Z"),
            ],
            &[mem("user prefers tea", 5)],
            "2026-05-03T08:00:00Z",
            "2026-05-03T20:00:00Z",
        );
        let pet = PetState::new("Mochi");
        let r = deterministic_status_report(&pet, &summary);
        let len = r.prose.chars().count();
        assert!(
            (180..=440).contains(&len),
            "prose length must be inside validator window, got {}",
            len
        );
        assert!(r.learned.is_some());
        assert!(r.noticed.is_some());
        assert!(r.wants.is_some());
    }

    #[test]
    fn deterministic_report_handles_empty_window() {
        let summary = summarize_window(
            &[],
            &[],
            &[],
            "2026-05-03T08:00:00Z",
            "2026-05-03T20:00:00Z",
        );
        let pet = PetState::new("Mochi");
        let r = deterministic_status_report(&pet, &summary);
        // Even with no data, prose must exist and pass validator length.
        let len = r.prose.chars().count();
        assert!((180..=440).contains(&len), "got {len}");
        assert!(r.prose.contains("Mochi"));
    }

    #[test]
    fn deterministic_report_picks_event_label_friendly() {
        let summary = summarize_window(
            &sample(),
            &[],
            &[],
            "2026-05-03T08:00:00Z",
            "2026-05-03T20:00:00Z",
        );
        let pet = PetState::new("Mochi");
        let r = deterministic_status_report(&pet, &summary);
        // "USER_CLICKED_PET" should render as "pats" — never as the raw
        // event type name (the prose is human-readable, not log output).
        assert!(
            r.prose.contains("pats") || r.prose.contains("snacks"),
            "expected friendly event label in prose, got: {}",
            r.prose
        );
        assert!(
            !r.prose.contains("USER_CLICKED_PET"),
            "raw event type names must not leak into prose"
        );
    }

    #[test]
    fn deterministic_wants_reflects_dominant_mood() {
        let summary = summarize_window(
            &[],
            &[
                ix("chat", Some("lonely"), "2026-05-03T10:00:00Z"),
                ix("chat", Some("lonely"), "2026-05-03T11:00:00Z"),
                ix("chat", Some("happy"),  "2026-05-03T12:00:00Z"),
            ],
            &[],
            "2026-05-03T08:00:00Z",
            "2026-05-03T20:00:00Z",
        );
        let pet = PetState::new("Mochi");
        let r = deterministic_status_report(&pet, &summary);
        let wants = r.wants.unwrap();
        assert!(
            wants.contains("cursor") || wants.contains("close"),
            "lonely-dominated window should suggest a close-by intention, got: {}",
            wants
        );
    }

    #[test]
    fn summarize_window_computes_per_hour_rate() {
        // 6 interactions across a 12h window → 0.5 / hour
        let interactions: Vec<Interaction> = (0..6)
            .map(|i| ix("chat", Some("happy"), &format!("2026-05-03T{:02}:00:00Z", 8 + i)))
            .collect();
        let s = summarize_window(
            &[],
            &interactions,
            &[],
            "2026-05-03T08:00:00Z",
            "2026-05-03T20:00:00Z",
        );
        assert_eq!(s.interaction_count, 6);
        assert!((s.interaction_rate - 0.5).abs() < 0.01);
    }
}
