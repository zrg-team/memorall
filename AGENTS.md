# Repository agent instructions

## Git branch naming

- Protected branch names are `main`, `master`, and `develop`.
- Every task branch must use `<type>/<lowercase-kebab-case-description>`.
- Allowed types are `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `style`, `perf`, `build`, `ci`, `revert`, `release`, and `hotfix`.
- Dependency upgrades use `chore/`, for example `chore/upgrade-web-extension-desktop-dependencies`.
- Names with other prefixes, uppercase letters, underscores, repeated hyphens, or nested path segments are invalid.
- Husky and CI enforce the complete naming standard; do not bypass `check:branch-name`.
