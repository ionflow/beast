use base64::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, State};

const PROJECT_FILE: &str = "project.json";
const SCRIPT_FILE: &str = "script.fountain";
const PANELS_DIR: &str = "panels";
const CONTEXTS_DIR: &str = "panels/contexts";
const ASSETS_DIR: &str = "assets/research";
const BRIDGE_PORT: u16 = 33179;
const CAPTURE_EVENT: &str = "beast://research-capture";

#[derive(Clone, Default)]
struct BridgeRegistry {
    projects: Arc<Mutex<Vec<BridgeProject>>>,
}

#[derive(Clone, Deserialize, Serialize)]
struct BridgeProject {
    id: String,
    title: String,
    path: String,
    active: bool,
}

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

#[derive(Deserialize)]
struct CaptureRequest {
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    title: Option<String>,
    url: String,
    note: Option<String>,
    #[serde(rename = "selectionText")]
    selection_text: Option<String>,
    #[serde(rename = "pageText")]
    page_text: Option<String>,
    #[serde(rename = "stackTitle")]
    stack_title: Option<String>,
    screenshot: Option<CaptureScreenshot>,
}

#[derive(Deserialize)]
struct CaptureScreenshot {
    #[serde(rename = "dataUrl")]
    data_url: String,
    filename: Option<String>,
}

#[derive(Clone, Serialize)]
struct CaptureSavedPayload {
    #[serde(rename = "projectId")]
    project_id: String,
    path: String,
    #[serde(rename = "contextKey")]
    context_key: String,
    #[serde(rename = "stackId")]
    stack_id: String,
    #[serde(rename = "stackTitle")]
    stack_title: String,
    item: ResearchItem,
}

#[derive(Clone, Deserialize, Serialize)]
struct PanelContext {
    key: Option<String>,
    #[serde(default)]
    notecards: Vec<Value>,
    #[serde(rename = "imagePrompts", default)]
    image_prompts: Vec<Value>,
    #[serde(rename = "researchStacks", default)]
    research_stacks: Vec<ResearchStack>,
}

#[derive(Clone, Deserialize, Serialize)]
struct ResearchStack {
    id: String,
    title: String,
    #[serde(default)]
    items: Vec<ResearchItem>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct ResearchItem {
    id: String,
    #[serde(rename = "type")]
    item_type: String,
    title: String,
    source: String,
    note: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    quote: Option<String>,
    #[serde(default)]
    assets: Vec<String>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
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

#[tauri::command]
fn register_bridge_project(
    registry: State<'_, BridgeRegistry>,
    project: BridgeProject,
) -> Result<(), String> {
    if project.path.trim().is_empty() {
        return Err("Project path is required for browser captures.".to_string());
    }

    let mut projects = registry
        .projects
        .lock()
        .map_err(|_| "Could not lock bridge project registry.".to_string())?;

    for existing in projects.iter_mut() {
        if project.active {
            existing.active = false;
        }

        if existing.id == project.id {
            *existing = project.clone();
            return Ok(());
        }
    }

    projects.push(project);
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

fn start_bridge_server(registry: BridgeRegistry, app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", BRIDGE_PORT)) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("Could not start Beast browser bridge: {}", error);
                return;
            }
        };

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let registry = registry.clone();
                    let app_handle = app_handle.clone();
                    thread::spawn(move || handle_bridge_connection(stream, registry, app_handle));
                }
                Err(error) => eprintln!("Beast browser bridge connection failed: {}", error),
            }
        }
    });
}

fn handle_bridge_connection(
    mut stream: TcpStream,
    registry: BridgeRegistry,
    app_handle: tauri::AppHandle,
) {
    let request = match read_http_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            let _ = write_json_response(&mut stream, 400, json!({ "error": error.to_string() }));
            return;
        }
    };

    let response = handle_bridge_request(&request, registry, app_handle);
    let (status, body) = match response {
        Ok(body) => (200, body),
        Err(error) => (error.status, json!({ "error": error.message })),
    };

    let _ = write_json_response(&mut stream, status, body);
}

fn read_http_request(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut request = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut expected_length: Option<usize> = None;

    loop {
        let bytes_read = stream.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }

        request.extend_from_slice(&buffer[..bytes_read]);

        if expected_length.is_none() {
            if let Some(header_end) = find_header_end(&request) {
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = parse_content_length(&headers).unwrap_or(0);
                expected_length = Some(header_end + 4 + content_length);
            }
        }

        if let Some(expected_length) = expected_length {
            if request.len() >= expected_length {
                request.truncate(expected_length);
                break;
            }
        }

        if request.len() > 1024 * 1024 * 25 {
            break;
        }
    }

    Ok(request)
}

