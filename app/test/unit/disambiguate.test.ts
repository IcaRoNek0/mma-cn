import { describe, it, expect } from "vitest";
import { createFieldDef } from "@/types";
import type { CountBy, FieldDef } from "@/bindings.gen";
import {
	computeDivergence,
	exclusiveGroups,
	TAGS_COLUMN,
	type DisambiguateResult,
	type FieldDivergence,
	type GroupCounts,
} from "@/plugins/disambiguate/engine";
import { circularSummary, kruskalEps2, quartiles } from "@/plugins/disambiguate/stats";

interface Row {
	heading: number;
	extra: Record<string, unknown>;
	tags: number[];
}

function loc(heading: number, extra: Record<string, unknown>, tags: number[]): Row {
	return { heading, extra, tags };
}

function numberDef(): FieldDef {
	return createFieldDef("number");
}

function defs(pairs: [string, FieldDef][]): Record<string, FieldDef> {
	return Object.fromEntries(pairs);
}

function find(r: DisambiguateResult, key: string): FieldDivergence {
	const f = r.fields.find((x) => x.key === key);
	if (!f) throw new Error(`field ${key} not found`);
	return f;
}

/** Value counts as the store's count-by-value reports them: numbers and booleans as
 *  their string form, each member of a list counted once per row. */
