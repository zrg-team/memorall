use crate::sidecar::{BrowserBridgeError, SidecarSupervisor};
use serde_json::{json, Value};
use std::time::Duration;

#[tauri::command]
pub async fn desktop_sandbox_status(
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<Value, BrowserBridgeError> {
    supervisor
        .request("sandbox.status", json!({}), Duration::from_secs(10))
        .await
}

#[tauri::command]
pub async fn desktop_sandbox_request(
    supervisor: tauri::State<'_, SidecarSupervisor>,
    operation: String,
    payload: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, BrowserBridgeError> {
    // The sidecar owns a second operation allowlist. No generic process or
    // arbitrary sidecar-method forwarding is exposed to a webview.
    let budget = timeout_ms.unwrap_or(120_000).clamp(5_000, 900_000);
    supervisor
        .request(
            "sandbox.request",
            json!({ "operation": operation, "payload": payload, "timeoutMs": budget }),
            Duration::from_millis(budget.saturating_add(310_000)),
        )
        .await
}

#[tauri::command]
pub async fn desktop_sandbox_stop(
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<Value, BrowserBridgeError> {
    supervisor
        .request("sandbox.stop", json!({}), Duration::from_secs(30))
        .await
}
