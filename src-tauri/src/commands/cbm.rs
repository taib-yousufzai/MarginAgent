use serde::{Deserialize, Serialize};
use tauri::Manager;

const CBM_BIN: &str = "D:\\Software\\codebase-memory-mcp\\codebase-memory-mcp.exe";
const CBM_UI_BIN: &str = "D:\\Software\\codebase-memory-mcp\\ui\\codebase-memory-mcp.exe";
const CBM_UI_PORT: u16 = 9749;

/// Run a CBM CLI command asynchronously. Prevents blocking the Tauri runtime.
async fn cbm_cli(args: Vec<String>) -> Result<serde_json::Value, String> {
    let output = tokio::process::Command::new(CBM_BIN)
        .arg("cli")
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to run codebase-memory-mcp: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    if stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Empty output. stderr: {}", &stderr[..stderr.len().min(300)]));
    }

    serde_json::from_str(&stdout)
        .map_err(|e| format!("JSON parse error: {} — raw: {}", e, &stdout[..stdout.len().min(200)]))
}

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct CbmIndexStatus {
    pub indexed: bool,
    pub project: Option<String>,
    pub node_count: Option<u64>,
    pub edge_count: Option<u64>,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CbmSearchResult {
    pub name: String,
    pub label: String,
    pub file: Option<String>,
    pub line: Option<u64>,
    pub signature: Option<String>,
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cbm_index(repo_path: String) -> Result<CbmIndexStatus, String> {
    let result = cbm_cli(vec!["index_repository".into(), "--repo-path".into(), repo_path]).await?;
    let status = result["status"].as_str().unwrap_or("unknown").to_string();
    let indexed = status == "indexed" || status == "up_to_date";
    Ok(CbmIndexStatus {
        indexed,
        project: result["project"].as_str().map(|s| s.to_string()),
        node_count: result["node_count"].as_u64(),
        edge_count: result["edge_count"].as_u64(),
        status,
    })
}

#[tauri::command]
pub async fn cbm_list_projects() -> Result<serde_json::Value, String> {
    cbm_cli(vec!["list_projects".into()]).await
}

#[tauri::command]
pub async fn cbm_search(project: String, query: String, limit: Option<u32>) -> Result<serde_json::Value, String> {
    cbm_cli(vec![
        "search_graph".into(),
        "--project".into(), project,
        "--name-pattern".into(), format!(".*{}.*", query),
        "--limit".into(), limit.unwrap_or(20).to_string(),
    ]).await
}

#[tauri::command]
pub async fn cbm_semantic_search(project: String, query: String, limit: Option<u32>) -> Result<serde_json::Value, String> {
    cbm_cli(vec![
        "semantic_query".into(),
        "--project".into(), project,
        "--query".into(), query,
        "--limit".into(), limit.unwrap_or(10).to_string(),
    ]).await
}

#[tauri::command]
pub async fn cbm_trace(project: String, function_name: String, direction: Option<String>, depth: Option<u32>) -> Result<serde_json::Value, String> {
    cbm_cli(vec![
        "trace_path".into(),
        "--project".into(), project,
        "--function-name".into(), function_name,
        "--direction".into(), direction.unwrap_or_else(|| "both".into()),
        "--depth".into(), depth.unwrap_or(3).to_string(),
    ]).await
}

#[tauri::command]
pub async fn cbm_architecture(project: String) -> Result<serde_json::Value, String> {
    cbm_cli(vec!["get_architecture".into(), "--project".into(), project]).await
}

#[tauri::command]
pub async fn cbm_get_code(project: String, qualified_name: String) -> Result<serde_json::Value, String> {
    cbm_cli(vec![
        "get_code_snippet".into(),
        "--project".into(), project,
        "--qualified-name".into(), qualified_name,
    ]).await
}

#[tauri::command]
pub async fn cbm_detect_changes(project: String) -> Result<serde_json::Value, String> {
    cbm_cli(vec!["detect_changes".into(), "--project".into(), project]).await
}

/// Start the CBM graph UI server and open it in a native window.
#[tauri::command]
pub async fn cbm_start_ui(app: tauri::AppHandle) -> Result<String, String> {
    let url = format!("http://localhost:{}", CBM_UI_PORT);

    // If already listening, just focus/create the window
    if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", CBM_UI_PORT)).await.is_ok() {
        open_graph_window(&app, &url);
        return Ok(url);
    }

    // Kill stale CBM processes holding the port
    let _ = tokio::process::Command::new("taskkill")
        .args(["/F", "/IM", "codebase-memory-mcp.exe"])
        .output()
        .await;
    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;

    if !std::path::Path::new(CBM_UI_BIN).exists() {
        return Err(format!("CBM UI binary not found at {}", CBM_UI_BIN));
    }

    // Start UI server
    tokio::process::Command::new(CBM_UI_BIN)
        .args(["--ui", "true", "--port", &CBM_UI_PORT.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start CBM UI: {}", e))?;

    // Wait up to 10s
    for _ in 0..100 {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", CBM_UI_PORT)).await.is_ok() {
            open_graph_window(&app, &url);
            return Ok(url);
        }
    }

    Err(format!("CBM UI server did not start on port {}", CBM_UI_PORT))
}

fn open_graph_window(app: &tauri::AppHandle, url: &str) {
    // Focus existing window or create new one
    if let Some(win) = app.get_webview_window("cbm-graph") {
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        let _ = tauri::WebviewWindowBuilder::new(
            app,
            "cbm-graph",
            tauri::WebviewUrl::External(url.parse().unwrap()),
        )
        .title("Codebase Knowledge Graph")
        .inner_size(1200.0, 800.0)
        .build();
    }
}

/// Check if CBM UI is running.
#[tauri::command]
pub async fn cbm_ui_status() -> bool {
    tokio::net::TcpStream::connect(format!("127.0.0.1:{}", CBM_UI_PORT)).await.is_ok()
}