function countValues(values: unknown[]): CountBy {
	const counts = new Map<string, number>();
	let covered = 0;
	for (const v of values) {
		const keys = new Set(
			(Array.isArray(v) ? v : [v]).filter((x) => x != null && x !== "").map(String),
		);
		if (keys.size > 0) covered++;
		for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	return { counts: [...counts], covered };
}

/** Rows as the per-group counts the store would report for every extra key seen in any group. */
function groups(rows: Row[][]): GroupCounts[] {
	const keys = new Set<string>();
	for (const g of rows) for (const r of g) for (const k of Object.keys(r.extra)) keys.add(k);
	return rows.map((g) => ({
		size: g.length,
		counts: {
			heading: countValues(g.map((r) => r.heading)),
			pitch: countValues(g.map(() => 0)),
			zoom: countValues(g.map(() => 0)),
			[TAGS_COLUMN]: countValues(g.map((r) => r.tags)),
			...Object.fromEntries([...keys].map((k) => [k, countValues(g.map((r) => r.extra[k]))])),
		},
	}));
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// --- Numeric (linear) -------------------------------------------------------

describe("numeric (linear)", () => {
	it("separated numeric scores high", () => {
		const a = range(12).map((i) => loc(0, { alt: i }, []));
		const b = range(12).map((i) => loc(0, { alt: 1000 + i }, []));
		const r = computeDivergence(groups([a, b]), defs([["alt", numberDef()]]), {});
		const f = find(r, "alt");
		expect(f.comparison.type).toBe("linear");
		// Two-group epsilon-squared caps at H/(n-1); perfect 12v12 separation = ~0.75.
		expect(f.valueScore!).toBeGreaterThan(0.7);
		expect(f.lowConfidence).toBe(false);
	});

	it("overlapping numeric scores low", () => {
		const a = range(12).map((i) => loc(0, { alt: i % 10 }, []));
		const b = range(12).map((i) => loc(0, { alt: i % 10 }, []));
		const r = computeDivergence(groups([a, b]), defs([["alt", numberDef()]]), {});
		expect(find(r, "alt").valueScore!).toBeLessThan(0.15);
	});

	it("ranking puts most separating field first", () => {
		const a = range(12).map((i) => loc(0, { alt: i, noise: i % 3 }, []));
		const b = range(12).map((i) => loc(0, { alt: 1000 + i, noise: i % 3 }, []));
		const r = computeDivergence(
			groups([a, b]),
			defs([
				["alt", numberDef()],
				["noise", numberDef()],
			]),
			{},
		);
		expect(r.fields[0].key).toBe("alt");
	});
});

// --- Categorical ------------------------------------------------------------

describe("categorical", () => {
	it("separated categorical scores high", () => {
		const a = range(12).map(() => loc(0, { cc: "US" }, []));
		const b = range(12).map(() => loc(0, { cc: "FR" }, []));
		const cc: FieldDef = createFieldDef("string");
		const r = computeDivergence(groups([a, b]), defs([["cc", cc]]), {});
		const f = find(r, "cc");
		expect(f.comparison.type).toBe("categorical");
		expect(f.valueScore!).toBeGreaterThan(0.8);
	});

	it("shared dominant value scores low", () => {
		const mk = () => loc(0, { cam: "gen2" }, []);
		const a = range(12).map(mk);
		const b = range(12).map(mk);
		const cam: FieldDef = createFieldDef("enum");
		const r = computeDivergence(groups([a, b]), defs([["cam", cam]]), {});
		expect(find(r, "cam").valueScore!).toBeLessThan(0.15);
	});
});

// --- Circular ---------------------------------------------------------------

describe("circular", () => {
	it("treats overlapping seam-straddling groups as close", () => {
		// Both groups span the 0/360 seam (~ -5deg..+5deg) and overlap heavily, so they
		// are circularly the same population. A naive linear metric is fooled by the seam
		// (values split into a ~0 cluster and a ~356 cluster) and sees structure.
		const av = [356, 358, 0, 2, 4, 357, 359, 1, 3, 5, 358, 0];
		const bv = [357, 359, 1, 3, 5, 356, 358, 0, 2, 4, 359, 1];
		const a = av.map((h) => loc(h, {}, []));
		const b = bv.map((h) => loc(h, {}, []));
		const r = computeDivergence(groups([a, b]), {}, {});
		const f = find(r, "heading");
		expect(f.comparison.type === "circular" && f.comparison.period === 360).toBe(true);
		expect(f.valueScore!).toBeLessThan(0.3);
	});

	it("circular summary recovers the true mean across the seam", () => {
		// A tight cluster straddling 0/360: circular mean ~0deg, high concentration.
		// A naive arithmetic mean would land near 144deg (fooled by the seam).
		const { mean, concentration } = circularSummary(
			[358, 359, 0, 1, 2].map((v) => [v, 1]),
			360,
		);
		expect(Math.min(mean, 360 - mean)).toBeLessThan(1); // within 1deg of 0/360
		expect(concentration).toBeGreaterThan(0.99);
	});

	it("opposite directions score high", () => {
		const a = range(12).map((i) => loc(i % 5, {}, []));
		const b = range(12).map((i) => loc(178 + (i % 5), {}, []));
		const r = computeDivergence(groups([a, b]), {}, {});
		expect(find(r, "heading").valueScore!).toBeGreaterThan(0.8);
	});
});

// --- Coverage & missing data ------------------------------------------------

describe("coverage and missing data", () => {
	it("coverage asymmetry is flagged", () => {
		const a = range(12).map((i) => loc(0, { alt: i }, []));
		const b = range(12).map(() => loc(0, {}, []));
		const r = computeDivergence(groups([a, b]), defs([["alt", numberDef()]]), {});
		const f = find(r, "alt");
		expect(f.coverageScore).toBeGreaterThan(0.8);
		expect(f.valueScore).toBeNull();
	});

	it("missing values not treated as zero", () => {
		const a = range(12).map(() => loc(0, { alt: 5 }, []));
		const b = [
			...range(3).map(() => loc(0, { alt: 5 }, [])),
			...range(9).map(() => loc(0, {}, [])),
		];
		const r = computeDivergence(groups([a, b]), defs([["alt", numberDef()]]), {});
		const f = find(r, "alt");
		expect(f.valueScore!).toBeLessThan(0.15);
		expect(f.lowConfidence).toBe(true);
		expect(f.coverageScore).toBeGreaterThan(0.5);
	});
});

// --- Tags -------------------------------------------------------------------

describe("tags", () => {
	it("discriminating tag scores high", () => {
		const a = range(12).map(() => loc(0, {}, [7]));
		const b = range(12).map(() => loc(0, {}, []));
		const r = computeDivergence(groups([a, b]), {}, { 7: "Verified" });
		const f = find(r, "tag:7");
		expect(f.label).toBe("Verified");
		expect(f.valueScore!).toBeGreaterThan(0.8);
		expect(f.coverageScore).toBeLessThan(1e-9);
	});
});

// --- Excluded fields & labeling ---------------------------------------------

describe("excluded fields and labeling", () => {
	it("spatial and timestamp fields never analyzed", () => {
		const a = range(4).map(() => loc(0, {}, []));
		const b = range(4).map(() => loc(0, {}, []));
		const r = computeDivergence(groups([a, b]), {}, {});
		for (const bad of ["lat", "lng", "createdAt", "modifiedAt"]) {
			expect(r.fields.some((f) => f.key === bad)).toBe(false);
		}
	});

	it("group sizes reflect labels", () => {
		const a = range(5).map(() => loc(0, {}, []));
		const b = range(3).map(() => loc(0, {}, []));
		const r = computeDivergence(groups([a, b]), {}, {});
		expect(r.groupSizes).toEqual([5, 3]);
	});

	it("each exclusive group drops every location another group holds", () => {
		const [a, b, c] = [7, 8, 9].map((tag) => ({
			type: "Filter" as const,
			field: "tags",
			test: { op: "contains" as const, value: tag },
		}));
		const [onlyA] = exclusiveGroups([a, b, c]);
		expect(onlyA.type).toBe("Intersection");
		if (onlyA.type !== "Intersection") return;
		const [kept, dropped] = onlyA.selections.map((s) => s.selector);
		expect(kept).toEqual(a);
		expect(dropped.type).toBe("Invert");
		if (dropped.type !== "Invert") return;
		const others = dropped.selections[0].selector;
		expect(others.type === "Union" && others.selections.map((s) => s.selector)).toEqual([b, c]);
	});
});

// --- Counted input ------------------------------------------------------------

describe("counted input", () => {
	const expand = (tally: [number, number][]) => tally.flatMap(([v, c]) => Array<number>(c).fill(v));

	it("ranks and quartiles weigh each distinct value by its count", () => {
		const a: [number, number][] = [
			[1, 3],
			[2, 1],
			[5, 4],
		];
		const b: [number, number][] = [
			[2, 2],
			[5, 1],
			[9, 6],
		];
		const one = (vals: number[]) => vals.map((v): [number, number] => [v, 1]);
		expect(kruskalEps2([a, b])).toBeCloseTo(kruskalEps2([one(expand(a)), one(expand(b))])!, 12);
		expect(quartiles(a)).toEqual(quartiles(one(expand(a))));
		expect(quartiles(a)).toEqual([1, 3.5, 5]);
	});

	it("reads a boolean field as categorical", () => {
		const a = range(12).map(() => loc(0, { pinned: true }, []));
		const b = range(12).map(() => loc(0, { pinned: false }, []));
		const r = computeDivergence(groups([a, b]), defs([["pinned", createFieldDef("boolean")]]), {});
		const f = find(r, "pinned");
		expect(f.comparison.type).toBe("categorical");
		expect(f.valueScore!).toBeGreaterThan(0.8);
	});

	it("reads month values as months", () => {
		const a = range(12).map(() => loc(0, { m: "2019-08" }, []));
		const b = range(12).map(() => loc(0, { m: "2021-01" }, []));
		const r = computeDivergence(groups([a, b]), defs([["m", createFieldDef("month")]]), {});
		const f = find(r, "m");
		expect(f.format).toBe("month");
		expect(f.groups.map((g) => g.median)).toEqual([2019 * 12 + 7, 2021 * 12]);
	});

	it("does not list the tags field as a field of its own", () => {
		const a = range(12).map(() => loc(0, {}, [7]));
		const r = computeDivergence(groups([a, a]), {}, {});
		expect(r.fields.some((f) => f.key === TAGS_COLUMN)).toBe(false);
	});
});

// --- Undeclared field inference ---------------------------------------------

describe("undeclared field inference", () => {
	it("undeclared numeric field treated as linear", () => {
		const a = range(12).map((i) => loc(0, { mystery: i }, []));
		const b = range(12).map((i) => loc(0, { mystery: 1000 + i }, []));
		const r = computeDivergence(groups([a, b]), {}, {});
		const f = find(r, "mystery");
		expect(f.comparison.type).toBe("linear");
		expect(f.valueScore!).toBeGreaterThan(0.7);
	});
});
