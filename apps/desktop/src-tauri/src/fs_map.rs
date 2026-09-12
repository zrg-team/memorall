//! Scoped access to folders the user has explicitly mapped.
//!
//! The frontend can never name a path. It addresses files as `(root_id,
//! relative)`, and a root only comes into existence when the user picks it in
//! the OS folder dialog. That is deliberate: if the renderer could hand us an
//! absolute path we would have to trust it, and anything able to run script in
//! the web view could then read arbitrary files. The allowlist therefore lives
//! here, on disk beside the app data, and never round-trips through the page.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager};

/// One read of a mapped file may not exceed this. The bytes cross the IPC
/// boundary in a single message, so an unbounded read is an easy way to wedge
/// the web view on a file the user never meant to open.
const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct FsMapError {
    pub code: String,
    pub message: String,
}

impl FsMapError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

impl From<std::io::Error> for FsMapError {
    fn from(error: std::io::Error) -> Self {
        use std::io::ErrorKind;
        let code = match error.kind() {
            ErrorKind::NotFound => "NOT_FOUND",
            ErrorKind::AlreadyExists => "EXISTS",
            ErrorKind::PermissionDenied => "PERMISSION",
            _ => "IO",
        };
        FsMapError::new(code, error.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MappedRoot {
    pub id: String,
    pub label: String,
    pub path: PathBuf,
    #[serde(default)]
    pub read_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MappedRootDto {
    pub id: String,
    pub label: String,
    pub display_path: String,
    pub read_only: bool,
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct RootsFile {
    version: u32,
    roots: Vec<MappedRoot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsMapEntry {
    pub name: String,
    /// "file" or "directory". A symlink is reported as whatever it resolves to.
    pub kind: String,
    pub size: f64,
    pub mtime_ms: f64,
    pub birthtime_ms: f64,
    pub read_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsMapRevision {
    pub entries: u32,
    pub max_mtime_ms: f64,
}

pub struct MappedRoots {
    roots: Mutex<Vec<MappedRoot>>,
    file: PathBuf,
}

fn millis(time: std::io::Result<SystemTime>) -> f64 {
    time.ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Windows canonicalisation yields the verbatim form, which is what lets
/// `std::fs` exceed MAX_PATH. Keep it internally; strip it only for display.
fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    match text.strip_prefix(VERBATIM_PREFIX) {
        Some(rest) => rest.to_string(),
        None => text,
    }
}

const VERBATIM_PREFIX: &str = r"\\?\";

fn compare_key(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}

fn contains(root: &Path, candidate: &Path) -> bool {
    let root_key = compare_key(root);
    let candidate_key = compare_key(candidate);
    if candidate_key == root_key {
        return true;
    }
    let separator = std::path::MAIN_SEPARATOR;
    let prefix = if root_key.ends_with(separator) {
        root_key
    } else {
        format!("{root_key}{separator}")
    };
    candidate_key.starts_with(&prefix)
}

/// Split a caller-supplied relative path into components, refusing anything
/// that could escape. `..` is rejected outright rather than resolved: resolving
/// it here would mean reimplementing the platform's own path semantics, and
/// getting that subtly wrong is exactly how traversal bugs happen.
fn relative_components(relative: &str) -> Result<Vec<String>, FsMapError> {
    if relative.contains('\u{0}') {
        return Err(FsMapError::new("OUT_OF_SCOPE", "Path contains a NUL byte."));
    }
    let normalized = relative.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(FsMapError::new(
            "OUT_OF_SCOPE",
            "Path must be relative to the mapped folder.",
        ));
    }
    // "C:" and "C:/..." are absolute on Windows despite not starting with a
    // separator, and a UNC share becomes "//server/share" after normalising.
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' {
        return Err(FsMapError::new(
            "OUT_OF_SCOPE",
            "Path must be relative to the mapped folder.",
        ));
    }
    let mut parts = Vec::new();
    for part in normalized.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(FsMapError::new(
                "OUT_OF_SCOPE",
                "Path may not step outside the mapped folder.",
            ));
        }
        parts.push(part.to_string());
    }
    Ok(parts)
}

/// Resolve `relative` inside `root`, refusing anything that lands outside it.
///
/// The containment check runs *after* canonicalisation, which is the point: a
/// symlink inside the folder pointing at somewhere sensitive looks perfectly
/// innocent as a path and only reveals itself once resolved. When the leaf does
/// not exist yet (a create), the parent is canonicalised instead and the leaf
/// re-appended.
pub fn resolve_within_root(root: &Path, relative: &str) -> Result<PathBuf, FsMapError> {
    let parts = relative_components(relative)?;
    let root_canonical = root
        .canonicalize()
        .map_err(|_| FsMapError::new("NOT_FOUND", "The mapped folder is unavailable."))?;

    let mut candidate = root_canonical.clone();
    for part in &parts {
        candidate = candidate.join(part);
    }

    match candidate.canonicalize() {
        Ok(resolved) => {
            if !contains(&root_canonical, &resolved) {
                return Err(FsMapError::new(
                    "OUT_OF_SCOPE",
                    "Path resolves outside the mapped folder.",
                ));
            }
            Ok(resolved)
        }
        Err(_) => {
            let parent = candidate
                .parent()
                .ok_or_else(|| FsMapError::new("OUT_OF_SCOPE", "Path has no parent."))?;
            let parent_canonical = parent
                .canonicalize()
                .map_err(|_| FsMapError::new("NOT_FOUND", "Parent folder does not exist."))?;
            if !contains(&root_canonical, &parent_canonical) {
                return Err(FsMapError::new(
                    "OUT_OF_SCOPE",
                    "Path resolves outside the mapped folder.",
                ));
            }
            let leaf = candidate
                .file_name()
                .ok_or_else(|| FsMapError::new("OUT_OF_SCOPE", "Path has no file name."))?;
            Ok(parent_canonical.join(leaf))
        }
    }
}

/// Decode standard base64.
///
/// Writes arrive base64-encoded rather than as a JSON array of numbers: Tauri's
/// IPC is JSON, and `[104,105,...]` costs roughly ten bytes per byte, so saving
/// an image through a mapped folder would push tens of megabytes through the
/// bridge. Base64 costs about a third extra instead. Hand-rolled to avoid adding
/// a crate for twenty lines.
fn base64_decode(input: &str) -> Result<Vec<u8>, FsMapError> {
    fn sextet(byte: u8) -> Option<u32> {
        match byte {
            b'A'..=b'Z' => Some((byte - b'A') as u32),
            b'a'..=b'z' => Some((byte - b'a') as u32 + 26),
            b'0'..=b'9' => Some((byte - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let filtered: Vec<u8> = input
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect();
    let mut end = filtered.len();
    while end > 0 && filtered[end - 1] == b'=' {
        end -= 1;
    }
    let body = &filtered[..end];
    if body.len() % 4 == 1 {
        return Err(FsMapError::new("IO", "Malformed base64 write payload."));
    }
    let mut out = Vec::with_capacity(body.len() / 4 * 3 + 3);
    let mut accumulator: u32 = 0;
    let mut bits: u32 = 0;
    for &byte in body {
        let value = sextet(byte)
            .ok_or_else(|| FsMapError::new("IO", "Malformed base64 write payload."))?;
        accumulator = (accumulator << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((accumulator >> bits) & 0xFF) as u8);
        }
    }
    Ok(out)
}

/// Refuse to follow a symlink when about to modify or delete something.
fn reject_symlink(path: &Path) -> Result<(), FsMapError> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            return Err(FsMapError::new(
                "OUT_OF_SCOPE",
                "Refusing to write through a symbolic link.",
            ));
        }
    }
    Ok(())
}

fn entry_for(path: &Path, name: String) -> Result<FsMapEntry, FsMapError> {
    let meta = fs::metadata(path)?;
    let kind = if meta.is_dir() { "directory" } else { "file" };
    let modified = millis(meta.modified());
    let created = match meta.created() {
        Ok(value) => millis(Ok(value)),
        Err(_) => modified,
    };
    Ok(FsMapEntry {
        name,
        kind: kind.to_string(),
        size: meta.len() as f64,
        mtime_ms: modified,
        birthtime_ms: created,
        read_only: meta.permissions().readonly(),
    })
}

fn stable_id(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    compare_key(path).hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn to_dto(root: &MappedRoot) -> MappedRootDto {
    MappedRootDto {
        id: root.id.clone(),
        label: root.label.clone(),
        display_path: display_path(&root.path),
        read_only: root.read_only,
        available: root.path.is_dir(),
    }
}

impl MappedRoots {
    pub fn load(app: &tauri::AppHandle) -> Self {
        let file = match app.path().app_data_dir() {
            Ok(dir) => dir.join("mapped-roots.json"),
            Err(_) => PathBuf::from("mapped-roots.json"),
        };
        let roots = fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str::<RootsFile>(&text).ok())
            .map(|parsed| parsed.roots)
            .unwrap_or_default();
        Self {
            roots: Mutex::new(roots),
            file,
        }
    }

    fn persist(&self, roots: &[MappedRoot]) -> Result<(), FsMapError> {
        if let Some(parent) = self.file.parent() {
            fs::create_dir_all(parent)?;
        }
        let payload = serde_json::to_string_pretty(&RootsFile {
            version: 1,
            roots: roots.to_vec(),
        })
        .map_err(|error| FsMapError::new("IO", error.to_string()))?;
        // Write-then-rename: a crash mid-write must not leave a truncated
        // allowlist, because that silently unmaps the user's folders.
        let temporary = self.file.with_extension("json.tmp");
        fs::write(&temporary, payload)?;
        fs::rename(&temporary, &self.file)?;
        Ok(())
    }

    fn root(&self, root_id: &str) -> Result<MappedRoot, FsMapError> {
        self.roots
            .lock()
            .map_err(|_| FsMapError::new("IO", "Mapped folders are unavailable."))?
            .iter()
            .find(|root| root.id == root_id)
            .cloned()
            .ok_or_else(|| FsMapError::new("UNKNOWN_ROOT", "That folder is not mapped."))
    }

    fn list(&self) -> Vec<MappedRoot> {
        match self.roots.lock() {
            Ok(roots) => roots.clone(),
            Err(_) => Vec::new(),
        }
    }

    fn add(&self, path: PathBuf) -> Result<MappedRootDto, FsMapError> {
        let canonical = path
            .canonicalize()
            .map_err(|_| FsMapError::new("NOT_FOUND", "That folder could not be opened."))?;
        if !canonical.is_dir() {
            return Err(FsMapError::new("NOT_DIR", "That is not a folder."));
        }
        let mut roots = self
            .roots
            .lock()
            .map_err(|_| FsMapError::new("IO", "Mapped folders are unavailable."))?;

        // Overlapping roots would show the same file twice in the library under
        // two names, and let it be edited through both.
        for existing in roots.iter() {
            if contains(&existing.path, &canonical) || contains(&canonical, &existing.path) {
                return Err(FsMapError::new(
                    "EXISTS",
                    format!(
                        "That folder overlaps the mapped folder \"{}\".",
                        existing.label
                    ),
                ));
            }
        }

        let base = canonical
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "folder".to_string());
        let mut label = base.clone();
        let mut suffix = 2;
        while roots.iter().any(|root| root.label == label) {
            label = format!("{base} ({suffix})");
            suffix += 1;
        }

        let root = MappedRoot {
            id: stable_id(&canonical),
            label,
            path: canonical,
            read_only: false,
        };
        roots.push(root.clone());
        self.persist(&roots)?;
        Ok(to_dto(&root))
    }

    fn remove(&self, root_id: &str) -> Result<(), FsMapError> {
        let mut roots = self
            .roots
            .lock()
            .map_err(|_| FsMapError::new("IO", "Mapped folders are unavailable."))?;
        roots.retain(|root| root.id != root_id);
        self.persist(&roots)
    }
}


/// The event the frontend listens for when a mapped folder changes on disk.
pub const FS_MAP_CHANGED_EVENT: &str = "fs-map://changed";

/// How long to gather further changes before telling the frontend.
///
/// Saving a file in an editor is rarely one event — editors write, rename and
/// touch in quick succession, and a recursive copy is thousands. Without this
/// the UI would rebuild its tree once per event.
const WATCH_DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsMapChangePayload {
    pub root_id: String,
    /// Root-relative paths, deduplicated. Empty means "something changed, but
    /// too much to enumerate" — the frontend should refresh wholesale.
    pub paths: Vec<String>,
}

/// Watches mapped folders and forwards changes to the frontend.
///
/// One `notify` watcher per root rather than one shared recursive watch: roots
/// are unrelated directories anywhere on disk, and unmapping one must stop its
/// watch without disturbing the others.
pub struct FolderWatchers {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    pending: Arc<Mutex<HashMap<String, Vec<String>>>>,
    flush: Mutex<Option<Sender<()>>>,
}

impl FolderWatchers {
    pub fn new(app: tauri::AppHandle) -> Self {
        let pending: Arc<Mutex<HashMap<String, Vec<String>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (flush_tx, flush_rx) = channel::<()>();
        let drain = Arc::clone(&pending);

        // One debounce thread for every root: it wakes on the first change, then
        // sleeps out the quiet period so a burst collapses into one message.
        thread::spawn(move || {
            while flush_rx.recv().is_ok() {
                thread::sleep(WATCH_DEBOUNCE);
                // Swallow the wake-ups that arrived during the sleep; their
                // changes are already in `pending`.
                while flush_rx.try_recv().is_ok() {}
                let batches: Vec<(String, Vec<String>)> = {
                    let mut guard = match drain.lock() {
                        Ok(guard) => guard,
                        Err(_) => continue,
                    };
                    guard.drain().collect()
                };
                for (root_id, mut paths) in batches {
                    paths.sort();
                    paths.dedup();
                    // A very large burst (a checkout, an unzip) is not worth
                    // enumerating; the frontend refreshes the subtree instead.
                    if paths.len() > 64 {
                        paths.clear();
                    }
                    let _ = app.emit(
                        FS_MAP_CHANGED_EVENT,
                        FsMapChangePayload { root_id, paths },
                    );
                }
            }
        });

        Self {
            watchers: Mutex::new(HashMap::new()),
            pending,
            flush: Mutex::new(Some(flush_tx)),
        }
    }

    pub fn watch(&self, root: &MappedRoot) {
        let Ok(mut watchers) = self.watchers.lock() else {
            return;
        };
        if watchers.contains_key(&root.id) {
            return;
        }

        let root_id = root.id.clone();
        let root_path = root.path.clone();
        let pending = Arc::clone(&self.pending);
        let flush = match self.flush.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => None,
        };

        let handler = move |result: Result<Event, notify::Error>| {
            let Ok(event) = result else { return };
            // Access events are noise — reading a file is not a change, and on
            // some platforms they arrive constantly.
            if matches!(event.kind, EventKind::Access(_) | EventKind::Other) {
                return;
            }
            let relatives: Vec<String> = event
                .paths
                .iter()
                .filter_map(|path| relative_to(&root_path, path))
                .collect();
            if let Ok(mut guard) = pending.lock() {
                guard.entry(root_id.clone()).or_default().extend(relatives);
            }
            if let Some(flush) = &flush {
                let _ = flush.send(());
            }
        };

        match RecommendedWatcher::new(handler, Config::default()) {
            Ok(mut watcher) => {
                if watcher.watch(&root.path, RecursiveMode::Recursive).is_ok() {
                    watchers.insert(root.id.clone(), watcher);
                }
                // A failed watch is not fatal: the folder is still usable, it
                // just will not announce outside changes.
            }
            Err(_) => {}
        }
    }

    pub fn unwatch(&self, root_id: &str) {
        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.remove(root_id);
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(root_id);
        }
    }
}