fn parse_content_length(headers: &str) -> Option<usize> {
    headers
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
}

fn find_header_end(request: &[u8]) -> Option<usize> {
    request
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
}

fn handle_bridge_request(
    request: &[u8],
    registry: BridgeRegistry,
    app_handle: tauri::AppHandle,
) -> Result<Value, BridgeError> {
    let request_text = String::from_utf8_lossy(request);
    let header_end = request_text
        .find("\r\n\r\n")
        .ok_or_else(|| BridgeError::bad_request("Malformed HTTP request."))?;
    let headers = &request_text[..header_end];
    let mut lines = headers.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| BridgeError::bad_request("Missing HTTP request line."))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let path = request_parts.next().unwrap_or_default();
    let body = &request[(header_end + 4)..];

    match (method, path) {
        ("OPTIONS", _) => Ok(json!({ "ok": true })),
        ("GET", "/health") => Ok(json!({ "ok": true, "app": "Beast", "port": BRIDGE_PORT })),
        ("GET", "/projects") => bridge_projects_response(registry),
        ("POST", "/captures") => bridge_capture_request(body, registry, app_handle),
        _ => Err(BridgeError::not_found("Unknown Beast bridge endpoint.")),
    }
}

fn bridge_projects_response(registry: BridgeRegistry) -> Result<Value, BridgeError> {
    let projects = registry
        .projects
        .lock()
        .map_err(|_| BridgeError::server("Could not lock bridge project registry."))?;
    let active_project_id = projects
        .iter()
        .find(|project| project.active)
        .map(|project| project.id.clone());

    Ok(json!({
        "projects": projects.clone(),
        "activeProjectId": active_project_id,
    }))
}

fn bridge_capture_request(
    body: &[u8],
    registry: BridgeRegistry,
    app_handle: tauri::AppHandle,
) -> Result<Value, BridgeError> {
    if body.is_empty() {
        return Err(BridgeError::bad_request("Invalid capture payload: request body was empty."));
    }

    let capture: CaptureRequest = serde_json::from_slice(body)
        .map_err(|error| BridgeError::bad_request(format!("Invalid capture payload: {}", error)))?;
    let project = resolve_capture_project(&registry, capture.project_id.as_deref())?;
    let saved = save_capture_to_project(&project, capture)
        .map_err(BridgeError::server)?;

    let _ = app_handle.emit(CAPTURE_EVENT, saved.clone());

    Ok(json!({
        "ok": true,
        "capture": saved,
    }))
}

fn resolve_capture_project(
    registry: &BridgeRegistry,
    project_id: Option<&str>,
) -> Result<BridgeProject, BridgeError> {
    let projects = registry
        .projects
        .lock()
        .map_err(|_| BridgeError::server("Could not lock bridge project registry."))?;

    if let Some(project_id) = project_id {
        if let Some(project) = projects.iter().find(|project| project.id == project_id) {
            return Ok(project.clone());
        }
    }

    projects
        .iter()
        .find(|project| project.active)
        .cloned()
        .ok_or_else(|| BridgeError::bad_request("No Beast project is registered with the browser bridge."))
}

fn save_capture_to_project(
    project: &BridgeProject,
    capture: CaptureRequest,
) -> Result<CaptureSavedPayload, String> {
    let root = PathBuf::from(&project.path);
    let context_key = "project".to_string();
    let now = iso_timestamp();
    let item_id = format!("research-item-{}", id_suffix());
    let stack_title = capture
        .stack_title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or("Chrome Captures")
        .to_string();
    let assets = match capture.screenshot {
        Some(screenshot) => vec![save_capture_screenshot(&root, &item_id, screenshot)?],
        None => Vec::new(),
    };
    let item = ResearchItem {
        id: item_id,
        item_type: "website".to_string(),
        title: capture
            .title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .unwrap_or("Untitled Capture")
            .to_string(),
        source: capture.url,
        note: capture.note.unwrap_or_default(),
        quote: capture
            .selection_text
            .or(capture.page_text)
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty()),
        assets,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    let context_path = root.join(CONTEXTS_DIR).join("project.json");
    let mut context = read_panel_context_file(&context_path, &context_key)?;
    let stack_id = upsert_research_capture(&mut context, stack_title.clone(), item.clone(), now);
    write_panel_context_file(&context_path, &context_key, &context)?;

    Ok(CaptureSavedPayload {
        project_id: project.id.clone(),
        path: project.path.clone(),
        context_key,
        stack_id,
        stack_title,
        item,
    })
}

