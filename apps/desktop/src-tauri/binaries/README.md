# Managed runtime staging

Release preparation places the pinned Node 22 executable here using Tauri's
target-triple naming convention, for example:

- `memorall-node-x86_64-pc-windows-msvc.exe`
- `memorall-node-x86_64-unknown-linux-gnu`
- `memorall-node-aarch64-apple-darwin`
- `memorall-node-x86_64-apple-darwin`

The matching npm CLI and Node standard-library files must be staged as resources
by the release job. Binaries are intentionally not committed to source control.
Every downloaded archive must be pinned and SHA-256 verified before packaging.
