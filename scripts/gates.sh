#!/bin/sh
# Every CI gate, defined once. CI runs `gates.sh --env <env>` per environment; the pre-push
# hook runs them all. A `fresh` gate regenerates committed artifacts, so it runs after every
# other gate rather than racing a reader.
#
#   gates.sh                 all gates: node and rust lanes in parallel, then fresh gates
#   gates.sh --env node      one environment's gates, in order
#   gates.sh eslint vitest   the named gates, in order
#   gates.sh --list
set -u
root=$(cd "$(dirname "$0")/.." && pwd)

GATES='
eslint            node  app            npx eslint src/ test/e2e/
prettier          node  app            npx prettier --check src test procedures --ignore-path ../.prettierignore
typecheck         node  app            npm run typecheck
vitest            node  app            plugin_deps && npx vitest run
procedures        node  app            npm run test:procedures
check-legacy      node  app            node ../plugins/check-legacy.mjs
check-unstable    node  app            node ../plugins/check-unstable.mjs
check-floors      node  app            plugin_deps && node ../plugins/check-floors.mjs
check-tokens      node  app            node ../plugins/check-tokens.mjs
image-dims        node  app            fresh src/components/manual/manual-img-dims.gen.ts -- npm run gen:image-dims
plugin-types      node  app            fresh ../plugins/types/mma.d.ts -- npm run gen:plugin-types
plugin-build      node  .              fresh plugins -- node plugins/build-all.mjs
cargo-fmt         rust  app/src-tauri  cargo fmt --all -- --check
clippy            rust  app/src-tauri  cargo clippy -- -D clippy::correctness
cargo-test        rust  app/src-tauri  cargo test
mma-geo           rust  app/src-tauri  cargo test -p mma-geo
geocode           rust  app/src-tauri  cargo test --manifest-path crates/geocode/Cargo.toml
tz                rust  app/src-tauri  cargo test --manifest-path crates/tz/Cargo.toml
bindings          rust  app            fresh src/bindings.gen.ts src/bindings.consts.ts -- npm run gen:bindings
'

plugin_deps() { node "$root/plugins/build-all.mjs" --install; }

fresh() {
	paths=
	while [ "$1" != -- ]; do
		paths="$paths $1"
		shift
	done
	shift
	"$@" && git diff --exit-code -- $paths
}

tab=$(printf '\t')

table() {
	printf '%s\n' "$GATES" | while read -r name env dir cmd; do
		[ -n "$name" ] || continue
		case $env in
		node | rust) ;;
		*) echo "[gates] $name: unknown env '$env'" >&2 && exit 2 ;;
		esac
		case $cmd in
		fresh\ *) phase=fresh ;;
		*) phase=check ;;
		esac
		printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$env" "$phase" "$dir" "$cmd"
	done
}

pick() {
	table | awk -F'\t' -v env="$1" -v phase="$2" '(env == "" || $2 == env) && $3 == phase'
}

named() {
	for want; do
		line=$(table | awk -F'\t' -v n="$want" '$1 == n')
		[ -n "$line" ] || { echo "[gates] no gate named '$want'" >&2 && exit 2; }
		printf '%s\n' "$line"
	done
}

gate() {
	name=$1
	dir=$2
	cmd=$3
	if [ -n "${GITHUB_ACTIONS:-}" ]; then
		echo "::group::$name"
		(cd "$root/$dir" && eval "$cmd")
		status=$?
		echo "::endgroup::"
	else
		(cd "$root/$dir" && eval "$cmd") >"$tmp/$name.log" 2>&1
		status=$?
	fi
	if [ "$status" = 0 ]; then
		echo "[gate] $name ok"
		return
	fi
	echo "$name" >>"$tmp/failed"
	if [ -n "${GITHUB_ACTIONS:-}" ]; then
		echo "::error::gate $name failed"
	else
		echo "[gate] $name FAILED"
		tail -20 "$tmp/$name.log"
	fi
}

run() {
	while IFS=$tab read -r name env phase dir cmd; do
		gate "$name" "$dir" "$cmd" </dev/null
	done
}

table >/dev/null || exit 2

case ${1:-} in
--list)
	table | cut -f1-3
	exit
	;;
--env)
	case ${2:-} in
	node | rust) ;;
	*) echo "usage: gates.sh --env node|rust" >&2 && exit 2 ;;
	esac
	selection=$({ pick "$2" check && pick "$2" fresh; })
	;;
"") selection= ;;
*) selection=$(named "$@") || exit 2 ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The crate bundles procedures/*.js as resources and fails to build without them.
(cd "$root/app" && npm run --silent build:procedures >/dev/null) || exit 1

if [ -n "${1:-}" ]; then
	printf '%s\n' "$selection" | run
else
	pick node check | run &
	pick rust check | run &
	wait
	pick "" fresh | run
fi

if [ -f "$tmp/failed" ]; then
	echo "[gates] FAILED: $(tr '\n' ' ' <"$tmp/failed")"
	exit 1
fi
echo "[gates] all gates green"
