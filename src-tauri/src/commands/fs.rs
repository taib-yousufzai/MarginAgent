use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;
use ignore::gitignore::{Gitignore, GitignoreBuilder};

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub kind: String, // "file" | "dir"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub path: String,
    pub line: usize,
    pub preview: String,
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Opens a native OS folder picker and returns the chosen path.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

/// Read a single file's text content.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write text content to a file. Creates parent dirs if needed.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

/// Run a shell command in the given working directory.
/// Returns stdout + stderr combined, truncated to 8KB.
#[tauri::command]
pub fn run_command(command: String, cwd: String) -> Result<CommandOutput, String> {
    use std::process::Command;

    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", &command])
            .current_dir(&cwd)
            .output()
    } else {
        Command::new("sh")
            .args(["-c", &command])
            .current_dir(&cwd)
            .output()
    };

    match output {
        Ok(o) => {
            let mut combined = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            if !stderr.is_empty() {
                combined.push_str("\n--- stderr ---\n");
                combined.push_str(&stderr);
            }
            // Truncate to 8KB to avoid flooding the LLM context
            if combined.len() > 8192 {
                combined.truncate(8192);
                combined.push_str("\n[output truncated]");
            }
            Ok(CommandOutput {
                output: combined,
                exit_code: o.status.code().unwrap_or(-1),
                success: o.status.success(),
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandOutput {
    pub output: String,
    pub exit_code: i32,
    pub success: bool,
}

/// Walk a directory and return a nested FileNode tree.
/// Respects .gitignore, skips node_modules, .git internals, build artifacts.
#[tauri::command]
pub fn read_dir_tree(root: String) -> Result<Vec<FileNode>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", root));
    }

    // Build gitignore matcher
    let mut builder = GitignoreBuilder::new(&root_path);
    let gi_path = root_path.join(".gitignore");
    if gi_path.exists() {
        let _ = builder.add(gi_path);
    }
    let gitignore = builder.build().unwrap_or_else(|_| Gitignore::empty());

    let nodes = build_tree(&root_path, &root_path, &gitignore, 0)?;
    Ok(nodes)
}

fn build_tree(
    root: &Path,
    dir: &Path,
    gitignore: &Gitignore,
    depth: usize,
) -> Result<Vec<FileNode>, String> {
    if depth > 8 {
        return Ok(vec![]);
    }

    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .collect();

    entries.sort_by_key(|e| {
        let is_file = e.file_type().map(|t| t.is_file()).unwrap_or(false);
        (is_file as u8, e.file_name())
    });

    let mut nodes = Vec::new();

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let rel = path.strip_prefix(root).unwrap_or(&path);

        // Skip always-ignored dirs
        if name == ".git" || name == "node_modules" || name == "target"
            || name == "dist" || name == ".next" || name == "__pycache__"
            || name == ".cache" || name.starts_with(".DS_Store")
        {
            continue;
        }

        // Skip gitignored paths
        let is_dir = path.is_dir();
        if gitignore.matched(rel, is_dir).is_ignore() {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();

        if is_dir {
            let children = build_tree(root, &path, gitignore, depth + 1)?;
            nodes.push(FileNode {
                name,
                path: path_str,
                kind: "dir".into(),
                children: Some(children),
                content: None,
                git_status: None,
            });
        } else {
            nodes.push(FileNode {
                name,
                path: path_str,
                kind: "file".into(),
                children: None,
                content: None, // content loaded on demand via read_file
                git_status: None,
            });
        }
    }

    Ok(nodes)
}

/// Search file contents for a query string. Returns up to 20 results.
#[tauri::command]
pub fn file_search(root: String, query: String) -> Result<Vec<SearchResult>, String> {
    if query.trim().len() < 2 {
        return Ok(vec![]);
    }

    let root_path = PathBuf::from(&root);
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for entry in WalkDir::new(&root_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();

        // Skip binary-likely files and ignored dirs
        let ext = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
        let text_exts = ["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "kt",
                         "c", "cpp", "h", "css", "html", "json", "toml", "yaml", "yml",
                         "md", "txt", "sh", "env", "gitignore", "sql"];
        if !text_exts.contains(&ext.as_str()) {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();

        // Match on filename
        if name.to_lowercase().contains(&query_lower) {
            results.push(SearchResult {
                path: path_str.clone(),
                line: 0,
                preview: format!("File: {}", name),
            });
            if results.len() >= 20 { return Ok(results); }
            continue;
        }

        // Match on content
        if let Ok(content) = fs::read_to_string(path) {
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&query_lower) {
                    results.push(SearchResult {
                        path: path_str.clone(),
                        line: i + 1,
                        preview: line.trim().chars().take(120).collect(),
                    });
                    if results.len() >= 20 { return Ok(results); }
                    break;
                }
            }
        }
    }

    Ok(results)
}
