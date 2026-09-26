use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::service::{error, Result};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSetup {
    available: bool,
    bundled_path: String,
    install_command: String,
    target_path: String,
    path_configured: bool,
    installed: bool,
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn bundled_cli(executable: &Path) -> PathBuf {
    executable.parent().unwrap_or_else(|| Path::new(".")).join("datolens-cli")
}

#[tauri::command]
pub fn cli_setup() -> Result<CliSetup> {
    let executable = std::env::current_exe().map_err(error)?;
    let bundled = bundled_cli(&executable);
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or("No se pudo localizar la carpeta personal.")?;
    let bin = home.join(".local/bin");
    let target = bin.join("datolens");
    let path_configured = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).any(|entry| entry == bin);
    let installed = std::fs::read_link(&target).ok().is_some_and(|link| {
        let absolute = if link.is_absolute() { link } else { target.parent().unwrap_or(Path::new(".")).join(link) };
        absolute == bundled
    });
    let install_command = format!(
        "mkdir -p \"$HOME/.local/bin\" && ln -sfn {} \"$HOME/.local/bin/datolens\"",
        shell_quote(&bundled.to_string_lossy()),
    );
    Ok(CliSetup {
        available: bundled.is_file(),
        bundled_path: bundled.to_string_lossy().into_owned(),
        install_command,
        target_path: target.to_string_lossy().into_owned(),
        path_configured,
        installed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_bundle_paths_for_the_shell() {
        assert_eq!(shell_quote("/Applications/Datolens.app/Contents/MacOS/datolens-cli"), "'/Applications/Datolens.app/Contents/MacOS/datolens-cli'");
        assert_eq!(shell_quote("/tmp/Victoriano's App/cli"), "'/tmp/Victoriano'\"'\"'s App/cli'");
    }

    #[test]
    fn locates_cli_beside_the_gui_executable() {
        assert_eq!(bundled_cli(Path::new("/Applications/Datolens.app/Contents/MacOS/datolens")), PathBuf::from("/Applications/Datolens.app/Contents/MacOS/datolens-cli"));
    }
}
