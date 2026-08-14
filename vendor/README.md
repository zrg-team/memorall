# Vendored packages

## SheetJS Community Edition 0.20.3

- File: `xlsx-0.20.3.tgz`
- Upstream source: `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
- SHA-256: `8DC73FC3B00203E72D176E85B50938627C7B086E607C682E8D3C22C02BB99FE8`
- Retrieved: 2026-08-14

SheetJS publishes current Community Edition releases from its own CDN rather
than the npm registry. The tarball is committed and referenced with a local
`file:` dependency so immutable installs remain reproducible and do not fetch
executable package code from a live URL.

When upgrading, download the explicitly reviewed release, verify and record its
checksum here, replace the tarball and exact `file:` reference together, then
run the Excel adapter tests and all Web, Extension, and Desktop build gates.
