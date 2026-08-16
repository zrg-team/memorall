use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{async_runtime::Receiver, path::BaseDirectory, AppHandle, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::{sync::oneshot, time::timeout};

pub const SIDECAR_PROTOCOL_VERSION: u16 = 3;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub protocol_version: u16,
    pub running: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct BrowserBridgeError {
    pub code: String,
    pub message: String,
}

impl BrowserBridgeError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn exited(message: impl Into<String>) -> Self {
        Self::new("SIDECAR_EXITED", message)
    }

    fn is_restartable(&self) -> bool {
        matches!(
            self.code.as_str(),
            "SIDECAR_EXITED" | "SIDECAR_WRITE_FAILED"
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarResponse {
    protocol_version: u16,
    id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<SidecarResponseError>,
}

#[derive(Debug, Deserialize)]
struct SidecarResponseError {
    code: String,
    message: String,
}

type PendingSender = oneshot::Sender<Result<Value, BrowserBridgeError>>;

pub struct SidecarSupervisor {
    app: AppHandle,
    child: Arc<Mutex<Option<CommandChild>>>,
    pending: Arc<Mutex<HashMap<String, PendingSender>>>,
    start_lock: tokio::sync::Mutex<()>,
    request_counter: AtomicU64,
}

impl SidecarSupervisor {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            child: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            start_lock: tokio::sync::Mutex::new(()),
            request_counter: AtomicU64::new(0),
        }
    }

    pub fn status(&self) -> SidecarStatus {
        SidecarStatus {
            protocol_version: SIDECAR_PROTOCOL_VERSION,
            running: self
                .child
                .lock()
                .map(|child| child.is_some())
                .unwrap_or(false),
        }
    }

    pub async fn request(
        &self,
        method: &'static str,
        params: Value,
        request_timeout: Duration,
    ) -> Result<Value, BrowserBridgeError> {
        let mut last_error = None;
        for attempt in 0..2 {
            match self
                .request_once(method, params.clone(), request_timeout)
                .await
            {
                Ok(result) => return Ok(result),
                Err(error) if attempt == 0 && error.is_restartable() => {
                    last_error = Some(error);
                    self.terminate_child();
                }
                Err(error) => return Err(error),
            }
        }
        Err(last_error.unwrap_or_else(|| {
            BrowserBridgeError::new("SIDECAR_START_FAILED", "Desktop sidecar did not start.")
        }))
    }

    pub async fn shutdown(&self) {
        if self.status().running {
            let _ = self
                .request_once("shutdown", json!({}), Duration::from_secs(5))
                .await;
        }
        self.terminate_child();
    }

    async fn request_once(
        &self,
        method: &'static str,
        params: Value,
        request_timeout: Duration,
    ) -> Result<Value, BrowserBridgeError> {
        self.ensure_started().await?;
        let id = format!(
            "desktop-{}",
            self.request_counter.fetch_add(1, Ordering::Relaxed) + 1
        );
        let payload = json!({
            "protocolVersion": SIDECAR_PROTOCOL_VERSION,
            "id": id,
            "method": method,
            "params": params,
        });
        let mut framed = serde_json::to_vec(&payload).map_err(|error| {
            BrowserBridgeError::new("INVALID_BROWSER_REQUEST", error.to_string())
        })?;
        framed.push(b'\n');

        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| {
                BrowserBridgeError::new("SIDECAR_STATE_ERROR", "Pending request state is poisoned.")
            })?
            .insert(id.clone(), sender);

        let write_result = self
            .child
            .lock()
            .map_err(|_| {
                BrowserBridgeError::new("SIDECAR_STATE_ERROR", "Sidecar child state is poisoned.")
            })?
            .as_mut()
            .ok_or_else(|| BrowserBridgeError::exited("Desktop sidecar is not running."))?
            .write(&framed);
        if let Err(error) = write_result {
            self.remove_pending(&id);
            return Err(BrowserBridgeError::new(
                "SIDECAR_WRITE_FAILED",
                format!("Failed to send request to desktop sidecar: {error}"),
            ));
        }

        match timeout(request_timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(BrowserBridgeError::exited(
                "Desktop sidecar stopped before returning a response.",
            )),
            Err(_) => {
                self.remove_pending(&id);
                self.send_cancel(&id);
                Err(BrowserBridgeError::new(
                    "BROWSER_TIMEOUT",
                    format!(
                        "Desktop browser request timed out after {} ms.",
                        request_timeout.as_millis()
                    ),
                ))
            }
        }
    }

    async fn ensure_started(&self) -> Result<(), BrowserBridgeError> {
        if self.status().running {
            return Ok(());
        }
        let _guard = self.start_lock.lock().await;
        if self.status().running {
            return Ok(());
        }

        let script_path =
            Self::node_compatible_path(self.resource_path("desktop-sidecar/index.mjs")?);
        if !script_path.is_file() {
            return Err(BrowserBridgeError::new(
                "BROWSER_RESOURCES_MISSING",
                format!(
                    "Bundled desktop browser sidecar is missing: {}",
                    script_path.display()
                ),
            ));
        }
        let browser_runtime_path =
            Self::node_compatible_path(self.resource_path("browser-runtime")?);
        let browseros_path = browser_runtime_path.join("browseros");
        let lightpanda_path = browser_runtime_path.join("lightpanda");
        #[cfg(target_os = "windows")]
        let browseros_browser_relative = "Chrome-bin/chrome.exe";
        #[cfg(target_os = "windows")]
        let browser_renderer_version = "148.0.7985.97";
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        let browseros_browser_relative = "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        let browser_renderer_version = "151.0.7922.34";
        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        let browseros_browser_relative =
            "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        let browser_renderer_version = "151.0.7922.34";
        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        let browseros_browser_relative = "chrome-linux/chrome";
        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        let browser_renderer_version = "151.0.7922.34";
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        let browseros_browser_relative = "chrome-linux64/chrome";
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        let browser_renderer_version = "151.0.7922.34";
        // Mirrors the pinned target's "automation" field in
        // apps/desktop/browser-runtime.lock.json: only the BrowserOS build
        // serves the BrowserOS protocol, every other target is plain CDP.
        #[cfg(target_os = "windows")]
        let browser_automation = "browseros-and-cdp";
        #[cfg(not(target_os = "windows"))]
        let browser_automation = "cdp";
        #[cfg(target_os = "windows")]
        let (browseros_server_name, lightpanda_name) = ("browseros-server.exe", "lightpanda.exe");
        #[cfg(not(target_os = "windows"))]
        let (browseros_server_name, lightpanda_name) = ("browseros-server", "lightpanda");
        let app_data_path =
            Self::node_compatible_path(self.app.path().app_data_dir().map_err(|error| {
                BrowserBridgeError::new("SIDECAR_START_FAILED", error.to_string())
            })?);
        let sidecar_directory = script_path.parent().ok_or_else(|| {
            BrowserBridgeError::new(
                "SIDECAR_START_FAILED",
                "Sidecar resource path has no parent.",
            )
        })?;

        let command = self
            .app
            .shell()
            .sidecar("memorall-node")
            .map_err(|error| BrowserBridgeError::new("SIDECAR_START_FAILED", error.to_string()))?
            .arg(&script_path)
            .current_dir(sidecar_directory)
            .env("MEMORALL_DESKTOP_APP_DATA_DIR", &app_data_path)
            .env("MEMORALL_BROWSER_RUNTIME_DIR", &browser_runtime_path)
            .env(
                "MEMORALL_BROWSEROS_BROWSER_PATH",
                browseros_path.join(browseros_browser_relative),
            )
            .env(
                "MEMORALL_BROWSEROS_SERVER_PATH",
                browseros_path.join(browseros_server_name),
            )
            .env(
                "MEMORALL_LIGHTPANDA_PATH",
                lightpanda_path.join(lightpanda_name),
            )
            .env("MEMORALL_BROWSER_AUTOMATION", browser_automation)
            .env("MEMORALL_BROWSEROS_VERSION", "0.0.37")
            .env(
                "MEMORALL_BROWSER_RENDERER_VERSION",
                browser_renderer_version,
            )
            .env("MEMORALL_LIGHTPANDA_VERSION", "0.3.6")
            .set_raw_out(true);
        let (receiver, child) = command.spawn().map_err(|error| {
            BrowserBridgeError::new(
                "SIDECAR_START_FAILED",
                format!("Failed to start bundled desktop sidecar: {error}"),
            )
        })?;
        *self.child.lock().map_err(|_| {
            BrowserBridgeError::new("SIDECAR_STATE_ERROR", "Sidecar child state is poisoned.")
        })? = Some(child);
        Self::spawn_reader(receiver, self.child.clone(), self.pending.clone());
        Ok(())
    }

    fn resource_path(&self, relative: &str) -> Result<PathBuf, BrowserBridgeError> {
        self.app
            .path()
            .resolve(relative, BaseDirectory::Resource)
            .map_err(|error| {
                BrowserBridgeError::new("BROWSER_RESOURCES_MISSING", error.to_string())
            })
    }

    fn node_compatible_path(path: PathBuf) -> PathBuf {
        #[cfg(windows)]
        {
            let display = path.to_string_lossy();
            if let Some(ordinary_path) = display.strip_prefix(r"\\?\") {
                return PathBuf::from(ordinary_path);
            }
        }
        path
    }

    fn spawn_reader(
        mut receiver: Receiver<CommandEvent>,
        child: Arc<Mutex<Option<CommandChild>>>,
        pending: Arc<Mutex<HashMap<String, PendingSender>>>,
    ) {
        tauri::async_runtime::spawn(async move {
            let mut stdout = Vec::<u8>::new();
            let mut stderr = String::new();
            let mut terminal_error =
                BrowserBridgeError::exited("Desktop sidecar output stream closed.");
            while let Some(event) = receiver.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        stdout.extend_from_slice(&bytes);
                        for line in Self::drain_response_frames(&mut stdout) {
                            match serde_json::from_slice::<SidecarResponse>(&line) {
                                Ok(response)
                                    if response.protocol_version == SIDECAR_PROTOCOL_VERSION =>
                                {
                                    Self::deliver_response(&pending, response);
                                }
                                Ok(response) => {
                                    terminal_error = BrowserBridgeError::new(
                                        "SIDECAR_PROTOCOL_MISMATCH",
                                        format!(
                                            "Desktop sidecar protocol {} is incompatible with required protocol {}.",
                                            response.protocol_version, SIDECAR_PROTOCOL_VERSION
                                        ),
                                    );
                                    Self::fail_pending(&pending, terminal_error.clone());
                                    Self::kill_shared_child(&child);
                                    return;
                                }
                                Err(error) => {
                                    terminal_error = BrowserBridgeError::new(
                                        "SIDECAR_PROTOCOL_ERROR",
                                        format!("Invalid sidecar response frame: {error}"),
                                    );
                                    Self::fail_pending(&pending, terminal_error.clone());
                                    Self::kill_shared_child(&child);
                                    return;
                                }
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        stderr.push_str(&String::from_utf8_lossy(&bytes));
                        if stderr.len() > 8_192 {
                            stderr.drain(..stderr.len() - 8_192);
                        }
                    }
                    CommandEvent::Error(message) => {
                        terminal_error = BrowserBridgeError::exited(message);
                        break;
                    }
                    CommandEvent::Terminated(payload) => {
                        let details = if stderr.trim().is_empty() {
                            format!("Desktop sidecar exited with code {:?}.", payload.code)
                        } else {
                            format!(
                                "Desktop sidecar exited with code {:?}: {}",
                                payload.code,
                                stderr.trim()
                            )
                        };
                        terminal_error = BrowserBridgeError::exited(details);
                        break;
                    }
                    _ => {}
                }
            }
            if let Ok(mut guard) = child.lock() {
                guard.take();
            }
            Self::fail_pending(&pending, terminal_error);
        });
    }

    fn deliver_response(
        pending: &Arc<Mutex<HashMap<String, PendingSender>>>,
        response: SidecarResponse,
    ) {
        let sender = pending
            .lock()
            .ok()
            .and_then(|mut requests| requests.remove(&response.id));
        if let Some(sender) = sender {
            let result = if response.ok {
                Ok(response.result.unwrap_or(Value::Null))
            } else {
                let error = response.error.unwrap_or(SidecarResponseError {
                    code: "SIDECAR_REQUEST_FAILED".into(),
                    message: "Desktop sidecar request failed without details.".into(),
                });
                Err(BrowserBridgeError::new(error.code, error.message))
            };
            let _ = sender.send(result);
        }
    }

    fn drain_response_frames(buffer: &mut Vec<u8>) -> Vec<Vec<u8>> {
        let mut frames = Vec::new();
        while let Some(newline) = buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = buffer.drain(..=newline).collect::<Vec<_>>();
            while matches!(line.last(), Some(b'\n' | b'\r')) {
                line.pop();
            }
            if !line.is_empty() {
                frames.push(line);
            }
        }
        frames
    }

    fn send_cancel(&self, target_id: &str) {
        let cancel_id = format!(
            "cancel-{}",
            self.request_counter.fetch_add(1, Ordering::Relaxed) + 1
        );
        let payload = json!({
            "protocolVersion": SIDECAR_PROTOCOL_VERSION,
            "id": cancel_id,
            "method": "cancel",
            "params": { "id": target_id },
        });
        if let Ok(mut framed) = serde_json::to_vec(&payload) {
            framed.push(b'\n');
            if let Ok(mut child) = self.child.lock() {
                if let Some(child) = child.as_mut() {
                    let _ = child.write(&framed);
                }
            }
        }
    }

    fn remove_pending(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(id);
        }
    }

    fn terminate_child(&self) {
        Self::kill_shared_child(&self.child);
        Self::fail_pending(
            &self.pending,
            BrowserBridgeError::exited("Desktop sidecar was stopped."),
        );
    }

    fn kill_shared_child(child: &Arc<Mutex<Option<CommandChild>>>) {
        if let Ok(mut child) = child.lock() {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
        }
    }

    fn fail_pending(
        pending: &Arc<Mutex<HashMap<String, PendingSender>>>,
        error: BrowserBridgeError,
    ) {
        let requests = pending
            .lock()
            .map(|mut pending| {
                pending
                    .drain()
                    .map(|(_, sender)| sender)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for sender in requests {
            let _ = sender.send(Err(error.clone()));
        }
    }
}

impl Drop for SidecarSupervisor {
    fn drop(&mut self) {
        self.terminate_child();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn success_response(id: &str, value: Value) -> SidecarResponse {
        SidecarResponse {
            protocol_version: SIDECAR_PROTOCOL_VERSION,
            id: id.into(),
            ok: true,
            result: Some(value),
            error: None,
        }
    }

    #[test]
    fn frames_fragmented_and_concatenated_ndjson() {
        let mut buffer = br#"{"protocolVersion":3,"id":"a""#.to_vec();
        assert!(SidecarSupervisor::drain_response_frames(&mut buffer).is_empty());
        buffer.extend_from_slice(br#", "ok":true}"#);
        buffer.extend_from_slice(&[b'\r', b'\n']);
        buffer.extend_from_slice(br#"{"protocolVersion":3,"id":"b","ok":true}"#);
        buffer.push(b'\n');
        buffer.extend_from_slice(b"partial");

        let frames = SidecarSupervisor::drain_response_frames(&mut buffer);
        assert_eq!(frames.len(), 2);
        assert_eq!(buffer, b"partial");
        assert_eq!(
            serde_json::from_slice::<SidecarResponse>(&frames[0])
                .expect("first frame")
                .id,
            "a"
        );
        assert_eq!(
            serde_json::from_slice::<SidecarResponse>(&frames[1])
                .expect("second frame")
                .id,
            "b"
        );
    }

    #[test]
    fn correlates_concurrent_responses_by_id() {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (sender_a, receiver_a) = oneshot::channel();
        let (sender_b, receiver_b) = oneshot::channel();
        pending
            .lock()
            .expect("pending lock")
            .extend([("a".into(), sender_a), ("b".into(), sender_b)]);

        SidecarSupervisor::deliver_response(&pending, success_response("b", json!({ "n": 2 })));
        assert_eq!(
            receiver_b
                .blocking_recv()
                .expect("response b")
                .expect("ok b"),
            json!({ "n": 2 })
        );
        assert_eq!(pending.lock().expect("pending lock").len(), 1);

        SidecarSupervisor::deliver_response(&pending, success_response("a", json!({ "n": 1 })));
        assert_eq!(
            receiver_a
                .blocking_recv()
                .expect("response a")
                .expect("ok a"),
            json!({ "n": 1 })
        );
        assert!(pending.lock().expect("pending lock").is_empty());
    }

    #[test]
    fn child_exit_fails_every_pending_request_and_restart_is_bounded() {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (sender_a, receiver_a) = oneshot::channel();
        let (sender_b, receiver_b) = oneshot::channel();
        pending
            .lock()
            .expect("pending lock")
            .extend([("a".into(), sender_a), ("b".into(), sender_b)]);
        let exited = BrowserBridgeError::exited("test child exit");

        SidecarSupervisor::fail_pending(&pending, exited);

        for receiver in [receiver_a, receiver_b] {
            let error = receiver
                .blocking_recv()
                .expect("pending response")
                .expect_err("child exit error");
            assert_eq!(error.code, "SIDECAR_EXITED");
            assert!(error.is_restartable());
        }
        assert!(pending.lock().expect("pending lock").is_empty());
        assert!(!BrowserBridgeError::new("BROWSER_TIMEOUT", "timeout").is_restartable());
    }
}
