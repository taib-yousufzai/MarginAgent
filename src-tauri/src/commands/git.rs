use serde::{Deserialize, Serialize};
use git2::{Repository, Status};

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatusResult {
    pub branch: String,
    pub dirty_files: usize,
    pub ahead: usize,
    pub repository: String,
    pub files: Vec<GitFileStatus>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String, // "modified" | "added" | "deleted" | "untracked"
}

/// Get git status for a workspace path.
#[tauri::command]
pub fn git_status(workspace: String) -> Result<GitStatusResult, String> {
    let repo = Repository::discover(&workspace).map_err(|e| e.to_string())?;

    // Branch name
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "HEAD".to_string());

    // Repository remote URL
    let repository = repo
        .find_remote("origin")
        .ok()
        .and_then(|r| r.url().map(|u| u.to_string()))
        .unwrap_or_else(|| workspace.clone());

    // Ahead count (commits ahead of upstream)
    let ahead = get_ahead_count(&repo).unwrap_or(0);

    // File statuses
    let mut files = Vec::new();
    let statuses = repo.statuses(None).map_err(|e| e.to_string())?;

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        let status_str = if s.contains(Status::WT_NEW) || s.contains(Status::INDEX_NEW) {
            "added"
        } else if s.contains(Status::WT_DELETED) || s.contains(Status::INDEX_DELETED) {
            "deleted"
        } else if s.contains(Status::WT_MODIFIED) || s.contains(Status::INDEX_MODIFIED) {
            "modified"
        } else if s.contains(Status::WT_RENAMED) || s.contains(Status::INDEX_RENAMED) {
            "modified"
        } else if s.is_ignored() {
            continue;
        } else {
            "untracked"
        };

        files.push(GitFileStatus {
            path,
            status: status_str.to_string(),
        });
    }

    let dirty_files = files.len();

    Ok(GitStatusResult {
        branch,
        dirty_files,
        ahead,
        repository,
        files,
    })
}

fn get_ahead_count(repo: &Repository) -> Option<usize> {
    let head = repo.head().ok()?;
    let local = head.peel_to_commit().ok()?;

    let upstream_ref = format!(
        "refs/remotes/origin/{}",
        head.shorthand().unwrap_or("main")
    );
    let upstream = repo
        .find_reference(&upstream_ref)
        .ok()?
        .peel_to_commit()
        .ok()?;

    let (ahead, _) = repo
        .graph_ahead_behind(local.id(), upstream.id())
        .ok()?;

    Some(ahead)
}
