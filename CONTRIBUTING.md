# Contributing

## Setup

You need:

- Node 26 (see `.nvmrc`)
- A stable Rust toolchain (`rustup`)
- Tauri CLI: `cargo install tauri-cli`
- Platform deps for Tauri:
  - Windows: the WebView2 runtime (already present on Windows 10/11)
  - macOS: Xcode command line tools
  - Linux (Debian/Ubuntu): `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libsoup-3.0-dev libjavascriptcoregtk-4.1-dev`

Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/ccmdi/mma
cd mma/app
npm install
```

## Run

```bash
cargo tauri dev
```

The web build (`--features web-serve`) is described in the [README](README.md#run-in-a-browser).

## Check your work

These are what CI runs on every pull request. Run them from `app/`:

```bash
npx oxlint
npx tsc --noEmit -p tsconfig.app.json
npx vitest run
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D clippy::correctness
```

`npm run format` runs prettier and rustfmt.

Some files are generated and committed. Regenerate and commit them when you change their source:

| After changing | Run |
|---|---|
| Tauri commands or types in Rust | `npm run gen:bindings` |
| Images under `img/manual/` | `npm run gen:image-dims` (CI fails if stale) |
| User-facing strings | `npm run gen:i18n` |
| Anything under `plugins/` | `node plugins/build-all.mjs` (CI fails if stale) |

## Commits

`npm install` installs git hooks. Pre-commit formats staged files and type checks. The commit message hook requires this subject format:

```
type(scope): subject
```

Types: `feat` `fix` `refactor` `chore` `test` `ci` `docs` `revert`. Scopes (optional): `selections` `render` `store` `sv` `editor` `maps` `tags` `plugins` `import` `ui`.

## Pull requests

Open an issue first for anything beyond a small fix, so scope is agreed before you build it. Keep PRs to one change. Add a test for new behavior.

## Optional parts of the repo

None of these are needed to build or run the app:

- `app/test/e2e/` - end-to-end suite, runs in Docker via `scripts/e2e.sh`.
- `plugins/` - plugin SDK and built-in plugins. See [plugins/README.md](plugins/README.md). The `vision` and `copyright` plugins have Rust sidecars with their own release workflows.
- `workers/feedback` - Cloudflare Worker behind the in-app bug report button.
- `app/public/opensv/opensv.js` - committed build artifact. Its source is not in the repo.