/// Express `path` relative to `root`, or None when it escapes.
fn relative_to(root: &Path, path: &Path) -> Option<String> {
    let root_key = compare_key(root);
    let path_key = compare_key(path);
    let rest = path_key.strip_prefix(&root_key)?;
    let trimmed = rest.trim_start_matches(['/', '\\']);
    Some(trimmed.replace('\\', "/"))
}

fn target(
    state: &tauri::State<'_, MappedRoots>,
    root_id: &str,
    path: &str,
) -> Result<(MappedRoot, PathBuf), FsMapError> {
    let root = state.root(root_id)?;
    let resolved = resolve_within_root(&root.path, path)?;
    Ok((root, resolved))
}

fn assert_writable(root: &MappedRoot) -> Result<(), FsMapError> {
    if root.read_only {
        return Err(FsMapError::new(
            "READ_ONLY",
            "This folder is mapped read-only.",
        ));
    }
    Ok(())
}

fn leaf_name(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
pub fn fs_map_list_roots(
    state: tauri::State<'_, MappedRoots>,
    watchers: tauri::State<'_, FolderWatchers>,
) -> Vec<MappedRootDto> {
    let roots = state.list();
    // Also the startup path: the frontend lists roots as it mounts them, which
    // is exactly when the watches should exist.
    for root in &roots {
        if root.path.is_dir() {
            watchers.watch(root);
        }
    }
    roots.iter().map(to_dto).collect()
}

#[tauri::command]
pub async fn fs_map_add_root(
    app: tauri::AppHandle,
    state: tauri::State<'_, MappedRoots>,
    watchers: tauri::State<'_, FolderWatchers>,
) -> Result<Option<MappedRootDto>, FsMapError> {
    use tauri_plugin_dialog::DialogExt;
    // The dialog blocks until the user answers, so it must not occupy an async
    // runtime worker.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().blocking_pick_folder()
    })
    .await
    .map_err(|error| FsMapError::new("IO", error.to_string()))?;

    let picked = match picked {
        Some(value) => value,
        None => return Ok(None),
    };
    let path = picked
        .into_path()
        .map_err(|error| FsMapError::new("IO", error.to_string()))?;
    let added = state.add(path)?;
    if let Some(root) = state.list().into_iter().find(|root| root.id == added.id) {
        watchers.watch(&root);
    }
    Ok(Some(added))
}

