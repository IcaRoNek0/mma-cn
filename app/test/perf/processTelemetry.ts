// Process-tree CPU/RSS/PSS telemetry for the benchmark harness. Walks /proc for the
// app root and every descendant, sampling while the measured action runs. Linux only;
// elsewhere it degrades to wall time so the harness still produces durations.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

const PROC_ROOT = "/proc";
const CGROUP_ROOT = "/sys/fs/cgroup";
const RSS_SAMPLE_INTERVAL_MS = 100;
const PSS_SAMPLE_INTERVAL_MS = 500;
const DEFAULT_APP_EXE = "/usr/local/bin/map-making-app";

const execFileAsync = promisify(execFile);
let clockTicksPromise: Promise<number> | undefined;

interface ProcessIdentity {
	pid: number;
	starttime: bigint;
}

interface ProcessStat extends ProcessIdentity {
	ppid: number;
	cpuTicks: bigint;
}

interface ProcessSample {
	stat: ProcessStat;
	rssBytes: number | null;
	pssBytes: number | null;
}

interface CgroupSample {
	cpuUsec: bigint | null;
	memoryBytes: number | null;
}

interface Snapshot {
	processes: ProcessSample[];
	cgroup: CgroupSample;
}

export interface ProcessTreeTelemetry {
	appCpuMs: number | null;
	containerCpuMs: number | null;
	baselineRssBytes: number | null;
	peakRssBytes: number | null;
	finalRssBytes: number | null;
	baselinePssBytes: number | null;
	peakPssBytes: number | null;
	finalPssBytes: number | null;
	baselineContainerMemoryBytes: number | null;
	peakContainerMemoryBytes: number | null;
	finalContainerMemoryBytes: number | null;
	maxProcessCount: number | null;
	elapsedWallMs: number;
}

export interface MeasuredProcessTree<T> {
	result: T;
	telemetry: ProcessTreeTelemetry;
}

export const telemetrySupported = process.platform === "linux";

function emptyTelemetry(elapsedWallMs: number): ProcessTreeTelemetry {
	return {
		appCpuMs: null,
		containerCpuMs: null,
		baselineRssBytes: null,
		peakRssBytes: null,
		finalRssBytes: null,
		baselinePssBytes: null,
		peakPssBytes: null,
		finalPssBytes: null,
		baselineContainerMemoryBytes: null,
		peakContainerMemoryBytes: null,
		finalContainerMemoryBytes: null,
		maxProcessCount: null,
		elapsedWallMs,
	};
}

async function readClockTicks(): Promise<number> {
	const { stdout } = await execFileAsync("getconf", ["CLK_TCK"]);
	const ticks = Number.parseInt(stdout.trim(), 10);
	if (!Number.isFinite(ticks) || ticks <= 0) {
		throw new Error(`Unable to determine CLK_TCK from getconf: ${stdout.trim()}`);
	}
	return ticks;
}

function getClockTicks(): Promise<number> {
	clockTicksPromise ??= readClockTicks();
	return clockTicksPromise;
}

function parseProcessStat(contents: string): ProcessStat | null {
	const closeParen = contents.lastIndexOf(")");
	if (closeParen < 0) return null;

	const pid = Number.parseInt(contents.slice(0, contents.indexOf(" ")), 10);
	const fields = contents
		.slice(closeParen + 1)
		.trim()
		.split(/\s+/);
	const ppid = Number.parseInt(fields[1] ?? "", 10);
	const userTicks = fields[11];
	const systemTicks = fields[12];
	const starttime = fields[19];
	if (
		!Number.isInteger(pid) ||
		!Number.isInteger(ppid) ||
		!userTicks ||
		!systemTicks ||
		!starttime
	) {
		return null;
	}

	try {
		return {
			pid,
			ppid,
			cpuTicks: BigInt(userTicks) + BigInt(systemTicks),
			starttime: BigInt(starttime),
		};
	} catch {
		return null;
	}
}

async function readProcessStat(pid: number): Promise<ProcessStat | null> {
	try {
		return parseProcessStat(await fs.readFile(`${PROC_ROOT}/${pid}/stat`, "utf8"));
	} catch {
		return null;
	}
}

async function listProcessStats(): Promise<ProcessStat[]> {
	const entries = await fs.readdir(PROC_ROOT, { withFileTypes: true });
	const pids = entries
		.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
		.map((entry) => Number(entry.name));
	const stats = await Promise.all(pids.map(readProcessStat));
	return stats.filter((stat): stat is ProcessStat => stat !== null);
}

function identityKey(identity: ProcessIdentity): string {
	return `${identity.pid}:${identity.starttime}`;
}

