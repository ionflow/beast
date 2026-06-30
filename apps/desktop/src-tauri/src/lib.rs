use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

const PROJECT_FILE: &str = "project.json";
const SCRIPT_FILE: &str = "script.fountain";
const PANELS_DIR: &str = "panels";

#[derive(Serialize)]
struct ProjectBundlePayload {
    path: String,
    #[serde(rename = "projectJson")]
    project_json: String,
    script: String,
    files: Vec<ProjectFilePayload>,
}

#[derive(Deserialize, Serialize)]
struct ProjectFilePayload {
    name: String,
    content: String,
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
    let files = read_panel_files(&root)?;

    Ok(ProjectBundlePayload {
        path,
        project_json,
        script,
        files,
    })
}

#[tauri::command]
fn write_project_bundle(
    path: String,
    project_json: String,
    script: String,
    project_files: Vec<ProjectFilePayload>,
) -> Result<(), String> {
    let root = PathBuf::from(&path);
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create {}: {}", root.display(), error))?;

    fs::write(root.join(PROJECT_FILE), project_json)
        .map_err(|error| format!("Could not write {}: {}", PROJECT_FILE, error))?;
    fs::write(root.join(SCRIPT_FILE), script)
        .map_err(|error| format!("Could not write {}: {}", SCRIPT_FILE, error))?;

    let panels_path = root.join(PANELS_DIR);
    if panels_path.exists() {
        fs::remove_dir_all(&panels_path)
            .map_err(|error| format!("Could not clear {}: {}", panels_path.display(), error))?;
    }

    for file in project_files {
        if file.name == PROJECT_FILE || file.name == SCRIPT_FILE {
            continue;
        }

        let target = safe_bundle_path(&root, &file.name)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create {}: {}", parent.display(), error))?;
        }
        fs::write(&target, file.content)
            .map_err(|error| format!("Could not write {}: {}", target.display(), error))?;
    }

    Ok(())
}

fn read_panel_files(root: &Path) -> Result<Vec<ProjectFilePayload>, String> {
    let panels_path = root.join(PANELS_DIR);
    if !panels_path.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    read_panel_files_recursive(root, &panels_path, &mut files)?;
    Ok(files)
}

fn read_panel_files_recursive(
    root: &Path,
    directory: &Path,
    files: &mut Vec<ProjectFilePayload>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Could not read {}: {}", directory.display(), error))?
    {
        let entry = entry.map_err(|error| format!("Could not read directory entry: {}", error))?;
        let path = entry.path();

        if path.is_dir() {
            read_panel_files_recursive(root, &path, files)?;
            continue;
        }

        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }

        let relative_name = path
            .strip_prefix(root)
            .map_err(|error| format!("Could not resolve {}: {}", path.display(), error))?
            .to_string_lossy()
            .replace('\\', "/");
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("Could not read {}: {}", path.display(), error))?;
        files.push(ProjectFilePayload {
            name: relative_name,
            content,
        });
    }

    Ok(())
}

fn safe_bundle_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    let path = Path::new(name);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(format!("Unsafe project file path: {}", name));
    }

    Ok(root.join(path))
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
