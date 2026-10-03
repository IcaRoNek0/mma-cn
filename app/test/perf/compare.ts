// A/B compare two benchmark result files. Join on the stable case id, compare medians,
// and use MAD to decide whether a delta clears the run-to-run noise floor.
//
//   node test/perf/compare.ts <baseline> <candidate> [--threshold 0.05] [--metric duration]
//
// Each argument is a result JSON or a results directory (its latest.json is used).
// Reports only: the exit code is always 0.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { BenchmarkCase, BenchmarkReport, DurationSummary } from "./benchmarkHarness.ts";

/** Robust sigma estimate from the median absolute deviation. */
const MAD_TO_SIGMA = 1.4826;
/** How many sigma a delta must clear before it is more than noise. */
const SIGMA_MULTIPLE = 2;

type Verdict = "regression" | "improvement" | "noise" | "added" | "removed";

interface Row {
	id: string;
	base: number | null;
	candidate: number | null;
	deltaMs: number | null;
	deltaRatio: number | null;
	noiseMs: number | null;
	verdict: Verdict;
}

function parseArgs(argv: string[]) {
	const positional: string[] = [];
	let threshold = 0.05;
	let metric: "operation" | "duration" = "operation";
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--threshold") threshold = Number(argv[++i]);
		else if (arg === "--metric") metric = argv[++i] === "duration" ? "duration" : "operation";
		else if (arg.startsWith("--")) throw new Error(`Unknown flag ${arg}`);
		else positional.push(arg);
	}
	if (positional.length !== 2) {
		throw new Error("Usage: node test/perf/compare.ts <baseline> <candidate> [--threshold r]");
	}
	if (!Number.isFinite(threshold) || threshold < 0) throw new Error("--threshold must be >= 0");
	return { baseline: positional[0], candidate: positional[1], threshold, metric };
}

async function loadReport(target: string): Promise<BenchmarkReport> {
	const stat = await fs.stat(target);
	const file = stat.isDirectory() ? path.join(target, "latest.json") : target;
	const report = JSON.parse(await fs.readFile(file, "utf8")) as BenchmarkReport;
	if (!Array.isArray(report.cases)) throw new Error(`${file} is not a benchmark report`);
	return report;
}

function pick(
	benchmarkCase: BenchmarkCase,
	metric: "operation" | "duration",
): DurationSummary | null {
	if (metric === "operation") return benchmarkCase.operation ?? benchmarkCase.duration;
	return benchmarkCase.duration;
}

function compare(
	base: BenchmarkReport,
	candidate: BenchmarkReport,
	metric: "operation" | "duration",
	threshold: number,
): Row[] {
	const baseCases = new Map(base.cases.map((c) => [c.id, c]));
	const candidateCases = new Map(candidate.cases.map((c) => [c.id, c]));
	const ids = [...new Set([...baseCases.keys(), ...candidateCases.keys()])].sort();

	return ids.map((id): Row => {
		const b = baseCases.get(id);
		const c = candidateCases.get(id);
		const bs = b ? pick(b, metric) : null;
		const cs = c ? pick(c, metric) : null;
		if (!bs || !cs) {
			return {
				id,
				base: bs?.median ?? null,
				candidate: cs?.median ?? null,
				deltaMs: null,
				deltaRatio: null,
				noiseMs: null,
				verdict: bs ? "removed" : "added",
			};
		}
		const deltaMs = cs.median - bs.median;
		const deltaRatio = bs.median === 0 ? 0 : deltaMs / bs.median;
		const noiseMs = MAD_TO_SIGMA * Math.max(bs.mad, cs.mad) * SIGMA_MULTIPLE;
		const significant = Math.abs(deltaMs) > noiseMs && Math.abs(deltaRatio) > threshold;
		return {
			id,
			base: bs.median,
			candidate: cs.median,
			deltaMs,
			deltaRatio,
			noiseMs,
			verdict: !significant ? "noise" : deltaMs > 0 ? "regression" : "improvement",
		};
	});
}

function ms(value: number | null): string {
	return value === null ? "-" : value.toFixed(value < 100 ? 2 : 0);
}

function pct(value: number | null): string {
	return value === null ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function table(rows: Row[]): string {
	const header = ["case", "base", "cand", "delta", "delta%", "noise", "verdict"];
	const body = rows.map((row) => [
		row.id,
		ms(row.base),
		ms(row.candidate),
		ms(row.deltaMs),
		pct(row.deltaRatio),
		ms(row.noiseMs),
		row.verdict,
	]);
	const widths = header.map((_, column) =>
		Math.max(header[column].length, ...body.map((line) => line[column].length)),
	);
	const line = (cells: string[]) =>
		cells
			.map((cell, column) =>
				column === 0 ? cell.padEnd(widths[0]) : cell.padStart(widths[column]),
			)
			.join("  ");
	return [line(header), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

function environmentWarnings(base: BenchmarkReport, candidate: BenchmarkReport): string[] {
	const warnings: string[] = [];
	const check = <K extends keyof BenchmarkReport["environment"]>(key: K, label: string) => {
		const a = base.environment[key];
		const b = candidate.environment[key];
		if (JSON.stringify(a) !== JSON.stringify(b)) {
			warnings.push(`${label} differs: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
		}
	};
	check("cpuModel", "CPU model");
	check("effectiveCpuCount", "CPU limit");
	check("buildProfile", "build profile");
	check("iterations", "iterations");
	check("seed", "fixture seed");
	check("platform", "platform");
	check("network", "network model");
	return warnings;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const [base, candidate] = await Promise.all([
		loadReport(args.baseline),
		loadReport(args.candidate),
	]);
	if (base.schemaVersion !== candidate.schemaVersion) {
		throw new Error(
			`Schema mismatch: ${base.schemaVersion} vs ${candidate.schemaVersion} - reports are not comparable`,
		);
	}

	const rows = compare(base, candidate, args.metric, args.threshold);
	const out: string[] = [
		`base:      ${base.environment.commit ?? "unknown"} (${base.generatedAt})`,
		`candidate: ${candidate.environment.commit ?? "unknown"} (${candidate.generatedAt})`,
		`metric: ${args.metric} median | threshold: ${(args.threshold * 100).toFixed(1)}% and > ${SIGMA_MULTIPLE} sigma (MAD)`,
		"",
		table(rows),
		"",
	];
	const count = (verdict: Verdict) => rows.filter((row) => row.verdict === verdict).length;
	out.push(
		`regressions: ${count("regression")}  improvements: ${count("improvement")}  ` +
			`within noise: ${count("noise")}  added: ${count("added")}  removed: ${count("removed")}`,
	);
	const warnings = environmentWarnings(base, candidate);
	if (warnings.length > 0)
		out.push(
			"",
			"Environment differs - deltas may not be meaningful:",
			...warnings.map((w) => `  ${w}`),
		);
	process.stdout.write(`${out.join("\n")}\n`);
}

await main();