#[tauri::command]
pub fn fs_map_remove_root(
    state: tauri::State<'_, MappedRoots>,
    watchers: tauri::State<'_, FolderWatchers>,
    root_id: String,
) -> Result<(), FsMapError> {
    watchers.unwatch(&root_id);
    state.remove(&root_id)
}

#[tauri::command]
pub fn fs_map_list(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    path: String,
) -> Result<Vec<FsMapEntry>, FsMapError> {
    let (_, resolved) = target(&state, &root_id, &path)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&resolved)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        // A child that vanished between readdir and stat should not fail the
        // whole listing; skip it.
        if let Ok(info) = entry_for(&entry.path(), name) {
            entries.push(info);
        }
    }
    Ok(entries)
}

#[tauri::command]
pub fn fs_map_stat(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    path: String,
) -> Result<FsMapEntry, FsMapError> {
    let (root, resolved) = target(&state, &root_id, &path)?;
    let name = match resolved.file_name() {
        Some(value) => value.to_string_lossy().to_string(),
        None => root.label.clone(),
    };
    entry_for(&resolved, name)
}

#[tauri::command]
pub fn fs_map_read(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    path: String,
    start: f64,
    end: f64,
) -> Result<tauri::ipc::Response, FsMapError> {
    let (_, resolved) = target(&state, &root_id, &path)?;
    let metadata = fs::metadata(&resolved)?;
    if metadata.is_dir() {
        return Err(FsMapError::new("IS_DIR", "That path is a folder."));
    }
    let size = metadata.len();
    let start = if start <= 0.0 { 0 } else { start as u64 };
    let end = if end < 0.0 {
        size
    } else {
        std::cmp::min(end as u64, size)
    };
    if start >= end {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    }
    let length = end - start;
    if length > MAX_READ_BYTES {
        return Err(FsMapError::new(
            "TOO_LARGE",
            "That file is too large to open here.",
        ));
    }
    let mut file = fs::File::open(&resolved)?;
    file.seek(SeekFrom::Start(start))?;
    let mut buffer = vec![0u8; length as usize];
    file.read_exact(&mut buffer)?;
    Ok(tauri::ipc::Response::new(buffer))
}

