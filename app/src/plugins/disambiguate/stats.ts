// Statistical effect-size measures for selection disambiguation.

import { clamp } from "@/types/util";

const TWO_PI = Math.PI * 2;

/** A numeric sample as its distinct values, each with how often it occurs. */
export type Tally = [value: number, count: number][];

/** Epsilon-squared effect size from the tie-corrected Kruskal-Wallis H statistic.
 *  Rank-based, robust to skew/scale. `null` if fewer than two groups have data. [0,1]. */
export function kruskalEps2(perGroup: Tally[]): number | null {
	const sizes = perGroup.map(total);
	if (sizes.filter((n) => n > 0).length < 2) return null;
	const n = sum(sizes);
	if (n < 3) return 0;

	const countsByValue = new Map<number, number[]>();
	perGroup.forEach((tally, g) => {
		for (const [v, c] of tally) {
			let row = countsByValue.get(v);
			if (!row) countsByValue.set(v, (row = new Array(perGroup.length).fill(0)));
			row[g] += c;
		}
	});

	const rankSums = new Array(perGroup.length).fill(0);
	let tieCorrection = 0; // sum of (t^3 - t)
	let below = 0;
	for (const v of [...countsByValue.keys()].sort((a, b) => a - b)) {
		const row = countsByValue.get(v)!;
		const t = sum(row);
		const avgRank = below + (t + 1) / 2; // 1-based average rank for the tied block
		row.forEach((c, g) => (rankSums[g] += avgRank * c));
		tieCorrection += t * t * t - t;
		below += t;
	}

	let h = 0;
	sizes.forEach((size, g) => {
		if (size > 0) h += (rankSums[g] * rankSums[g]) / size;
	});
	h = (12 / (n * (n + 1))) * h - 3 * (n + 1);

	const denom = 1 - tieCorrection / (n * n * n - n);
	if (denom > 0) h /= denom;
	if (h <= 0) return 0;

	const eps2 = h / (n - 1); // epsilon-squared = H / (n - 1)
	return clamp01(eps2);
}

/** One-way circular ANOVA effect size: between-group share of concentration.
 *  Handles wrap-around (350deg and 10deg are close). `null` if <2 groups have data. [0,1]. */
export function circularEta2(perGroup: Tally[], period: number): number | null {
	const nonempty = perGroup.filter((g) => total(g) > 0).length;
	if (nonempty < 2 || period === 0) return null;

	let sumR = 0; // sum of per-group resultant lengths
	let totalC = 0;
	let totalS = 0;
	let n = 0;
	for (const tally of perGroup) {
		const size = total(tally);
		if (size === 0) continue;
		const [c, s] = sincosSums(tally, period);
		sumR += Math.sqrt(c * c + s * s);
		totalC += c;
		totalS += s;
		n += size;
	}
	const r = Math.sqrt(totalC * totalC + totalS * totalS);
	const denom = n - r;
	if (denom <= 1e-9) return 0;
	return clamp01((sumR - r) / denom);
}

function sincosSums(tally: Tally, period: number): [number, number] {
	let c = 0;
	let s = 0;
	for (const [v, count] of tally) {
		const theta = (v / period) * TWO_PI;
		c += count * Math.cos(theta);
		s += count * Math.sin(theta);
	}
	return [c, s];
}

/** Mean angle (original units, [0, period)) and concentration (resultant/n, [0,1]). */
export function circularSummary(
	tally: Tally,
	period: number,
): { mean: number; concentration: number } {
	const [c, s] = sincosSums(tally, period);
	const n = total(tally);
	let theta = Math.atan2(s, c);
	if (theta < 0) theta += TWO_PI;
	return { mean: (theta / TWO_PI) * period, concentration: Math.sqrt(c * c + s * s) / n };
}

/** Bias-corrected (Bergsma) Cramer's V over a groups-by-category table. [0,1]. */
export function cramersV(perGroup: Map<string, number>[]): number | null {
	const categories = new Set<string>();
	for (const m of perGroup) for (const k of m.keys()) categories.add(k);
	const cats = [...categories];
	const rowTotals = perGroup.map((m) => sum([...m.values()]));
	const n = sum(rowTotals);
	const nonemptyRows = rowTotals.filter((r) => r > 0).length;
	if (nonemptyRows < 2 || cats.length < 2 || n < 1) return 0;

	const colTotals = cats.map((c) => sum(perGroup.map((m) => m.get(c) ?? 0)));

	let chi2 = 0;
	perGroup.forEach((m, gi) => {
		if (rowTotals[gi] === 0) return;
		cats.forEach((cat, ci) => {
			const observed = m.get(cat) ?? 0;
			const expected = (rowTotals[gi] * colTotals[ci]) / n;
			if (expected > 0) {
				const d = observed - expected;
				chi2 += (d * d) / expected;
			}
		});
	});

	const phi2 = chi2 / n;
	const k = cats.length;
	const r = nonemptyRows;
	const phi2Corr = Math.max(0, phi2 - ((k - 1) * (r - 1)) / (n - 1));
	const kCorr = k - ((k - 1) * (k - 1)) / (n - 1);
	const rCorr = r - ((r - 1) * (r - 1)) / (n - 1);
	const denom = Math.min(kCorr - 1, rCorr - 1);
	if (denom <= 0) return 0;
	return clamp01(Math.sqrt(phi2Corr / denom));
}

/** Coverage divergence: Cramer's V on a present/absent x group table. */
export function coverageV(groupSizes: number[], present: number[]): number {
	const perGroup: Map<string, number>[] = groupSizes.map((n, i) => {
		const p = present[i];
		return new Map([
			["present", p],
			["absent", Math.max(0, n - p)],
		]);
	});
	return cramersV(perGroup) ?? 0;
}

/** [p25, median, p75] via linear-interpolated percentiles. */
export function quartiles(tally: Tally): [number, number, number] {
	const sorted = [...tally].sort((a, b) => a[0] - b[0]);
	const n = total(sorted);
	return [percentile(sorted, n, 0.25), percentile(sorted, n, 0.5), percentile(sorted, n, 0.75)];
}

function percentile(sorted: Tally, n: number, q: number): number {
	if (n === 0) return NaN;
	const pos = q * (n - 1);
	const lo = valueAt(sorted, Math.floor(pos));
	const hi = valueAt(sorted, Math.ceil(pos));
	return lo + (hi - lo) * (pos - Math.floor(pos));
}

/** The value at a 0-based position in the sample with every count expanded. */
function valueAt(sorted: Tally, index: number): number {
	let seen = 0;
	for (const [v, c] of sorted) {
		seen += c;
		if (index < seen) return v;
	}
	return NaN;
}

/** How many values a tally holds. */
export function total(tally: Tally): number {
	return tally.reduce((acc, [, c]) => acc + c, 0);
}

function clamp01(x: number): number {
	return clamp(x, 0, 1);
}

function sum(xs: number[]): number {
	return xs.reduce((a, b) => a + b, 0);
}
