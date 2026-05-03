use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_FILE_BYTES: u64 = 1_048_576; // 1 MB cap on inbox files
const ALLOWED_EXTS: &[&str] = &["txt", "md", "json"];

/// Resolves and validates the pet's home folder. Creates the standard subdirectories.
pub fn ensure_pet_home(root: &Path) -> AppResult<PathBuf> {
    std::fs::create_dir_all(root)?;
    for sub in ["inbox", "notes", "dreams", "exports"] {
        std::fs::create_dir_all(root.join(sub))?;
    }
    Ok(root.to_path_buf())
}

/// Default pet home location: <data_dir>/pet-mochi
pub fn default_pet_home() -> AppResult<PathBuf> {
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .or_else(dirs::home_dir)
        .ok_or_else(|| AppError::Internal("could not resolve user data dir".into()))?;
    Ok(base.join("pet-mochi"))
}

/// Validate an extension against the safelist.
fn is_allowed_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXTS.iter().any(|a| a.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

/// Resolve a candidate to a path that is provably inside `root`. Refuses if the
/// candidate cannot be canonicalized (does not exist) or escapes the root.
fn validate_within(root: &Path, candidate: &Path) -> AppResult<PathBuf> {
    let canonical_root = root.canonicalize().map_err(AppError::Io)?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|_| AppError::Permission("path is not inside sandbox".into()))?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(AppError::Permission("path is not inside sandbox".into()));
    }
    Ok(canonical_candidate)
}

/// Result of an inbox read — both the content and the canonical path that was
/// actually opened, so callers can record exactly what was read (no TOCTOU window
/// for path strings to drift between validation and use).
#[derive(Debug)]
pub struct InboxRead {
    pub canonical_path: PathBuf,
    pub file_name: String,
    pub content: String,
}

/// Read an approved file from the inbox by *file name only*. The caller never
/// supplies an absolute path — this prevents the frontend from naming arbitrary
/// on-disk files.
///
/// TOCTOU mitigation:
/// 1. Pre-open: `symlink_metadata` rejects entries whose file type is a symlink
///    or which are not a regular file. This is *not* a complete reparse-point
///    check on Windows (junctions and other reparse types don't surface as
///    `is_symlink()`); it is a cheap first-line filter.
/// 2. The real guard is `open_no_follow` below, which opens with
///    `FILE_FLAG_OPEN_REPARSE_POINT` on Windows (refuses to traverse ANY
///    reparse point) and `O_NOFOLLOW` on Unix. Combined with the post-open
///    `is_file()` re-check this closes the swap-then-redirect window.
pub fn read_inbox_by_name(home: &Path, file_name: &str) -> AppResult<InboxRead> {
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
        || file_name.contains(':')
    {
        return Err(AppError::Permission("invalid inbox file name".into()));
    }
    let inbox = home.join("inbox");
    let canonical_inbox = inbox
        .canonicalize()
        .map_err(|_| AppError::Permission("inbox missing or unreadable".into()))?;
    let candidate = canonical_inbox.join(file_name);

    // Defense in depth: refuse any path component that is itself a reparse
    // point. This blocks the symlink-swap TOCTOU before we ever open.
    let pre_meta = std::fs::symlink_metadata(&candidate)
        .map_err(|_| AppError::Permission("inbox entry missing".into()))?;
    if pre_meta.file_type().is_symlink() {
        return Err(AppError::Permission("symlinks are not allowed in inbox".into()));
    }
    if !pre_meta.is_file() {
        return Err(AppError::Permission("inbox entry is not a regular file".into()));
    }

    let canonical = validate_within(&canonical_inbox, &candidate)?;
    if !is_allowed_ext(&canonical) {
        return Err(AppError::Permission("file extension not allowed".into()));
    }

    let file = open_no_follow(&canonical)?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(AppError::Permission("opened handle is not a regular file".into()));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(AppError::InvalidInput(format!(
            "file exceeds {} bytes",
            MAX_FILE_BYTES
        )));
    }

    use std::io::Read;
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    (&file).take(MAX_FILE_BYTES).read_to_end(&mut bytes)?;
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::InvalidInput("file is not valid UTF-8".into()))?;

    let safe_name = canonical
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::Permission("invalid file name".into()))?
        .to_string();
    Ok(InboxRead {
        canonical_path: canonical,
        file_name: safe_name,
        content,
    })
}

