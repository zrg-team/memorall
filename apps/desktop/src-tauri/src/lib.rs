mod sidecar;

use sidecar::SidecarSupervisor;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn app_data_path(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn sidecar_status(supervisor: tauri::State<'_, Mutex<SidecarSupervisor>>) -> sidecar::SidecarStatus {
    supervisor.lock().expect("sidecar supervisor poisoned").status()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(SidecarSupervisor::default()))
        .invoke_handler(tauri::generate_handler![app_data_path, sidecar_status])
        .run(tauri::generate_context!())
        .expect("error while running Memorall desktop");
}