#[tauri::command]
pub fn fs_map_write(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    path: String,
    offset: f64,
    data_base64: String,
    truncate: bool,
) -> Result<(), FsMapError> {
    let (root, resolved) = target(&state, &root_id, &path)?;
    assert_writable(&root)?;
    reject_symlink(&resolved)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(truncate)
        .open(&resolved)?;
    let offset = if offset <= 0.0 { 0 } else { offset as u64 };
    file.seek(SeekFrom::Start(offset))?;
    file.write_all(&base64_decode(&data_base64)?)?;
    Ok(())
}

#[tauri::command]
pub fn fs_map_create_file(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    path: String,
) -> Result<FsMapEntry, FsMapError> {
    let (root, resolved) = target(&state, &root_id, &path)?;
    assert_writable(&root)?;
    // create_new, so a name that already exists on a case-insensitive volume
    // surfaces as EXISTS rather than silently truncating the user's file.
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&resolved)?;
    entry_for(&resolved, leaf_name(&resolved))
}

#[tauri::command]
pub fn fs_map_mkdir(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    path: String,
) -> Result<FsMapEntry, FsMapError> {
    let (root, resolved) = target(&state, &root_id, &path)?;
    assert_writable(&root)?;
    fs::create_dir(&resolved)?;
    entry_for(&resolved, leaf_name(&resolved))
}

