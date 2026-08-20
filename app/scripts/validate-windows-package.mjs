import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preflight = process.argv.includes("--preflight");
const expectedArchiveHash = "0f344f83041a8aee15ee41db2e0e86249163c78d1e8e39ce0813dcdd1775ba88";
const expectedArchiveBytes = 125832121;

function fail(message) {
	throw new Error(`[windows-package] ${message}`);
}

async function sha256(file) {
	const hash = crypto.createHash("sha256");
	for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
	return hash.digest("hex");
}

function filesUnder(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(directory, entry.name);
		return entry.isDirectory() ? filesUnder(file) : [file];
	});
}

const config = JSON.parse(fs.readFileSync(path.join(appDir, "src-tauri/tauri.conf.json"), "utf8"));
if (config.productName !== "MMA-CN" || config.identifier !== "fun.tuxun.mmacn") {
	fail("Tauri productName or identifier is not configured for MMA-CN");
}
if (JSON.stringify(config.bundle?.targets) !== JSON.stringify(["nsis"])) {
	fail("the only bundle target must be NSIS");
}
if (config.bundle?.createUpdaterArtifacts !== false || config.plugins?.updater) {
	fail("the internal build must not use the upstream updater");
}
if (config.bundle?.resources?.["resources/tencent-lines.pmtiles"] !== "tencent-lines.pmtiles") {
	fail("Tencent PMTiles is not configured as a single Tauri resource");
}

const envFile = path.join(appDir, ".env.production.local");
if (!fs.existsSync(envFile)) fail(".env.production.local is missing");
const previousKey = process.env.VITE_PETAL_MAP_KEY;
delete process.env.VITE_PETAL_MAP_KEY;
const petalKey = loadEnv("production", appDir, "VITE_PETAL_MAP_KEY").VITE_PETAL_MAP_KEY?.trim();
if (previousKey === undefined) delete process.env.VITE_PETAL_MAP_KEY;
else process.env.VITE_PETAL_MAP_KEY = previousKey;
if (!petalKey) fail("VITE_PETAL_MAP_KEY is missing or empty");

const archive = path.join(appDir, "src-tauri/resources/tencent-lines.pmtiles");
if (!fs.existsSync(archive)) fail("Tencent PMTiles resource is missing");
const archiveBytes = fs.statSync(archive).size;
const archiveHash = await sha256(archive);
if (archiveBytes !== expectedArchiveBytes || archiveHash !== expectedArchiveHash) {
	fail("Tencent PMTiles failed its size or SHA-256 check");
}

if (preflight) {
	console.log(
		JSON.stringify({
			mode: "preflight",
			productName: config.productName,
			identifier: config.identifier,
			targets: config.bundle.targets,
			petalKeyPresent: true,
			archiveBytes,
			archiveSha256: archiveHash,
		}),
	);
	process.exit(0);
}

const dist = path.join(appDir, "dist");
if (!fs.existsSync(dist)) fail("dist is missing; run the production build first");
let keyEmbedded = false;
let upstreamUpdaterUrl = false;
let distBytes = 0;
const files = filesUnder(dist);
for (const file of files) {
	const data = fs.readFileSync(file);
	distBytes += data.length;
	if (data.includes(Buffer.from(petalKey))) keyEmbedded = true;
	if (data.includes(Buffer.from("github.com/ccmdi/mma/releases"))) upstreamUpdaterUrl = true;
}
if (!keyEmbedded) fail("the production frontend does not contain VITE_PETAL_MAP_KEY");
if (fs.existsSync(path.join(dist, "tencent-lines.pmtiles"))) {
	fail("Tencent PMTiles is present in dist and would be bundled twice");
}
if (upstreamUpdaterUrl) fail("the production frontend contains the upstream MMA updater URL");

console.log(
	JSON.stringify({
		mode: "complete",
		distFiles: files.length,
		distBytes,
		petalKeyEmbedded: true,
		tencentPmtilesInDist: false,
		upstreamUpdaterUrlInDist: false,
		archiveBytes,
		archiveSha256: archiveHash,
	}),
);