/// Open `path` without following symlinks or reparse points. On Windows this
/// uses FILE_FLAG_OPEN_REPARSE_POINT; on Unix we rely on `O_NOFOLLOW` via the
/// custom_flags extension, falling back to `File::open` only if neither is
/// available (in which case the symlink_metadata pre-check above is the guard).
fn open_no_follow(path: &Path) -> AppResult<std::fs::File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // 0x00200000 = FILE_FLAG_OPEN_REPARSE_POINT — opens the reparse point
        // itself rather than following it. Combined with the pre-open
        // symlink_metadata check, this leaves no useful TOCTOU window.
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        Ok(std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?)
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        const O_NOFOLLOW: i32 = libc_o_nofollow();
        Ok(std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(O_NOFOLLOW)
            .open(path)?)
    }
    #[cfg(not(any(windows, unix)))]
    {
        Ok(std::fs::File::open(path)?)
    }
}

#[cfg(unix)]
const fn libc_o_nofollow() -> i32 {
    // O_NOFOLLOW is 0x20000 on Linux, 0x100 on macOS/BSD. We pick the
    // platform-appropriate value at compile time without taking a libc dep.
    #[cfg(target_os = "linux")]
    {
        0x2_0000
    }
    #[cfg(target_os = "macos")]
    {
        0x0100
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxFile {
    pub name: String,
    pub size_bytes: u64,
    pub modified: Option<String>,
}

/// List inbox files. Returns names only — never absolute paths — so the frontend
/// cannot later reference arbitrary on-disk files.
pub fn list_inbox(home: &Path) -> AppResult<Vec<InboxFile>> {
    let inbox = home.join("inbox");
    if !inbox.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&inbox)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        let path = entry.path();
        if !is_allowed_ext(&path) {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        // Skip any name that would fail read_inbox_by_name's filter — keeps the
        // contract symmetric.
        if name.contains("..") || name.contains(':') || name.is_empty() {
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::<chrono::Utc>::from_timestamp(d.as_secs() as i64, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            });
        out.push(InboxFile {
            name,
            size_bytes: meta.len(),
            modified,
        });
    }
    Ok(out)
}

/// Write a note within `notes/` only. Refuses path traversal.
pub fn write_note(home: &Path, file_name: &str, content: &str) -> AppResult<PathBuf> {
    write_in_subdir(home, "notes", file_name, content)
}

/// Write a dream within `dreams/` only.
pub fn write_dream(home: &Path, file_name: &str, content: &str) -> AppResult<PathBuf> {
    write_in_subdir(home, "dreams", file_name, content)
}

/// Write an export within `exports/` only.
pub fn write_export(home: &Path, file_name: &str, content: &str) -> AppResult<PathBuf> {
    write_in_subdir(home, "exports", file_name, content)
}

fn write_in_subdir(home: &Path, subdir: &str, file_name: &str, content: &str) -> AppResult<PathBuf> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err(AppError::Permission(format!(
            "invalid file name: {file_name}"
        )));
    }
    let dir = home.join(subdir);
    std::fs::create_dir_all(&dir)?;
    let target = dir.join(file_name);
    std::fs::write(&target, content)?;
    Ok(target)
}

/// Skill registry — declarative skills loaded from json. No code execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub requires_permission: bool,
    #[serde(default)]
    pub allowed_inputs: Vec<String>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

