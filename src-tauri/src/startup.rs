use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::sandbox::{default_pet_home, ensure_pet_home};

pub(crate) struct AutostartArgs(pub Vec<String>);

pub(crate) fn resolve_pet_home() -> AppResult<(PathBuf, AutostartArgs)> {
    let custom_home = pet_home_from(std::env::args_os().skip(1), std::env::var_os("MOCHI_HOME"))?;
    let custom = custom_home.is_some();
    let home = custom_home
        .unwrap_or_else(|| default_pet_home().unwrap_or_else(|_| PathBuf::from("./pet_home")));
    ensure_pet_home(&home)?;
    let home = home.canonicalize()?;
    let args = autostart_args_for_home(&home, custom)?;
    Ok((home, AutostartArgs(args)))
}

/// `None` selects the default home; an explicit flag must never silently fall back.
fn pet_home_from(
    args: impl IntoIterator<Item = impl Into<OsString>>,
    env: Option<OsString>,
) -> AppResult<Option<PathBuf>> {
    let mut args = args.into_iter().map(Into::into);
    let mut cli_home = None;
    while let Some(arg) = args.next() {
        if arg == "--" {
            break;
        }
        if arg == "--mochi-home" {
            let value = args
                .next()
                .filter(|value| !value.is_empty() && !value.to_string_lossy().starts_with("--"))
                .ok_or_else(|| AppError::InvalidInput("--mochi-home requires a path".into()))?;
            cli_home = Some(PathBuf::from(value));
        }
    }
    Ok(cli_home.or_else(|| env.map(PathBuf::from)))
}

fn autostart_args_for_home(home: &Path, custom: bool) -> AppResult<Vec<String>> {
    if !custom {
        return Ok(Vec::new());
    }
    let path = home.to_str().ok_or_else(|| {
        AppError::InvalidInput("custom pet home must be valid UTF-8 for start on login".into())
    })?;
    Ok(vec!["--mochi-home".into(), path.into()])
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn validate_linux_autostart(app_path: &str, args: &[String]) -> AppResult<()> {
    // auto-launch 0.5.0 emits an unquoted Exec line on Linux.
    if std::iter::once(app_path)
        .chain(args.iter().map(String::as_str))
        .any(|part| part.chars().any(char::is_whitespace))
    {
        return Err(AppError::Autostart(
            "Linux start on login cannot use paths or arguments containing whitespace; move the app or pet home to a path without spaces".into(),
        ));
    }
    Ok(())
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn validate_windows_autostart(args: &[String]) -> AppResult<()> {
    if args.iter().any(|arg| arg.chars().any(char::is_whitespace)) {
        return Err(AppError::Autostart(
            "Windows start on login cannot pass a pet home path containing spaces; set MOCHI_HOME to a path without spaces".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_defaults_only_without_a_cli_or_environment_override() {
        assert_eq!(pet_home_from(["--unrelated"], None).unwrap(), None);
        assert_eq!(
            pet_home_from(["--unrelated"], Some("env-home".into())).unwrap(),
            Some(PathBuf::from("env-home")),
        );
    }

    #[test]
    fn cli_home_overrides_environment_and_preserves_spaces_and_unicode() {
        assert_eq!(
            pet_home_from(
                ["--unrelated", "--mochi-home", "homes/My Mochi 🐾"],
                Some("env-home".into()),
            )
            .unwrap(),
            Some(PathBuf::from("homes/My Mochi 🐾")),
        );
    }

    #[test]
    fn last_cli_home_wins_and_option_terminator_stops_parsing() {
        assert_eq!(
            pet_home_from(
                [
                    "--mochi-home",
                    "first",
                    "--mochi-home",
                    "last",
                    "--",
                    "--mochi-home",
                    "ignored"
                ],
                None,
            )
            .unwrap(),
            Some(PathBuf::from("last")),
        );
        assert_eq!(
            pet_home_from(["--", "--mochi-home", "ignored"], Some("env-home".into())).unwrap(),
            Some(PathBuf::from("env-home")),
        );
    }

    #[test]
    fn malformed_home_flag_rejects_instead_of_opening_another_home() {
        for args in [
            vec!["--mochi-home"],
            vec!["--mochi-home", ""],
            vec!["--mochi-home", "--other"],
        ] {
            assert!(matches!(
                pet_home_from(args, Some("env-home".into())),
                Err(AppError::InvalidInput(_)),
            ));
        }
    }

    #[test]
    fn autostart_arguments_round_trip_custom_absolute_home_without_environment() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().canonicalize().unwrap();
        let args = autostart_args_for_home(&home, true).unwrap();
        assert_eq!(
            args,
            vec![
                "--mochi-home".to_string(),
                home.to_str().unwrap().to_string()
            ]
        );
        assert!(home.is_absolute());
        assert_eq!(pet_home_from(args, None).unwrap(), Some(home.clone()));
        assert!(autostart_args_for_home(&home, false).unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn custom_home_cannot_be_lossily_encoded_in_autostart_arguments() {
        use std::os::unix::ffi::OsStringExt;
        let home = PathBuf::from(OsString::from_vec(b"/mochi/\xff".to_vec()));
        assert!(matches!(
            autostart_args_for_home(&home, true),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn linux_autostart_accepts_paths_without_whitespace() {
        for args in [
            vec![],
            vec!["--mochi-home".into(), "/home/mochi/반려동물".into()],
        ] {
            validate_linux_autostart("/opt/Mochi.AppImage", &args).unwrap();
        }
    }

    #[test]
    fn linux_autostart_rejects_whitespace_in_executable_or_any_argument() {
        for whitespace in [' ', '\t', '\n', '\r', '\u{2003}'] {
            let app_path = format!("/My{whitespace}Apps/Mochi.AppImage");
            let home = format!("/home/My{whitespace}Mochi");
            for (path, args) in [
                (app_path.as_str(), vec![]),
                ("/opt/Mochi.AppImage", vec!["--mochi-home".into(), home]),
                ("/opt/Mochi.AppImage", vec![format!("--bad{whitespace}arg")]),
            ] {
                let error = validate_linux_autostart(path, &args).unwrap_err();
                assert!(matches!(error, AppError::Autostart(_)));
                let message = error.to_string();
                assert!(message.contains("move the app or pet home to a path without spaces"));
            }
        }
    }

    #[test]
    fn windows_autostart_rejects_spaced_home_args_only() {
        validate_windows_autostart(&[]).unwrap();
        validate_windows_autostart(&["--mochi-home".into(), r"D:\MochiHome".into()]).unwrap();
        let error = validate_windows_autostart(&[
            "--mochi-home".into(),
            r"C:\Users\First Last\Mochi".into(),
        ])
        .unwrap_err();
        assert!(matches!(error, AppError::Autostart(_)));
    }
}