#[tauri::command]
pub fn fs_map_unlink(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    path: String,
) -> Result<(), FsMapError> {
    let (root, resolved) = target(&state, &root_id, &path)?;
    assert_writable(&root)?;
    reject_symlink(&resolved)?;
    fs::remove_file(&resolved)?;
    Ok(())
}

#[tauri::command]
pub fn fs_map_rmdir(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    path: String,
) -> Result<(), FsMapError> {
    let (root, resolved) = target(&state, &root_id, &path)?;
    assert_writable(&root)?;
    if contains(&resolved, &root.path) {
        return Err(FsMapError::new(
            "PERMISSION",
            "Unmap the folder instead of deleting it.",
        ));
    }
    reject_symlink(&resolved)?;
    // Non-recursive on purpose: the virtual filesystem walks the tree itself,
    // so a recursive native delete would turn one wrong path into data loss.
    match fs::remove_dir(&resolved) {
        Ok(()) => Ok(()),
        Err(error) => {
            if error.raw_os_error() == Some(39) || error.raw_os_error() == Some(145) {
                Err(FsMapError::new("NOT_EMPTY", "That folder is not empty."))
            } else {
                Err(FsMapError::from(error))
            }
        }
    }
}

#[tauri::command]
pub fn fs_map_rename(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    from: String,
    to: String,
) -> Result<(), FsMapError> {
    let (root, source) = target(&state, &root_id, &from)?;
    assert_writable(&root)?;
    let destination = resolve_within_root(&root.path, &to)?;
    reject_symlink(&source)?;
    fs::rename(&source, &destination)?;
    Ok(())
}

