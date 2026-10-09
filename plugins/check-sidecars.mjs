// Fail when a plugin sidecar's source or Cargo.toml changed since the base without a version
// bump, or when its manifest.json names a different sidecar version than Cargo.toml.
// Run: node plugins/check-sidecars.mjs   (base: $GATES_BASE, else origin/master, else HEAD~1)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** The package version declared in a Cargo.toml. */
export function cargoVersion(toml) {
	return toml.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "";
}

function git(...args) {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
}

function attempt(fn) {
	try {
		return fn();
	} catch {
		return null;
	}
}

function resolveBase() {
	for (const ref of [process.env.GATES_BASE, "origin/master", "HEAD~1", "HEAD"]) {
		const sha =
			ref && attempt(() => git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).trim());
		if (sha) return sha;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const base = resolveBase();
	console.log(`base ${base}`);
	let fail = 0;
	for (const name of readdirSync(join(root, "plugins")).sort()) {
		const sidecar = `plugins/${name}/sidecar`;
		const cargo = `${sidecar}/Cargo.toml`;
		if (!existsSync(join(root, cargo))) continue;
		const head = cargoVersion(readFileSync(join(root, cargo), "utf8"));
		const problems = [];
		if (git("diff", "--name-only", base, "HEAD", "--", `${sidecar}/src`, cargo).trim()) {
			const before = cargoVersion(attempt(() => git("show", `${base}:${cargo}`)) ?? "");
			if (head === before) problems.push(`sidecar changed but ${cargo} is still ${head}`);
		}
		const manifest = join(root, "plugins", name, "manifest.json");
		const named =
			existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).sidecar?.version;
		if (named && named !== head)
			problems.push(`manifest.json sidecar.version ${named} but ${cargo} is ${head}`);
		if (problems.length) fail = 1;
		console.log(problems.length ? `[${name}] FAIL: ${problems.join("; ")}` : `[${name}] ok`);
	}
	process.exit(fail);
}