async function discoverAppRoot(): Promise<ProcessIdentity> {
	let target: string;
	try {
		target = await fs.realpath(process.env.MMA_BENCH_APP_EXE ?? DEFAULT_APP_EXE);
	} catch (error) {
		throw new Error(
			`Benchmark app executable could not be resolved: ${process.env.MMA_BENCH_APP_EXE ?? DEFAULT_APP_EXE}`,
			{ cause: error },
		);
	}

	const stats = await listProcessStats();
	const matches = (
		await Promise.all(
			stats.map(async (stat) => {
				try {
					return (await fs.realpath(`${PROC_ROOT}/${stat.pid}/exe`)) === target ? stat : null;
				} catch {
					return null;
				}
			}),
		)
	).filter((stat): stat is ProcessStat => stat !== null);

	if (matches.length === 0) {
		throw new Error(`Benchmark app root not found for executable ${target}`);
	}

	const matchingPids = new Set(matches.map((stat) => stat.pid));
	const roots = matches.filter((stat) => !matchingPids.has(stat.ppid));
	if (roots.length !== 1) {
		throw new Error(
			`Expected one benchmark app root for ${target}, found ${roots.length || matches.length}`,
		);
	}
	return { pid: roots[0].pid, starttime: roots[0].starttime };
}

function collectTree(stats: ProcessStat[], root: ProcessIdentity): ProcessStat[] {
	const rootStat = stats.find((stat) => stat.pid === root.pid && stat.starttime === root.starttime);
	if (!rootStat) return [];

	const children = new Map<number, ProcessStat[]>();
	for (const stat of stats) {
		const siblings = children.get(stat.ppid);
		if (siblings) siblings.push(stat);
		else children.set(stat.ppid, [stat]);
	}

	const tree: ProcessStat[] = [];
	const queue = [rootStat];
	const visited = new Set<string>();
	while (queue.length > 0) {
		const stat = queue.shift();
		if (!stat) break;
		const key = identityKey(stat);
		if (visited.has(key)) continue;
		visited.add(key);
		tree.push(stat);
		queue.push(...(children.get(stat.pid) ?? []));
	}
	return tree;
}

async function readKbField(file: string, field: string): Promise<number | null> {
	try {
		const contents = await fs.readFile(file, "utf8");
		const match = contents.match(new RegExp(`^${field}:\\s+(\\d+)\\s+kB$`, "m"));
		return match ? Number(match[1]) * 1024 : null;
	} catch {
		return null;
	}
}

async function readCgroupSample(): Promise<CgroupSample> {
	const [cpuStat, memory] = await Promise.all([
		fs.readFile(`${CGROUP_ROOT}/cpu.stat`, "utf8").catch(() => null),
		fs.readFile(`${CGROUP_ROOT}/memory.current`, "utf8").catch(() => null),
	]);
	const cpuMatch = cpuStat?.match(/^usage_usec\s+(\d+)$/m);
	const memoryValue = memory?.trim();
	return {
		cpuUsec: cpuMatch ? BigInt(cpuMatch[1]) : null,
		memoryBytes: memoryValue && /^\d+$/.test(memoryValue) ? Number.parseInt(memoryValue, 10) : null,
	};
}

async function takeSnapshot(root: ProcessIdentity, includePss: boolean): Promise<Snapshot> {
	const stats = collectTree(await listProcessStats(), root);
	const [processes, cgroup] = await Promise.all([
		Promise.all(
			stats.map(async (stat): Promise<ProcessSample> => {
				const [rssBytes, pssBytes] = await Promise.all([
					readKbField(`${PROC_ROOT}/${stat.pid}/status`, "VmRSS"),
					includePss
						? readKbField(`${PROC_ROOT}/${stat.pid}/smaps_rollup`, "Pss")
						: Promise.resolve(null),
				]);
				return { stat, rssBytes, pssBytes };
			}),
		),
		readCgroupSample(),
	]);
	return { processes, cgroup };
}

function sumMetric(processes: ProcessSample[], metric: "rssBytes" | "pssBytes"): number | null {
	if (processes.length === 0) return null;
	const values = processes.map((processSample) => processSample[metric]);
	if (values.some((value) => value === null)) return null;
	return (values as number[]).reduce((sum, value) => sum + value, 0);
}

