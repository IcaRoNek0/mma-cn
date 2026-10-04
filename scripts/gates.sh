#!/bin/sh
# Mirrors the CI gates (lint.yml + plugins.yml): green here means CI is green.
# Read-only gates run in two parallel lanes; gates that regenerate committed
# artifacts run sequentially afterwards so they never race a reader or each other.
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

gate() {
	name=$1
	shift
	if "$@" >"$tmp/$name.log" 2>&1; then
		echo "[gate] $name ok"
	else
		echo "$name" >>"$tmp/failed"
		echo "[gate] $name FAILED"
		tail -20 "$tmp/$name.log"
	fi
}

(
	cd "$root/app" || { echo cd-app >>"$tmp/failed"; exit 1; }
	gate eslint npx eslint src/ test/e2e/
	gate prettier npx prettier --check src test procedures --ignore-path ../.prettierignore
	gate typecheck npm run typecheck
	gate vitest npx vitest run
	gate procedures npm run test:procedures
	gate check-legacy node ../plugins/check-legacy.mjs
	gate check-unstable node ../plugins/check-unstable.mjs
	gate check-floors node ../plugins/check-floors.mjs
	gate check-tokens node ../plugins/check-tokens.mjs
) &
js=$!

(
	cd "$root/app/src-tauri" || { echo cd-src-tauri >>"$tmp/failed"; exit 1; }
	gate cargo-fmt cargo fmt --all -- --check
	gate clippy cargo clippy -- -D clippy::correctness
	gate cargo-test cargo test
	gate mma-geo cargo test -p mma-geo
	gate geocode cargo test --manifest-path crates/geocode/Cargo.toml
	gate tz cargo test --manifest-path crates/tz/Cargo.toml
) &
rust=$!

wait "$js" "$rust"

(
	cd "$root/app" || { echo cd-app-gen >>"$tmp/failed"; exit 1; }
	gate image-dims sh -c "npm run gen:image-dims && git diff --exit-code -- src/components/manual/manual-img-dims.gen.ts"
	gate plugin-types sh -c "npm run gen:plugin-types && git diff --exit-code -- ../plugins/types/mma.d.ts"
	gate bindings sh -c "npm run gen:bindings && git diff --exit-code -- src/bindings.gen.ts src/bindings.consts.ts"
	gate plugin-build sh -c "cd .. && node plugins/build-all.mjs && git diff --exit-code -- plugins/"
)

if [ -f "$tmp/failed" ]; then
	echo "[gates] FAILED: $(tr '\n' ' ' <"$tmp/failed")"
	exit 1
fi
echo "[gates] all gates green"
