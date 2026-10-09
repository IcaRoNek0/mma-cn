import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { waitForReady } from "./helpers";
import {
	addFixture,
	createMap,
	dropMap,
	dumpRows,
	collectNet,
	resetTimelines,
	runCompute,
	runEnrich,
	runPin,
	runValidate,
	setEnrich,
} from "./parityDriver";
import { MOCK_GENERIC_IMAGE_DATE } from "./parityFixture";
import { measureProcessTree } from "../perf/processTelemetry";
import {
	benchmarkCase,
	collectEnvironment,
	writeBenchmarkReport,
	type BenchmarkRawSample,
	type BenchmarkReport,
} from "../perf/benchmarkHarness";

/**
 * The procedures at the scale people actually run them: 10k-100k rows, mixed with the
 * same hostile shapes the small fixture uses, so the paging and wave machinery is
 * exercised rather than a single batch.
 *
 *   MMA_SCALE_ROWS=10000 MMA_E2E_SV_HIDDEN_CAPTURE=1 bash scripts/e2e.sh --mock \
 *     test/e2e/procedure-scale.test.ts
 *   MMA_SCALE_FIELDS=metadata   # skip datetime: ~40x fewer requests, for the 100k runs
 *
 * A per-row dump would be tens of megabytes, so parity at this size is a digest: the
 * same rows in the same order hashed to one line. Equal digests mean every row matched;
 * unequal digests send you back to the small fixture, which prints actual diffs.
 */

const ROWS = Number(process.env.MMA_SCALE_ROWS ?? 10000);
const SEED = 12345;
const LABEL = process.env.MMA_SCALE_LABEL ?? "";
const BENCH = Boolean(process.env.MMA_BENCH_REVISION);
const SAMPLES = BENCH ? Number(process.env.MMA_BENCH_SAMPLES ?? 5) : 1;
const WARMUPS = BENCH ? Number(process.env.MMA_BENCH_WARMUPS ?? 1) : 0;
const PHASES = ["enrich", "pin", "validate", "compute"] as const;
type Phase = (typeof PHASES)[number];
const METADATA_ONLY = process.env.MMA_SCALE_FIELDS === "metadata";
const FIELDS = METADATA_ONLY
	? ["countryCode", "altitude", "cameraType", "panoType", "imageDate"]
	: ["countryCode", "altitude", "cameraType", "panoType", "imageDate", "datetime"];

const DAY = 86400;
const CHUNK = 5000;
/** The exact-date search's own shape: BRANCH interior probes per round over a 33-day
 *  window, so the day-precision projection below is arithmetic on measured rounds
 *  rather than a second implementation of the search. */
const BRANCH = 4;
const WINDOW_S = 33 * DAY;
const roundsFor = (accuracy: number) =>
	Math.max(1, Math.ceil(Math.log(WINDOW_S / accuracy) / Math.log(BRANCH + 1)));
/** A bundled plugin procedure that only computes: the engine's compute path with no
 *  network in it at all. */
const COMPUTE_ENTRY = "/repo/plugins/sunPosition/procedure.js";
const COMPUTE_FIELDS = ["sunAzimuth", "sunAltitude"];
const RESULT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "../perf/results");

/** One in every N rows is a hostile shape, so paging never sees a uniform batch. */
function scaleRows(
	n: number,
): { kind: string; lat: number; lng: number; panoId?: string; extra?: Record<string, unknown> }[] {
	const rows = [];
	let h = SEED >>> 0;
	const next = () => {
		h = (h * 1664525 + 1013904223) >>> 0;
		return h / 0x100000000;
	};
	for (let i = 0; i < n; i++) {
		const lat = Number((-55 + next() * 110).toFixed(5));
		const lng = Number((-170 + next() * 340).toFixed(5));
		if (i % 50 === 7) {
			rows.push({ kind: "dead", lat, lng, panoId: `DEAD_${i}` });
		} else if (i % 50 === 13) {
			rows.push({ kind: "undated", lat, lng, extra: { imageDate: "" } });
		} else if (i % 50 === 21) {
			rows.push({ kind: "no-coverage", lat: 0.0001 + i * 1e-9, lng: 0.0001 });
		} else {
			rows.push({ kind: "plain", lat, lng, extra: { imageDate: MOCK_GENERIC_IMAGE_DATE } });
		}
	}
	return rows;
}

