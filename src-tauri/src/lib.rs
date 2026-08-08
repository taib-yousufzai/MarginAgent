mod commands;

use commands::{fs::*, git::*, llm::*, cbm::*};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            // fs
            pick_folder,
            read_file,
            write_file,
            run_command,
            read_dir_tree,
            file_search,
            // git
            git_status,
            // llm
            llm_complete,
            llm_call,
            // codebase-memory-mcp
            cbm_index,
            cbm_list_projects,
            cbm_search,
            cbm_semantic_search,
            cbm_trace,
            cbm_architecture,
            cbm_get_code,
            cbm_detect_changes,
            cbm_start_ui,
            cbm_ui_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
