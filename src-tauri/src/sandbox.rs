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

/// Require a real directory inside the canonical home. Parent-directory swaps
/// between this check and file open remain possible without directory handles.
fn validate_subdir(home: &Path, subdir: &str) -> AppResult<PathBuf> {
    let dir = home.join(subdir);
    let meta = std::fs::symlink_metadata(&dir)
        .map_err(|_| AppError::Permission("sandbox directory missing or unreadable".into()))?;
    if is_link(&meta) || !meta.is_dir() {
        return Err(AppError::Permission("sandbox directory must be a real directory".into()));
    }
    validate_within(home, &dir)
}

fn is_link(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
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
/// 1. Pre-open: `symlink_metadata` rejects symlinks, Windows reparse points,
///    and entries which are not regular files.
/// 2. The real guard is `open_no_follow` below, which opens with
///    `FILE_FLAG_OPEN_REPARSE_POINT` on Windows (refuses to traverse ANY
///    reparse point) and `O_NOFOLLOW` on Unix. Combined with the post-open
///    metadata re-check this closes the final-component swap-then-redirect window.
pub fn read_inbox_by_name(home: &Path, file_name: &str) -> AppResult<InboxRead> {
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
        || file_name.contains(':')
    {
        return Err(AppError::Permission("invalid inbox file name".into()));
    }
    let canonical_inbox = validate_subdir(home, "inbox")?;
    let candidate = canonical_inbox.join(file_name);

    // Defense in depth: reject linked inbox entries before opening them.
    let pre_meta = std::fs::symlink_metadata(&candidate)
        .map_err(|_| AppError::Permission("inbox entry missing".into()))?;
    if is_link(&pre_meta) {
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
    if is_link(&meta) || !meta.is_file() {
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

/// Refuse final-component symlinks on Unix and open reparse points themselves
/// on Windows so handle metadata can reject them before reading or truncating.
fn no_follow_options() -> std::fs::OpenOptions {
    let mut options = std::fs::OpenOptions::new();
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options
}

fn open_no_follow(path: &Path) -> AppResult<std::fs::File> {
    Ok(no_follow_options().read(true).open(path)?)
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
    match std::fs::symlink_metadata(&inbox) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
        Ok(_) => {}
    }
    let inbox = validate_subdir(home, "inbox")?;
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
    let canonical_dir = validate_subdir(home, subdir)?;
    let target = canonical_dir.join(file_name);
    let mut file = no_follow_options().write(true).create(true).open(&target)?;
    let meta = file.metadata()?;
    if is_link(&meta) || !meta.is_file() {
        return Err(AppError::Permission("write target is not a regular file".into()));
    }
    // Truncate only after the opened handle has passed the checks above.
    file.set_len(0)?;
    use std::io::Write;
    file.write_all(content.as_bytes())?;
    Ok(dir.join(file_name))
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
    fn writes_allow_all_destinations_and_recreate_missing_subdir() {
        let (_g, home) = home();
        std::fs::remove_dir(home.join("dreams")).unwrap();
        let note = write_note(&home, "note.md", "note").unwrap();
        let dream = write_dream(&home, "dream.md", "dream").unwrap();
        let export = write_export(&home, "export.md", "export").unwrap();
        for (path, content) in [(note, "note"), (dream, "dream"), (export, "export")] {
            assert_eq!(std::fs::read_to_string(path).unwrap(), content);
        }
        let note = write_note(&home, "note.md", "new").unwrap();
        assert_eq!(std::fs::read_to_string(note).unwrap(), "new");
    }

    #[cfg(unix)]
    #[test]
    fn writes_reject_symlink_files_without_changing_outside_files() {
        let (_g, home) = home();
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("secret.md");
        std::fs::write(&secret, "unchanged").unwrap();
        for subdir in ["notes", "dreams", "exports"] {
            std::os::unix::fs::symlink(&secret, home.join(subdir).join("link.md")).unwrap();
            assert!(write_in_subdir(&home, subdir, "link.md", "overwrite").is_err());
            assert_eq!(std::fs::read_to_string(&secret).unwrap(), "unchanged");
        }
    }

    #[cfg(unix)]
    #[test]
    fn writes_reject_symlink_directories_without_changing_outside_files() {
        let (_g, home) = home();
        let outside = TempDir::new().unwrap();
        let secret = outside.path().join("secret.md");
        std::fs::write(&secret, "unchanged").unwrap();
        for subdir in ["notes", "dreams", "exports"] {
            std::fs::remove_dir(home.join(subdir)).unwrap();
            std::os::unix::fs::symlink(outside.path(), home.join(subdir)).unwrap();
            assert!(write_in_subdir(&home, subdir, "secret.md", "overwrite").is_err());
            assert!(write_in_subdir(&home, subdir, "new.md", "new").is_err());
            assert_eq!(std::fs::read_to_string(&secret).unwrap(), "unchanged");
            assert!(!outside.path().join("new.md").exists());
        }
    }

    #[cfg(unix)]
    #[test]
    fn inbox_rejects_symlink_directory_outside_home() {
        let (_g, home) = home();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("secret.md"), "secret").unwrap();
        std::fs::remove_dir(home.join("inbox")).unwrap();
        std::os::unix::fs::symlink(outside.path(), home.join("inbox")).unwrap();
        assert!(matches!(read_inbox_by_name(&home, "secret.md"), Err(AppError::Permission(_))));
        assert!(matches!(list_inbox(&home), Err(AppError::Permission(_))));
    }

    #[cfg(unix)]
    #[test]
    fn no_follow_read_rejects_symlink() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("target.md");
        let link = dir.path().join("link.md");
        std::fs::write(&target, "secret").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(open_no_follow(&link).is_err());
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
