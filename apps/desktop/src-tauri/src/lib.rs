mod sidecar;

use serde_json::{json, Value};
use sidecar::{BrowserBridgeError, SidecarSupervisor};
use std::thread;
use std::time::Duration;
use tauri::window::Color;
use tauri::{Manager, WebviewWindow};

/// The window is created hidden so the frontend can paint its splash before the
/// OS ever composites it. If the frontend never gets that far (bundle failed to
/// load, panic during boot) we still reveal the window rather than leaving the
/// user with a running process and nothing on screen.
const WINDOW_REVEAL_FALLBACK: Duration = Duration::from_secs(10);
const MAIN_WINDOW_LABEL: &str = "main";

#[tauri::command]
fn app_data_path(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

/// Reveal the main window, called by `boot.js` as soon as the page starts
/// parsing.
///
/// `background` is the theme the frontend resolved. Applying it before `show()`
/// means the first frame the compositor puts on screen is already the app's
/// background colour instead of the webview's default white, and it keeps the
/// native window from tearing during resizes.
#[tauri::command]
fn show_main_window(window: WebviewWindow, background: Option<String>) {
    reveal_window(&window, background.as_deref(), true);
}

fn reveal_window(window: &WebviewWindow, background: Option<&str>, focus: bool) {
    if let Some(color) = background.and_then(|value| value.parse::<Color>().ok()) {
        // Sets both the window and the webview layer; unsupported on some
        // platforms, where the window still shows without it.
        let _ = window.set_background_color(Some(color));
    }
    let _ = window.show();
    if focus {
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn sidecar_status(supervisor: tauri::State<'_, SidecarSupervisor>) -> sidecar::SidecarStatus {
    supervisor.status()
}

#[tauri::command]
async fn desktop_browser_status(
    supervisor: tauri::State<'_, SidecarSupervisor>,
    tab_id: Option<u64>,
) -> Result<Value, BrowserBridgeError> {
    supervisor
        .request(
            "browser.status",
            tab_id.map_or_else(|| json!({}), |tab_id| json!({ "tabId": tab_id })),
            Duration::from_secs(45),
        )
        .await
}

#[tauri::command]
async fn desktop_browser_request(
    supervisor: tauri::State<'_, SidecarSupervisor>,
    request: Value,
) -> Result<Value, BrowserBridgeError> {
    let timeout_ms = request
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(30_000)
        .saturating_add(5_000)
        .clamp(5_000, 125_000);
    supervisor
        .request(
            "browser.command",
            request,
            Duration::from_millis(timeout_ms),
        )
        .await
}

#[tauri::command]
async fn desktop_browser_configure(
    supervisor: tauri::State<'_, SidecarSupervisor>,
    persist_profile: bool,
    visible: bool,
) -> Result<Value, BrowserBridgeError> {
    supervisor
        .request(
            "browser.configure",
            json!({
                "persistProfile": persist_profile,
                "visible": visible,
            }),
            Duration::from_secs(60),
        )
        .await
}

#[tauri::command]
async fn desktop_browser_clear_profile(
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<Value, BrowserBridgeError> {
    supervisor
        .request("browser.clear-profile", json!({}), Duration::from_secs(60))
        .await
}

#[tauri::command]
async fn desktop_browser_takeover(
    supervisor: tauri::State<'_, SidecarSupervisor>,
    tab_id: u64,
) -> Result<Value, BrowserBridgeError> {
    supervisor
        .request(
            "browser.takeover",
            json!({ "tabId": tab_id }),
            Duration::from_secs(60),
        )
        .await
}

#[tauri::command]
async fn desktop_browser_resume(
    supervisor: tauri::State<'_, SidecarSupervisor>,
    tab_id: u64,
) -> Result<Value, BrowserBridgeError> {
    supervisor
        .request(
            "browser.resume",
            json!({ "tabId": tab_id }),
            Duration::from_secs(60),
        )
        .await
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(SidecarSupervisor::new(app.handle().clone()));

            let handle = app.handle().clone();
            thread::spawn(move || {
                thread::sleep(WINDOW_REVEAL_FALLBACK);
                if let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) {
                    if !window.is_visible().unwrap_or(true) {
                        // No focus steal: by now the user has long since looked
                        // elsewhere, and this path only runs when boot failed.
                        reveal_window(&window, None, false);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_data_path,
            show_main_window,
            sidecar_status,
            desktop_browser_status,
            desktop_browser_request,
            desktop_browser_configure,
            desktop_browser_clear_profile,
            desktop_browser_takeover,
            desktop_browser_resume,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Memorall desktop");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let supervisor = app_handle.state::<SidecarSupervisor>();
            tauri::async_runtime::block_on(supervisor.shutdown());
        }
    });
}
