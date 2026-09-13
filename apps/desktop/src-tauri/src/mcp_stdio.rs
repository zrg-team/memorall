use serde_json::Value;
use std::time::Duration;

use crate::sidecar::{BrowserBridgeError, SidecarSupervisor};

/// Headroom over the budget the sidecar itself enforces, so its own timeout
/// error (which names the server) arrives before this one does.
const RESPONSE_MARGIN_MS: u64 = 5_000;
const DEFAULT_START_TIMEOUT_MS: u64 = 180_000;
const DEFAULT_CALL_TIMEOUT_MS: u64 = 120_000;

fn param_ms(params: &Value, key: &str) -> Option<u64> {
    params.get(key).and_then(Value::as_u64)
}

/// The sidecar method and response deadline for a local MCP server request.
///
/// Only these methods can be reached from the frontend: the sidecar accepts
/// more, and `method` arrives as an arbitrary string.
pub(crate) fn resolve(method: &str, params: &Value) -> Option<(&'static str, Duration)> {
    let start_budget = || {
        param_ms(params, "startTimeoutMs")
            .unwrap_or(DEFAULT_START_TIMEOUT_MS)
            .saturating_add(RESPONSE_MARGIN_MS)
            .clamp(10_000, 305_000)
    };
    let (name, timeout_ms): (&'static str, u64) = match method {
        "mcp.stdio.ensure" => ("mcp.stdio.ensure", start_budget()),
        // Listing tools may have to start the server first.
        "mcp.stdio.list-tools" => (
            "mcp.stdio.list-tools",
            start_budget().saturating_add(60_000),
        ),
        "mcp.stdio.call" => (
            "mcp.stdio.call",
            param_ms(params, "timeoutMs")
                .unwrap_or(DEFAULT_CALL_TIMEOUT_MS)
                .saturating_add(RESPONSE_MARGIN_MS)
                .clamp(5_000, 605_000),
        ),
        "mcp.stdio.cancel" => ("mcp.stdio.cancel", 10_000),
        "mcp.stdio.stop" => ("mcp.stdio.stop", 20_000),
        "mcp.stdio.status" => ("mcp.stdio.status", 10_000),
        "mcp.stdio.probe" => ("mcp.stdio.probe", 20_000),
        _ => return None,
    };
    Some((name, Duration::from_millis(timeout_ms)))
}

#[tauri::command]
pub async fn desktop_mcp_stdio_request(
    supervisor: tauri::State<'_, SidecarSupervisor>,
    method: String,
    params: Value,
) -> Result<Value, BrowserBridgeError> {
    let Some((sidecar_method, timeout)) = resolve(&method, &params) else {
        return Err(BrowserBridgeError::new(
            "MCP_STDIO_METHOD_NOT_ALLOWED",
            format!("Local MCP method is not allowed: {method}"),
        ));
    };
    supervisor.request(sidecar_method, params, timeout).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_only_allowlisted_methods() {
        for method in [
            "mcp.stdio.ensure",
            "mcp.stdio.list-tools",
            "mcp.stdio.call",
            "mcp.stdio.cancel",
            "mcp.stdio.stop",
            "mcp.stdio.status",
            "mcp.stdio.probe",
        ] {
            assert_eq!(
                resolve(method, &json!({})).map(|(name, _)| name),
                Some(method)
            );
        }
        assert!(resolve("browser.command", &json!({})).is_none());
        assert!(resolve("shutdown", &json!({})).is_none());
        assert!(resolve("mcp.stdio.connect", &json!({})).is_none());
    }

    #[test]
    fn derives_deadlines_from_the_requested_budget() {
        let call = |params: Value| resolve("mcp.stdio.call", &params).unwrap().1;
        assert_eq!(call(json!({})), Duration::from_millis(125_000));
        assert_eq!(
            call(json!({ "timeoutMs": 30_000 })),
            Duration::from_millis(35_000)
        );
        assert_eq!(
            call(json!({ "timeoutMs": 1 })),
            Duration::from_millis(5_001)
        );
        assert_eq!(
            call(json!({ "timeoutMs": 10_000_000 })),
            Duration::from_millis(605_000)
        );

        let ensure = |params: Value| resolve("mcp.stdio.ensure", &params).unwrap().1;
        assert_eq!(ensure(json!({})), Duration::from_millis(185_000));
        assert_eq!(
            ensure(json!({ "startTimeoutMs": 1 })),
            Duration::from_millis(10_000)
        );
        assert_eq!(
            ensure(json!({ "startTimeoutMs": 900_000 })),
            Duration::from_millis(305_000)
        );
    }
}