function nullableMax(current: number | null, next: number | null): number | null {
	if (current === null) return next;
	if (next === null) return current;
	return Math.max(current, next);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Run `action`, sampling the app's process tree throughout. */
export async function measureProcessTree<T>(
	action: () => Promise<T> | T,
): Promise<MeasuredProcessTree<T>> {
	if (!telemetrySupported) {
		const startedAt = performance.now();
		const result = await action();
		return { result, telemetry: emptyTelemetry(performance.now() - startedAt) };
	}

	const [root, clockTicks] = await Promise.all([discoverAppRoot(), getClockTicks()]);
	const baselineMemory = await takeSnapshot(root, true);
	if (baselineMemory.processes.length === 0) {
		throw new Error("Benchmark app root disappeared before the baseline sample");
	}
	const baselineCpu = await takeSnapshot(root, false);

	const baselineRssBytes = sumMetric(baselineMemory.processes, "rssBytes");
	const baselinePssBytes = sumMetric(baselineMemory.processes, "pssBytes");
	const cpuTicks = new Map<string, { baseline: bigint; latest: bigint }>();
	for (const processSample of baselineCpu.processes) {
		cpuTicks.set(identityKey(processSample.stat), {
			baseline: processSample.stat.cpuTicks,
			latest: processSample.stat.cpuTicks,
		});
	}

	let peakRssBytes = baselineRssBytes;
	let peakPssBytes = baselinePssBytes;
	let peakContainerMemoryBytes = baselineMemory.cgroup.memoryBytes;
	let maxProcessCount = baselineMemory.processes.length;
	let sampling = true;
	let stopPolling!: () => void;
	const stopped = new Promise<void>((resolve) => {
		stopPolling = resolve;
	});
	const startedAt = performance.now();

	const recordSnapshot = (snapshot: Snapshot, includesPss: boolean, includesCpu = true): void => {
		maxProcessCount = Math.max(maxProcessCount, snapshot.processes.length);
		peakRssBytes = nullableMax(peakRssBytes, sumMetric(snapshot.processes, "rssBytes"));
		if (includesPss) {
			peakPssBytes = nullableMax(peakPssBytes, sumMetric(snapshot.processes, "pssBytes"));
		}
		peakContainerMemoryBytes = nullableMax(peakContainerMemoryBytes, snapshot.cgroup.memoryBytes);
		if (includesCpu) {
			for (const processSample of snapshot.processes) {
				const key = identityKey(processSample.stat);
				const tracked = cpuTicks.get(key);
				if (tracked) tracked.latest = processSample.stat.cpuTicks;
				else cpuTicks.set(key, { baseline: 0n, latest: processSample.stat.cpuTicks });
			}
		}
	};

	const poller = (async () => {
		let nextPssAt = PSS_SAMPLE_INTERVAL_MS;
		while (sampling) {
			await Promise.race([delay(RSS_SAMPLE_INTERVAL_MS), stopped]);
			if (!sampling) break;
			const elapsed = performance.now() - startedAt;
			const includePss = elapsed >= nextPssAt;
			if (includePss) nextPssAt = elapsed + PSS_SAMPLE_INTERVAL_MS;
			const snapshot = await takeSnapshot(root, includePss);
			if (!sampling) break;
			recordSnapshot(snapshot, includePss);
		}
	})();

	let result: T;
	let actionFailed = false;
	let actionError: unknown;
	try {
		result = await action();
	} catch (error) {
		actionFailed = true;
		actionError = error;
		result = undefined as T;
	}
	const elapsedWallMs = performance.now() - startedAt;
	sampling = false;
	stopPolling();
	const finalCpu = await takeSnapshot(root, false);
	await poller;
	recordSnapshot(finalCpu, false);
	const final = await takeSnapshot(root, true);
	recordSnapshot(final, true, false);

	if (actionFailed) throw actionError;

	let totalCpuTicks = 0n;
	for (const tracked of cpuTicks.values()) {
		if (tracked.latest > tracked.baseline) totalCpuTicks += tracked.latest - tracked.baseline;
	}
	const containerCpuMs =
		baselineCpu.cgroup.cpuUsec !== null && finalCpu.cgroup.cpuUsec !== null
			? Number(finalCpu.cgroup.cpuUsec - baselineCpu.cgroup.cpuUsec) / 1000
			: null;

	return {
		result,
		telemetry: {
			appCpuMs: (Number(totalCpuTicks) * 1000) / clockTicks,
			containerCpuMs,
			baselineRssBytes,
			peakRssBytes,
			finalRssBytes: sumMetric(final.processes, "rssBytes"),
			baselinePssBytes,
			peakPssBytes,
			finalPssBytes: sumMetric(final.processes, "pssBytes"),
			baselineContainerMemoryBytes: baselineMemory.cgroup.memoryBytes,
			peakContainerMemoryBytes,
			finalContainerMemoryBytes: final.cgroup.memoryBytes,
			maxProcessCount,
			elapsedWallMs,
		},
	};
}
