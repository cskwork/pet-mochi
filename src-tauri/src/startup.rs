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
    let home = simplify_verbatim(home.canonicalize()?);
    let args = autostart_args_for_home(&home, custom)?;
    Ok((home, AutostartArgs(args)))
}

/// Windows `canonicalize` returns verbatim paths (`\\?\C:\…`,
/// `\\?\UNC\server\…`). Strip the prefix so the home is shown and passed
/// to autostart the way users write it; other paths are returned unchanged.
fn simplify_verbatim(path: PathBuf) -> PathBuf {
    let Some(s) = path.to_str() else { return path };
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
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

#[derive(Clone, Copy, Debug)]
#[allow(dead_code)]
pub(crate) enum AutostartTarget {
    MacOs,
    Linux,
    Windows,
}

pub(crate) fn validate_autostart_launch(
    target: AutostartTarget,
    app_path: Option<&str>,
    args: &[String],
) -> AppResult<()> {
    // auto-launch 0.5.0 does not safely escape every launch-file format.
    // Windows executable handling stays with the plugin; validate only its arguments.
    let windows = matches!(target, AutostartTarget::Windows);
    // The LaunchAgent plist stores each argument as its own <string>, so a
    // plain space is safe there; only XML metacharacters are not.
    let macos = matches!(target, AutostartTarget::MacOs);
    let app_path = app_path.filter(|_| !windows);
    let invalid = app_path
        .into_iter()
        .chain(args.iter().map(String::as_str))
        .flat_map(str::chars)
        .find(|character| {
            !character.is_alphanumeric()
                && !matches!(
                    character,
                    '/' | '.' | '_' | '-' | '~' | '+' | ',' | '@' | '=' | ':'
                )
                && !(windows && *character == '\\')
                && !(macos && *character == ' ')
        });
    if let Some(character) = invalid {
        return Err(AppError::Autostart(format!(
            "{target:?} start on login cannot use character {character:?}; use an app or pet home path without special characters",
        )));
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
    fn autostart_accepts_korean_paths_and_empty_arguments_on_every_target() {
        for target in [
            AutostartTarget::MacOs,
            AutostartTarget::Linux,
            AutostartTarget::Windows,
        ] {
            for args in [
                vec![],
                vec!["--mochi-home".into(), "/home/mochi/반려동물".into()],
            ] {
                validate_autostart_launch(target, Some("/opt/모찌.AppImage"), &args).unwrap();
                validate_autostart_launch(target, None, &args).unwrap();
            }
        }
    }

    #[test]
    fn autostart_accepts_every_allowed_character() {
        for target in [
            AutostartTarget::MacOs,
            AutostartTarget::Linux,
            AutostartTarget::Windows,
        ] {
            for character in "aZ09모찌é中/._-~+,@=:".chars() {
                let part = format!("mochi{character}home");
                validate_autostart_launch(target, Some(&part), &[part.clone()]).unwrap();
            }
        }
    }

    fn assert_rejected_character(
        target: AutostartTarget,
        app_path: Option<&str>,
        args: &[String],
        character: char,
    ) {
        let error = validate_autostart_launch(target, app_path, args).unwrap_err();
        assert!(matches!(error, AppError::Autostart(_)));
        let message = error.to_string();
        assert!(
            message.contains(&format!("character {character:?};")),
            "{message}"
        );
        assert!(
            message.contains("path without special characters"),
            "{message}"
        );
    }

    #[test]
    fn autostart_rejects_forbidden_characters_in_each_argument_and_unix_app_path() {
        for target in [
            AutostartTarget::MacOs,
            AutostartTarget::Linux,
            AutostartTarget::Windows,
        ] {
            for character in " \t\n\r\0\u{7f}\u{2003}\u{a0}&<>\"'%$`!#;|(){}[]*?^🐾\u{301}".chars()
            {
                // A plain space is allowed on macOS (see the dedicated test).
                if character == ' ' && matches!(target, AutostartTarget::MacOs) {
                    continue;
                }
                let part = format!("mochi{character}home");
                for args in [
                    vec![part.clone()],
                    vec!["--mochi-home".into(), part.clone()],
                ] {
                    assert_rejected_character(target, Some("/opt/Mochi"), &args, character);
                }
                if !matches!(target, AutostartTarget::Windows) {
                    assert_rejected_character(target, Some(&part), &[], character);
                }
            }
        }
    }

    #[test]
    fn macos_autostart_rejects_xml_characters_in_app_path() {
        assert_rejected_character(AutostartTarget::MacOs, Some("/tmp/Mochi&Me"), &[], '&');
    }

    #[test]
    fn linux_autostart_rejects_field_codes_quotes_and_backslashes() {
        for (path, character) in [
            ("/home/u/mochi%f", '%'),
            ("/home/u/\"mochi\"", '"'),
            ("/home/u/'mochi'", '\''),
            (r"/home/u/mochi\home", '\\'),
        ] {
            assert_rejected_character(AutostartTarget::Linux, Some(path), &[], character);
            assert_rejected_character(AutostartTarget::Linux, None, &[path.into()], character);
        }
        assert_rejected_character(AutostartTarget::MacOs, Some(r"/tmp/mochi\home"), &[], '\\');
    }

    #[test]
    fn windows_autostart_validates_arguments_but_ignores_app_path() {
        let app_path = Some(r"C:\Program Files\Mochi&Me\Mochi.exe");
        validate_autostart_launch(AutostartTarget::Windows, app_path, &[]).unwrap();
        validate_autostart_launch(
            AutostartTarget::Windows,
            app_path,
            &["--mochi-home".into(), r"C:\Users\Me\Mochi".into()],
        )
        .unwrap();
        assert_rejected_character(
            AutostartTarget::Windows,
            app_path,
            &["--mochi-home".into(), r"C:\Users\First Last\Mochi".into()],
            ' ',
        );
    }

    #[test]
    fn autostart_reports_first_offending_character_in_launch_order() {
        for target in [AutostartTarget::MacOs, AutostartTarget::Linux] {
            assert_rejected_character(target, Some("/tmp/Mochi&Me%f"), &["$home".into()], '&');
        }
        for target in [
            AutostartTarget::MacOs,
            AutostartTarget::Linux,
            AutostartTarget::Windows,
        ] {
            assert_rejected_character(
                target,
                Some("/opt/Mochi"),
                &["/home/first%f&name".into(), "$home".into()],
                '%',
            );
        }
    }

    #[test]
    fn macos_allows_plain_spaces_but_not_xml_metacharacters() {
        validate_autostart_launch(
            AutostartTarget::MacOs,
            Some("/Users/me/My Apps/pet-mochi.app/Contents/MacOS/pet-mochi"),
            &["--mochi-home".into(), "/Users/me/Mochi Home".into()],
        )
        .unwrap();
        assert!(validate_autostart_launch(
            AutostartTarget::MacOs,
            Some("/Applications/pet-mochi.app/Contents/MacOS/pet-mochi"),
            &["--mochi-home".into(), "/Users/me/Mochi\tHome".into()],
        )
        .is_err());
        assert!(validate_autostart_launch(AutostartTarget::Linux, Some("/My Apps/Mochi.AppImage"), &[]).is_err());
    }

    #[test]
    fn verbatim_windows_paths_are_simplified_and_then_accepted() {
        let plain = simplify_verbatim(PathBuf::from(r"\\?\C:\Users\Me\Mochi"));
        assert_eq!(plain, PathBuf::from(r"C:\Users\Me\Mochi"));
        let unc = simplify_verbatim(PathBuf::from(r"\\?\UNC\server\share\Mochi"));
        assert_eq!(unc, PathBuf::from(r"\\server\share\Mochi"));
        assert_eq!(simplify_verbatim(PathBuf::from("/home/me/mochi")), PathBuf::from("/home/me/mochi"));
        for home in [plain, unc] {
            let args = autostart_args_for_home(&home, true).unwrap();
            validate_autostart_launch(AutostartTarget::Windows, None, &args).unwrap();
        }
    }
}