#[tauri::command]
pub fn fs_map_touch(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    path: String,
    mtime_ms: f64,
) -> Result<(), FsMapError> {
    let (root, resolved) = target(&state, &root_id, &path)?;
    assert_writable(&root)?;
    let offset = if mtime_ms <= 0.0 { 0 } else { mtime_ms as u64 };
    let time = UNIX_EPOCH + std::time::Duration::from_millis(offset);
    let file = fs::OpenOptions::new().write(true).open(&resolved)?;
    file.set_modified(time)?;
    Ok(())
}

#[tauri::command]
pub fn fs_map_revision(
    state: tauri::State<'_, MappedRoots>,
    root_id: String,
    path: String,
) -> Result<FsMapRevision, FsMapError> {
    let (_, resolved) = target(&state, &root_id, &path)?;
    let mut entries = 0u32;
    let mut max_mtime_ms = 0.0f64;
    for entry in fs::read_dir(&resolved)? {
        let entry = entry?;
        entries += 1;
        if let Ok(meta) = entry.metadata() {
            let value = millis(meta.modified());
            if value > max_mtime_ms {
                max_mtime_ms = value;
            }
        }
    }
    Ok(FsMapRevision {
        entries,
        max_mtime_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_dir(name: &str) -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = env::temp_dir().join(format!(
            "memorall-fs-map-{name}-{}-{unique}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir.canonicalize().expect("canonical temp dir")
    }

    #[test]
    fn resolves_a_nested_path_inside_the_root() {
        let root = temp_dir("nested");
        fs::create_dir_all(root.join("a").join("b")).unwrap();
        fs::write(root.join("a").join("b").join("c.txt"), b"hi").unwrap();
        let resolved = resolve_within_root(&root, "a/b/c.txt").expect("resolves");
        assert!(contains(&root, &resolved));
    }

    #[test]
    fn allows_a_leaf_that_does_not_exist_yet() {
        let root = temp_dir("create");
        let resolved = resolve_within_root(&root, "new.txt").expect("resolves");
        assert_eq!(resolved.file_name().unwrap(), "new.txt");
        assert!(contains(&root, &resolved));
    }

    #[test]
    fn rejects_parent_traversal() {
        let root = temp_dir("traversal");
        for candidate in ["../outside.txt", "a/../../outside.txt", "..", "a/.."] {
            let error = resolve_within_root(&root, candidate).expect_err(candidate);
            assert_eq!(error.code, "OUT_OF_SCOPE", "{candidate}");
        }
    }

    #[test]
    fn rejects_absolute_drive_and_unc_paths() {
        let root = temp_dir("absolute");
        for candidate in ["/etc/passwd", "C:/Windows/System32", r"\\server\share\x"] {
            let error = resolve_within_root(&root, candidate).expect_err(candidate);
            assert_eq!(error.code, "OUT_OF_SCOPE", "{candidate}");
        }
    }

    #[test]
    fn rejects_a_nul_byte() {
        let root = temp_dir("nul");
        let error = resolve_within_root(&root, "a\u{0}b").expect_err("rejects");
        assert_eq!(error.code, "OUT_OF_SCOPE");
    }

    #[test]
    fn treats_an_empty_path_as_the_root_itself() {
        let root = temp_dir("empty");
        assert_eq!(resolve_within_root(&root, "").unwrap(), root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_escapes_the_root() {
        let root = temp_dir("symlink");
        let outside = temp_dir("symlink-outside");
        fs::write(outside.join("secret.txt"), b"secret").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        // The path looks entirely innocent until it is resolved.
        let error = resolve_within_root(&root, "link/secret.txt").expect_err("escapes");
        assert_eq!(error.code, "OUT_OF_SCOPE");
    }

    #[test]
    fn containment_accepts_a_child() {
        let root = temp_dir("child");
        let child = root.join("a.md");
        assert!(contains(&root, &child));
    }

    #[test]
    fn containment_rejects_a_sibling_sharing_a_prefix() {
        let root = PathBuf::from(if cfg!(windows) { r"C:\notes" } else { "/notes" });
        let sibling = PathBuf::from(if cfg!(windows) {
            r"C:\notes-private\a.md"
        } else {
            "/notes-private/a.md"
        });
        assert!(!contains(&root, &sibling));
    }

    #[cfg(windows)]
    #[test]
    fn containment_is_case_insensitive_on_windows() {
        let root = PathBuf::from(r"C:\Notes");
        let child = PathBuf::from(r"C:\notes\a.md");
        assert!(contains(&root, &child));
    }

    #[test]
    fn a_stable_id_survives_a_restart() {
        let root = temp_dir("id");
        assert_eq!(stable_id(&root), stable_id(&root));
    }

    #[test]
    fn base64_round_trips_every_padding_case() {
        // "", "f", "fo", "foo", "foob", "fooba", "foobar" is the RFC 4648 set.
        let cases = [
            ("", ""),
            ("Zg==", "f"),
            ("Zm8=", "fo"),
            ("Zm9v", "foo"),
            ("Zm9vYg==", "foob"),
            ("Zm9vYmE=", "fooba"),
            ("Zm9vYmFy", "foobar"),
        ];
        for (encoded, decoded) in cases {
            assert_eq!(
                base64_decode(encoded).unwrap(),
                decoded.as_bytes(),
                "{encoded}"
            );
        }
    }

    #[test]
    fn base64_handles_every_byte_value() {
        const ALPHABET: &[u8] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let original: Vec<u8> = (0u8..=255).collect();
        let mut encoded = String::new();
        for chunk in original.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = *chunk.get(1).unwrap_or(&0) as u32;
            let b2 = *chunk.get(2).unwrap_or(&0) as u32;
            let triple = (b0 << 16) | (b1 << 8) | b2;
            encoded.push(ALPHABET[((triple >> 18) & 63) as usize] as char);
            encoded.push(ALPHABET[((triple >> 12) & 63) as usize] as char);
            encoded.push(if chunk.len() > 1 {
                ALPHABET[((triple >> 6) & 63) as usize] as char
            } else {
                '='
            });
            encoded.push(if chunk.len() > 2 {
                ALPHABET[(triple & 63) as usize] as char
            } else {
                '='
            });
        }
        assert_eq!(base64_decode(&encoded).unwrap(), original);
    }

    #[test]
    fn relative_to_expresses_a_child_against_its_root() {
        let root = temp_dir("relative");
        let child = root.join("a").join("b.md");
        assert_eq!(relative_to(&root, &child).as_deref(), Some("a/b.md"));
        assert_eq!(relative_to(&root, &root).as_deref(), Some(""));
    }

    #[test]
    fn relative_to_refuses_a_path_outside_the_root() {
        let root = temp_dir("relative-outside");
        let elsewhere = temp_dir("relative-elsewhere").join("a.md");
        assert_eq!(relative_to(&root, &elsewhere), None);
    }

    #[test]
    fn base64_rejects_garbage() {
        assert!(base64_decode("!!!!").is_err());
        assert!(base64_decode("Zg===").is_ok());
        assert!(base64_decode("A").is_err());
    }
}
