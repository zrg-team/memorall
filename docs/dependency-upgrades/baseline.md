# Dependency-upgrade baseline

Captured on 2026-08-13 before the staged dependency upgrade.

## Toolchains

- Repository package manager: Yarn 4.14.1 with the `node-modules` linker.
- Local baseline runtime: Node 22.16.0; upgrade target: Node 22.23.1 LTS.
- Rust and Cargo baseline/target: 1.97.1.

## Verification baseline

- `yarn check`: 109 test files and 555 tests passed.
- `yarn test:desktop:sidecar`: 2 test files and 4 tests passed.
- `yarn dedupe --check`: 48 deduplication candidates.
- `yarn explain peer-requirements`: 28 unsatisfied peer groups.
- `yarn npm audit --all --recursive`: 190 findings: 3 critical, 56 high,
  115 moderate, and 16 low. Deprecation notices are included in these counts.

The post-upgrade audit is expected to eliminate direct actionable advisories and
must not introduce a new high- or critical-severity production advisory. Some
optional or build-only transitive warnings may remain when no compatible
upstream release exists; each such exception must be recorded in the final
upgrade report.

## Version-bound patches

| Package | Baseline version | Required behavior |
| --- | --- | --- |
| `extension-develop` | 3.16.1 | Keep unwanted extension reload/HMR injection disabled. |
| `@hyperframes/core` | 0.6.33 | Keep lint exports resolvable and runtime dependencies local/CSP-safe. |
| `jspdf` | 4.2.1 | Prevent PDFObject or other remotely loaded executable code. |
| `util` | 0.12.5 | Prevent browser bundles from reading `process.env.NODE_DEBUG`. |

For each upgraded target, remove the old patch only after proving the upstream
fix with the same regression check. Otherwise regenerate a minimal patch whose
filename matches the resolved version, then verify it with
`patch-package --error-on-fail` during a clean install.

## Existing native-build constraint

Plain `cargo check` from a normal Windows PowerShell session fails because the
MSVC environment cannot locate `msvcrt.lib`. Windows native validation must use
the repository Tauri wrapper, which loads the Visual Studio developer
environment before invoking Cargo.
