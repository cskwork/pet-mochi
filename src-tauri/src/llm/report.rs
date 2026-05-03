use crate::models::{EventLogEntry, PetState};
use std::collections::HashMap;

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
}