fn read_panel_context_file(path: &Path, context_key: &str) -> Result<PanelContext, String> {
    if !path.exists() {
        return Ok(PanelContext {
            key: Some(context_key.to_string()),
            notecards: Vec::new(),
            image_prompts: Vec::new(),
            research_stacks: Vec::new(),
        });
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {}", path.display(), error))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Could not parse {}: {}", path.display(), error))
}

fn write_panel_context_file(
    path: &Path,
    context_key: &str,
    context: &PanelContext,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {}", parent.display(), error))?;
    }

    let mut next_context = context.clone();
    next_context.key = Some(context_key.to_string());
    let content = serde_json::to_string_pretty(&next_context)
        .map_err(|error| format!("Could not serialize capture context: {}", error))?;
    fs::write(path, content).map_err(|error| format!("Could not write {}: {}", path.display(), error))
}

fn upsert_research_capture(
    context: &mut PanelContext,
    stack_title: String,
    item: ResearchItem,
    now: String,
) -> String {
    if let Some(stack) = context
        .research_stacks
        .iter_mut()
        .find(|stack| stack.title == stack_title)
    {
        stack.items.push(item);
        stack.updated_at = now;
        return stack.id.clone();
    }

    let stack_id = format!("stack-{}", id_suffix());
    context.research_stacks.push(ResearchStack {
        id: stack_id.clone(),
        title: stack_title,
        items: vec![item],
        created_at: now.clone(),
        updated_at: now,
    });
    stack_id
}

fn save_capture_screenshot(
    root: &Path,
    item_id: &str,
    screenshot: CaptureScreenshot,
) -> Result<String, String> {
    let (_, base64_data) = screenshot
        .data_url
        .split_once(',')
        .ok_or_else(|| "Screenshot must be a data URL.".to_string())?;
    let bytes = BASE64_STANDARD
        .decode(base64_data)
        .map_err(|error| format!("Could not decode screenshot: {}", error))?;
    let filename = screenshot
        .filename
        .as_deref()
        .map(safe_asset_filename)
        .filter(|filename| !filename.is_empty())
        .unwrap_or_else(|| format!("{}.jpg", item_id));
    let relative_path = format!("{}/{}", ASSETS_DIR, filename);
    let target = safe_bundle_path(root, &relative_path)?;

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {}", parent.display(), error))?;
    }
    fs::write(&target, bytes)
        .map_err(|error| format!("Could not write {}: {}", target.display(), error))?;

    Ok(relative_path)
}

fn safe_asset_filename(filename: &str) -> String {
    filename
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn write_json_response(stream: &mut TcpStream, status: u16, body: Value) -> std::io::Result<()> {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let body = serde_json::to_string(&body).unwrap_or_else(|_| "{\"error\":\"Serialization failed\"}".to_string());
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: GET,POST,OPTIONS\r\nConnection: close\r\n\r\n{}",
        status,
        status_text,
        body.len(),
        body
    );
    stream.write_all(response.as_bytes())
}

fn iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn id_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    nanos.to_string()
}

struct BridgeError {
    status: u16,
    message: String,
}

impl BridgeError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: 400,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: 404,
            message: message.into(),
        }
    }

    fn server(message: impl Into<String>) -> Self {
        Self {
            status: 500,
            message: message.into(),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry = BridgeRegistry::default();

    tauri::Builder::default()
        .manage(registry.clone())
        .setup(move |app| {
            start_bridge_server(registry.clone(), app.handle().clone());
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            register_bridge_project,
            read_project_bundle,
            write_project_bundle
        ])
        .run(tauri::generate_context!())
        .expect("error while running Beast");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_content_length_after_other_headers() {
        let headers = "POST /captures HTTP/1.1\r\nHost: 127.0.0.1:33179\r\nContent-Type: application/json\r\nContent-Length: 42";

        assert_eq!(parse_content_length(headers), Some(42));
    }

    #[test]
    fn missing_content_length_returns_none() {
        let headers = "GET /projects HTTP/1.1\r\nHost: 127.0.0.1:33179";

        assert_eq!(parse_content_length(headers), None);
    }
}