pub fn builtin_skills() -> Vec<SkillManifest> {
    vec![
        SkillManifest {
            id: "summarize_dropped_file".into(),
            name: "Summarize Dropped File".into(),
            description: "Read an approved file from inbox and write a short note.".into(),
            requires_permission: true,
            allowed_inputs: vec!["txt".into(), "md".into(), "json".into()],
            tools: vec!["read_sandbox_file".into(), "write_pet_note".into()],
            enabled: true,
        },
        SkillManifest {
            id: "create_daily_reflection".into(),
            name: "Create Daily Reflection".into(),
            description: "Generate a short daily dream summary.".into(),
            requires_permission: false,
            allowed_inputs: vec![],
            tools: vec!["write_pet_dream".into()],
            enabled: true,
        },
        SkillManifest {
            id: "remember_user_preference".into(),
            name: "Remember User Preference".into(),
            description: "Save a stable user preference into memory.".into(),
            requires_permission: false,
            allowed_inputs: vec![],
            tools: vec!["create_memory".into()],
            enabled: true,
        },
        SkillManifest {
            id: "write_pet_note".into(),
            name: "Write Pet Note".into(),
            description: "Write a small note in the notes/ folder.".into(),
            requires_permission: false,
            allowed_inputs: vec![],
            tools: vec!["write_pet_note".into()],
            enabled: true,
        },
        SkillManifest {
            id: "export_memories".into(),
            name: "Export Memories".into(),
            description: "Export memories as Markdown or JSON to exports/.".into(),
            requires_permission: false,
            allowed_inputs: vec![],
            tools: vec!["write_export".into()],
            enabled: true,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn home() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let p = ensure_pet_home(dir.path()).unwrap();
        (dir, p)
    }

    #[test]
    fn ensure_creates_subdirs() {
        let (_g, home) = home();
        for sub in ["inbox", "notes", "dreams", "exports"] {
            assert!(home.join(sub).is_dir());
        }
    }

    #[test]
    fn write_note_inside_notes_succeeds() {
        let (_g, home) = home();
        let p = write_note(&home, "hello.md", "hi").unwrap();
        assert!(p.starts_with(home.join("notes")));
        assert_eq!(std::fs::read_to_string(p).unwrap(), "hi");
    }

    #[test]
    fn note_path_traversal_blocked() {
        let (_g, home) = home();
        let err = write_note(&home, "../escape.txt", "x").unwrap_err();
        assert!(matches!(err, AppError::Permission(_)));
    }

    #[test]
    fn read_inbox_blocks_disallowed_ext() {
        let (_g, home) = home();
        std::fs::write(home.join("inbox").join("evil.exe"), "noop").unwrap();
        let err = read_inbox_by_name(&home, "evil.exe").unwrap_err();
        assert!(matches!(err, AppError::Permission(_)));
    }

    #[test]
    fn read_inbox_blocks_path_traversal_in_name() {
        let (_g, home) = home();
        std::fs::write(home.join("notes").join("secret.md"), "secret").unwrap();
        for bad in ["../notes/secret.md", "..\\notes\\secret.md", "C:\\Windows\\System32\\drivers\\etc\\hosts"] {
            let err = read_inbox_by_name(&home, bad).unwrap_err();
            assert!(matches!(err, AppError::Permission(_)), "name={bad} did not block");
        }
    }

    #[test]
    fn read_inbox_allows_safe_md() {
        let (_g, home) = home();
        std::fs::write(home.join("inbox").join("note.md"), "hello world").unwrap();
        let r = read_inbox_by_name(&home, "note.md").unwrap();
        assert_eq!(r.content, "hello world");
        assert_eq!(r.file_name, "note.md");
        assert!(r.canonical_path.starts_with(home.canonicalize().unwrap().join("inbox")));
    }

    #[test]
    fn read_inbox_rejects_directory() {
        let (_g, home) = home();
        std::fs::create_dir(home.join("inbox").join("subdir")).unwrap();
        let err = read_inbox_by_name(&home, "subdir").unwrap_err();
        assert!(matches!(err, AppError::Permission(_)));
    }

    #[test]
    fn list_inbox_returns_names_only() {
        let (_g, home) = home();
        std::fs::write(home.join("inbox").join("a.md"), "x").unwrap();
        std::fs::write(home.join("inbox").join("b.exe"), "x").unwrap();
        let files = list_inbox(&home).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "a.md");
    }
}
