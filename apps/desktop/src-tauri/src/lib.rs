use serde::Serialize;
use std::{fs, path::PathBuf};

const PROJECT_FILE: &str = "project.json";
const SCRIPT_FILE: &str = "script.fountain";

#[derive(Serialize)]
struct ProjectBundlePayload {
    path: String,
    #[serde(rename = "projectJson")]
    project_json: String,
    script: String,
}

#[tauri::command]
fn read_project_bundle(path: String) -> Result<ProjectBundlePayload, String> {
    let root = PathBuf::from(&path);
    let project_path = root.join(PROJECT_FILE);
    let script_path = root.join(SCRIPT_FILE);

    let project_json = fs::read_to_string(&project_path)
        .map_err(|error| format!("Could not read {}: {}", project_path.display(), error))?;
    let script = fs::read_to_string(&script_path)
        .map_err(|error| format!("Could not read {}: {}", script_path.display(), error))?;

    Ok(ProjectBundlePayload {
        path,
        project_json,
        script,
    })
}

#[tauri::command]
fn write_project_bundle(path: String, project_json: String, script: String) -> Result<(), String> {
    let root = PathBuf::from(&path);
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create {}: {}", root.display(), error))?;

    fs::write(root.join(PROJECT_FILE), project_json)
        .map_err(|error| format!("Could not write {}: {}", PROJECT_FILE, error))?;
    fs::write(root.join(SCRIPT_FILE), script)
        .map_err(|error| format!("Could not write {}: {}", SCRIPT_FILE, error))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_project_bundle,
            write_project_bundle
        ])
        .run(tauri::generate_context!())
        .expect("error while running Beast");
}