function windowFor(imageDate: string): [number, number] | null {
	const m = /^(\d{4})-(\d{2})$/.exec(imageDate);
	if (!m) return null;
	const first = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) / 1000;
	return [first - DAY, first + 32 * DAY];
}

describe(`procedure scale: ${ROWS} rows`, () => {
	let mapId = "";
	let rows: Record<string, unknown>[] = [];
	let enrichMs = 0;
	let pinMs = 0;
	let validateMs = 0;
	let computeMs: number | null = null;
	let peakRssMb: number | null = null;
	let net: Awaited<ReturnType<typeof collectNet>> | null = null;
	let enrichOutcomes: unknown = null;
	let pinOutcomes: unknown = null;
	let validateStates: unknown = null;
	const samples: Record<Phase, BenchmarkRawSample[]> = {
		enrich: [],
		pin: [],
		validate: [],
		compute: [],
	};
	let rowCountValid = false;
	let timestampsValid = false;

	before(async () => {
		if (
			!Number.isSafeInteger(SAMPLES) ||
			SAMPLES < 1 ||
			!Number.isSafeInteger(WARMUPS) ||
			WARMUPS < 0
		) {
			throw new Error("Benchmark samples must be positive and warmups non-negative integers");
		}
		await waitForReady();
		await browser.setTimeout({ script: 3_600_000 });
		const all = scaleRows(ROWS);
		for (let iteration = 0; iteration < SAMPLES + WARMUPS; iteration++) {
			mapId = await createMap(`Scale ${ROWS} ${Date.now()}`);
			try {
				await setEnrich(FIELDS);
				for (let i = 0; i < all.length; i += CHUNK) {
					await addFixture(all.slice(i, i + CHUNK));
				}
				await resetTimelines();
				const measure = async <T extends { durationMs: number }>(
					phase: Phase,
					run: () => Promise<T>,
				) => {
					const measured = await measureProcessTree(run);
					if (iteration >= WARMUPS) {
						samples[phase].push({
							iteration: iteration - WARMUPS + 1,
							durationMs: measured.result.durationMs,
							operationMs: measured.result.durationMs,
							metrics: { rowsPerSecond: (ROWS * 1000) / measured.result.durationMs },
							telemetry: measured.telemetry,
						});
					}
					const rss = measured.telemetry.peakRssBytes;
					if (typeof rss === "number")
						peakRssMb = Math.max(peakRssMb ?? 0, Math.round(rss / 1024 / 1024));
					return measured.result;
				};
				const enrich = await measure("enrich", () => runEnrich(false));
				enrichMs = enrich.durationMs;
				enrichOutcomes = enrich.outcomes;
				const pin = await measure("pin", () => runPin(true));
				pinMs = pin.durationMs;
				pinOutcomes = pin.outcomes;
				const validate = await measure("validate", runValidate);
				validateMs = validate.durationMs;
				validateStates = validate.states;
				if (!METADATA_ONLY) {
					computeMs = (await measure("compute", () => runCompute(COMPUTE_ENTRY, COMPUTE_FIELDS)))
						.durationMs;
				}
				net = await collectNet();
				if (iteration === SAMPLES + WARMUPS - 1) rows = await dumpRows();
			} finally {
				await dropMap(mapId);
				mapId = "";
			}
		}
	});

	after(async () => {
		if (mapId) await dropMap(mapId);
	});

	it("keeps every row", () => {
		expect(rows.length).toBe(ROWS);
		rowCountValid = true;
	});

	it("never writes a timestamp outside the month it searched", () => {
		if (METADATA_ONLY) return;
		const bad: string[] = [];
		for (const r of rows) {
			const extra = r.extra as Record<string, unknown>;
			const ts = extra.datetime;
			if (typeof ts !== "number") continue;
			const w = typeof extra.imageDate === "string" ? windowFor(extra.imageDate) : null;
			if (!w || ts < w[0] || ts > w[1]) {
				bad.push(`${r.lat},${r.lng}: ${ts} vs ${String(extra.imageDate)}`);
			}
			if (bad.length > 5) break;
		}
		expect(bad).toEqual([]);
		timestampsValid = true;
	});

	it("writes a digest of the whole map", async () => {
		const lines = rows
			.map((r) => {
				const extra = r.extra as Record<string, unknown>;
				const sorted = Object.keys(extra)
					.sort()
					.map((k) => `${k}=${JSON.stringify(extra[k])}`)
					.join(",");
				return `${r.lat},${r.lng}|${String(r.panoId ?? "")}|${String(r.flags ?? 0)}|${sorted}`;
			})
			.sort();
		const digest = crypto.createHash("sha256").update(lines.join("\n")).digest("hex");

		const rowDates: Record<string, number> = {};
		for (const r of rows) {
			const ts = (r.extra as Record<string, unknown>).datetime;
			if (typeof ts === "number") rowDates[`${r.lat},${r.lng}`] = ts;
		}
		const withDate = rows.filter(
			(r) => typeof (r.extra as Record<string, unknown>).datetime === "number",
		).length;
		const withCountry = rows.filter(
			(r) => typeof (r.extra as Record<string, unknown>).countryCode === "string",
		).length;
		const enrichedRows = Object.keys(rowDates).length;
		const requests = net?.stats.requests ?? 0;
		const rowsPerSecond = ROWS / (enrichMs / 1000);
		const report = {
			label: LABEL,
			rows: ROWS,
			fields: FIELDS,
			enrichMs,
			pinMs,
			validateMs,
			computeMs,
			peakRssMb,
			rowsPerSecond: Number((ROWS / (enrichMs / 1000)).toFixed(2)),
			pinRowsPerSecond: Number((ROWS / (pinMs / 1000)).toFixed(2)),
			validateRowsPerSecond: Number((ROWS / (validateMs / 1000)).toFixed(2)),
			computeRowsPerSecond:
				computeMs == null ? null : Number((ROWS / (computeMs / 1000)).toFixed(2)),
			enrichOutcomes,
			pinOutcomes,
			validateStates,
			withDate,
			withCountry,
			surface: net?.surface ?? "none",
			net: net?.stats ?? null,
			requestsPerRow: enrichedRows > 0 ? Number((requests / enrichedRows).toFixed(2)) : null,
			projection: METADATA_ONLY
				? null
				: {
						roundsSecond: roundsFor(1),
						roundsDay: roundsFor(DAY),
						projectedRowsPerSecondAtDay: Number(
							(rowsPerSecond * (roundsFor(1) / roundsFor(DAY))).toFixed(2),
						),
					},
			digest,
			rowDates,
		};
		fs.mkdirSync(RESULT_DIR, { recursive: true });
		fs.writeFileSync(
			path.join(RESULT_DIR, `scale-${ROWS}${LABEL ? `-${LABEL}` : ""}-${Date.now()}.json`),
			JSON.stringify(report, null, "\t") + "\n",
		);
		if (BENCH && rowCountValid && (METADATA_ONLY || timestampsValid)) {
			const benchReport: BenchmarkReport = {
				schemaVersion: 2,
				generatedAt: new Date().toISOString(),
				complete: true,
				failures: [],
				environment: { ...collectEnvironment([ROWS], SAMPLES, WARMUPS), seed: SEED },
				cases: PHASES.filter((phase) => !METADATA_ONLY || phase !== "compute").map((phase) =>
					benchmarkCase(
						"procedure",
						phase,
						METADATA_ONLY ? `${ROWS}-metadata` : ROWS,
						samples[phase],
					),
				),
			};
			await writeBenchmarkReport(benchReport);
		}
		console.log("[scale] " + JSON.stringify({ ...report, rowDates: undefined }));
	});
});
