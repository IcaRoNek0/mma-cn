/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFieldDef } from "@/types";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	addSelection,
	all,
	any,
	buildSelection,
	childSelections,
	colorForKey,
	composeSelections,
	displayTagName,
	has,
	intersectSelections,
	moveSelection,
	invertSelections,
	isolateGhost,
	lacks,
	locationsKey,
	not,
	panoIdSelector,
	removeSelection,
	removeSelectionAt,
	replaceSelection,
	rewriteSelectionFields,
	sampleIds,
	selectionDisplayName,
	setSelectionColor,
	SELECTIONS,
	tagSelector,
	toggleGhost,
	toggleGhostAll,
	withActive,
	toggleInvert,
	toggleManualSelection,
	unionSelections,
	unpannedSelector,
	untaggedSelector,
	withChildren,
} from "@/store/selections";
import type { RGB } from "@/lib/util/color";

/** Run a list edit over bare selections, listed as unghosted rows. */
const bare =
	(op: (rows: ListedSelection[]) => ListedSelection[]) =>
	(list: Selection[]): Selection[] =>
		op(list.map((selection) => ({ selection, ghosted: false }))).map((r) => r.selection);

import { ValidationState } from "@/bindings.consts";
import type { ListedSelection, PolygonGeometry, Selection } from "@/bindings.gen";
import { setSetting } from "@/store/settings";

// The store binds tag and field-def lookups internally; back them with settable fakes.
const h = vi.hoisted(() => ({
	tags: {} as Record<number, { id: number; name: string; color: string; visible: boolean }>,
	fieldDefs: {} as Record<string, unknown>,
}));
const setUserFieldDefs = (defs: Record<string, unknown>) => {
	h.fieldDefs = defs;
};
vi.mock("@/store/useMapStore", () => ({
	getTag: (id: number) => h.tags[id],
	getVisibleTags: () => Object.values(h.tags).filter((t) => t.visible !== false),
	getMapState: () => ({ fieldDefs: h.fieldDefs }),
}));

beforeEach(() => {
	h.tags = {};
});

// This suite runs in node (no DOM); back setSetting's localStorage with a stub.
if (typeof localStorage === "undefined") {
	let store: Record<string, string> = {};
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => {
			store[k] = v;
		},
		removeItem: (k: string) => {
			delete store[k];
		},
		clear: () => {
			store = {};
		},
	});
}

describe("colorForKey", () => {
	it("returns an RGB tuple", () => {
		const [r, g, b] = colorForKey("test");
		expect(r).toBeGreaterThanOrEqual(0);
		expect(r).toBeLessThanOrEqual(255);
		expect(g).toBeGreaterThanOrEqual(0);
		expect(b).toBeGreaterThanOrEqual(0);
	});

	it("is deterministic", () => {
		expect(colorForKey("foo")).toEqual(colorForKey("foo"));
	});

	it("produces different colors for different keys", () => {
		expect(colorForKey("alpha")).not.toEqual(colorForKey("beta"));
	});
});

describe("polygon color mode", () => {
	const polygon: PolygonGeometry = {
		coordinates: [
			[
				[0, 0],
				[1, 0],
				[1, 1],
				[0, 0],
			],
		],
		extraPolygons: null,
	};
	const build = () => buildSelection({ type: "Polygon", polygon });

	afterEach(() => setSetting("polygonColorMode", "random"));

	it("random gives each polygon its own key-hashed color", () => {
		setSetting("polygonColorMode", "random");
		const a = build();
		const other = buildSelection({
			type: "Polygon",
			polygon: {
				coordinates: [
					[
						[5, 5],
						[6, 5],
						[6, 6],
						[5, 5],
					],
				],
				extraPolygons: null,
			},
		});
		expect(a.color).toEqual(colorForKey(a.key));
		expect(other.color).toEqual(colorForKey(other.key));
		expect(a.key).not.toBe(other.key);
	});

	it("fixed gives every polygon the configured color", () => {
		setSetting("polygonColorMode", "fixed");
		setSetting("polygonColor", [1, 2, 3]);
		expect(build().color).toEqual([1, 2, 3]);
		expect(build().color).toEqual([1, 2, 3]);
	});

	it("fixed does not affect non-polygon selections", () => {
		setSetting("polygonColorMode", "fixed");
		setSetting("polygonColor", [1, 2, 3]);
		expect(buildSelection(untaggedSelector()).color).toEqual(
			colorForKey(buildSelection(untaggedSelector()).key),
		);
	});
});

describe("polygon selection keys", () => {
	const square = (o: number): PolygonGeometry => ({
		coordinates: [
			[
				[o, o],
				[o + 1, o],
				[o + 1, o + 1],
				[o, o],
			],
		],
		extraPolygons: null,
	});
	const build = (polygon: ReturnType<typeof square>) =>
		buildSelection({ type: "Polygon", polygon });

	it("identical geometry keys identically, so rebuilds keep identity", () => {
		// Key is identity for recolor/reorder/remove; a rebuild (replaceSelection,
		// tree transforms) must not mint a fresh key for an unchanged polygon.
		expect(build(square(0)).key).toBe(build(square(0)).key);
	});

	it("different geometry gets different keys", () => {
		expect(build(square(0)).key).not.toBe(build(square(5)).key);
		const withHole = {
			coordinates: [...square(0).coordinates, ...square(0.25).coordinates],
			extraPolygons: null,
		};
		expect(build(withHole).key).not.toBe(build(square(0)).key);
		const multi = {
			...square(0),
			extraPolygons: [square(5).coordinates],
		};
		expect(build(multi).key).not.toBe(build(square(0)).key);
	});

	it("identical repeat adds dedupe instead of stacking", () => {
		const once = addSelection({
			type: "Polygon",
			polygon: square(0),
		})([]);
		const twice = addSelection({
			type: "Polygon",
			polygon: square(0),
		})(once);
		expect(twice.length).toBe(1);
	});
});

describe("review overlay colors stay clear of the active marker", () => {
	// The active-location marker is red (hue 0 by default). The reviewed/unreviewed overlays must
	// not blend into it, or into each other, or the cursor gets lost in a field of queued markers.
	const hueOf = ([r, g, b]: [number, number, number]): number => {
		const max = Math.max(r, g, b);
		const d = max - Math.min(r, g, b);
		if (d === 0) return 0;
		let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
		h *= 60;
		return h < 0 ? h + 360 : h;
	};
	const circ = (a: number, b: number): number => {
		const d = Math.abs(a - b) % 360;
		return Math.min(d, 360 - d);
	};
	const colorFor = (mode: "reviewed" | "unreviewed") =>
		buildSelection({ type: "Reviewed", locations: [], sessionId: "s", mode }).color;
	const ACTIVE_HUE = 0; // default active-location marker is red

	it("unreviewed is well clear of red", () => {
		expect(circ(hueOf(colorFor("unreviewed")), ACTIVE_HUE)).toBeGreaterThanOrEqual(60);
	});
	it("reviewed is well clear of red", () => {
		expect(circ(hueOf(colorFor("reviewed")), ACTIVE_HUE)).toBeGreaterThanOrEqual(60);
	});
	it("reviewed and unreviewed are well separated from each other", () => {
		expect(circ(hueOf(colorFor("reviewed")), hueOf(colorFor("unreviewed")))).toBeGreaterThanOrEqual(
			60,
		);
	});
});

describe("buildSelection", () => {
	it("Everything gets correct key", () => {
		const sel = buildSelection({ type: "Everything" });
		expect(sel.key).toBe("everything");
	});

	// The shapes that used to be their own selector types are keyed as what they are: an
	// ordinary field filter. Nothing reads a `tag:` prefix any more.
	it("a tag is keyed as membership in the tags field", () => {
		expect(buildSelection(tagSelector(42)).key).toBe("filter:tags:contains:42");
	});

	it("untagged is keyed as the absent tags field", () => {
		expect(buildSelection(untaggedSelector()).key).toBe("filter:tags:nothas:null");
	});

	it("unpanned is keyed as a heading filter", () => {
		expect(buildSelection(unpannedSelector()).key).toBe("filter:heading:eq:0");
	});

	it("pano-id selectors key as the pinned composite", () => {
		expect(buildSelection(panoIdSelector(true)).key).toBe(
			"(filter:loadAsPanoId:eq:true)^(filter:panoId:has:null)",
		);
		expect(buildSelection(panoIdSelector(false)).key).toBe(
			"!(filter:loadAsPanoId:eq:true)^(filter:panoId:has:null)",
		);
	});

	it("Manual gets correct key", () => {
		const sel = buildSelection({ type: "Manual", locations: [1, 2] });
		expect(sel.key).toBe("manual");
	});

	it("Filter generates key with field/op/value", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "altitude",
			test: { op: "gt", value: 500 },
		});
		expect(sel.key).toBe("filter:altitude:gt:500");
	});

	it("Filter between includes both bounds", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "altitude",
			test: { op: "between", lo: 0, hi: 1000 },
		});
		expect(sel.key).toBe("filter:altitude:between:0:1000");
	});

	it("assigns a color", () => {
		const sel = buildSelection({ type: "Everything" });
		expect(sel.color).toHaveLength(3);
		expect(sel.color[0]).toBeGreaterThanOrEqual(0);
	});
});

describe("selector combinators", () => {
	const tag = tagSelector;
	const types = (sel: { selections: { selector: { type: string } }[] }) =>
		sel.selections.map((c) => c.selector.type);

	it("all intersects, flattening nested intersections and dropping Everything", () => {
		const out = all(all(tag(1), tag(2)), { type: "Everything" }, has("x"));
		expect(out.type).toBe("Intersection");
		expect(types(out as any)).toEqual(["Filter", "Filter", "Filter"]);
	});

	it("all of nothing is Everything, and of one is that one", () => {
		expect(all()).toEqual({ type: "Everything" });
		expect(all({ type: "Everything" }, tag(1))).toEqual(tag(1));
	});

	it("any unions, flattening nested unions and deduplicating by key", () => {
		const out = any(any(tag(1), tag(2)), tag(1));
		expect(out.type).toBe("Union");
		expect(types(out as any)).toEqual(["Filter", "Filter"]);
		expect(any(tag(3))).toEqual(tag(3));
	});

	it("any of nothing is an empty union", () => {
		expect(any()).toEqual({ type: "Union", selections: [] });
	});

	it("not inverts, and inverting twice gives the selector back", () => {
		const inverted = not(tag(1));
		expect(inverted.type).toBe("Invert");
		expect(not(inverted)).toEqual(tag(1));
	});

	it("has and lacks are presence filters on a field", () => {
		expect(has("panoId")).toEqual({ type: "Filter", field: "panoId", test: { op: "has" } });
		expect(lacks("panoId")).toEqual({ type: "Filter", field: "panoId", test: { op: "nothas" } });
	});
});

describe("addSelection / removeSelection", () => {
	it("addSelection appends a new selection", () => {
		const result = addSelection({ type: "Everything" })([]);
		expect(result).toHaveLength(1);
		expect(result[0].selection.key).toBe("everything");
	});

	it("addSelection deduplicates by key", () => {
		const first = addSelection({ type: "Everything" })([]);
		const second = addSelection({ type: "Everything" })(first);
		expect(second).toHaveLength(1);
	});

	it("addSelection updates a listed row in place, ghost and all", () => {
		const rows = [{ selection: buildSelection({ type: "Everything" }), ghosted: true }];
		const result = addSelection({ type: "Everything" })(rows);
		expect(result).toHaveLength(1);
		expect(result[0].ghosted).toBe(true);
	});

	it("removeSelection removes by key", () => {
		const rows = addSelection({ type: "Everything" })([]);
		const result = removeSelection("everything")(rows);
		expect(result).toHaveLength(0);
	});

	it("removeSelection decomposes composite on remove", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const composite = buildSelection({ type: "Intersection", selections: [s1, s2] });
		const result = bare(removeSelection(composite.key))([composite]);
		expect(result).toHaveLength(2);
	});
});

describe("intersectSelections", () => {
	it("creates intersection of two selections", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const result = intersectSelections(null)([s1, s2]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Intersection");
	});

	it("does nothing with fewer than 2 selections", () => {
		const s1 = buildSelection(tagSelector(9));
		const result = intersectSelections(null)([s1]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Filter");
	});

	it("flattens nested intersections", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const inter = intersectSelections(null)([s1, s2]);
		const s3 = buildSelection(unpannedSelector());
		const result = intersectSelections(null)([...inter, s3]);
		expect(result).toHaveLength(1);
		const children = (result[0].selector as { type: "Intersection"; selections: any[] }).selections;
		expect(children).toHaveLength(3);
	});
});

describe("unionSelections", () => {
	it("creates union of two selections", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const result = unionSelections(null)([s1, s2]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Union");
	});

	it("flattens nested unions", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const union = unionSelections(null)([s1, s2]);
		const s3 = buildSelection(unpannedSelector());
		const result = unionSelections(null)([...union, s3]);
		expect(result).toHaveLength(1);
		const children = (result[0].selector as { type: "Union"; selections: any[] }).selections;
		expect(children).toHaveLength(3);
	});
});

describe("invertSelections", () => {
	it("wraps a single selection in Invert", () => {
		const s1 = buildSelection(tagSelector(9));
		const result = invertSelections(null)([s1]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Invert");
	});

	it("double invert unwraps back to original", () => {
		const s1 = buildSelection(tagSelector(9));
		const inverted = invertSelections(null)([s1]);
		const result = invertSelections(null)(inverted);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Filter");
	});

	it("inverts a nested child in place, leaving the parent group intact", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const union = buildSelection({ type: "Union", selections: [s1, s2] });
		const result = bare(toggleInvert([0, 0]))([union]);
		expect(result).toHaveLength(1);
		const top = result[0].selector as { type: "Union"; selections: any[] };
		expect(top.type).toBe("Union");
		expect(top.selections).toHaveLength(2);
		const inverted = top.selections.find((c) => c.selector.type === "Invert");
		expect(inverted).toBeDefined();
		expect(inverted.selector.selections[0].key).toBe(s1.key);
	});

	it("toggles a nested invert back off without collapsing the group", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const union = buildSelection({ type: "Union", selections: [s1, s2] });
		const inverted = bare(toggleInvert([0, 0]))([union]);
		const result = bare(toggleInvert([0, 0]))(inverted);
		expect(result).toHaveLength(1);
		const top = result[0].selector as { type: "Union"; selections: any[] };
		expect(top.type).toBe("Union");
		expect(top.selections.map((c) => c.key).sort()).toEqual([s1.key, s2.key].sort());
	});

	it("inverts only the copy at the path when the same selection sits in two places", () => {
		const a = buildSelection(tagSelector(9));
		const b = buildSelection(untaggedSelector());
		const both = buildSelection({ type: "Intersection", selections: [a, b] });
		const result = bare(toggleInvert([1]))([both, a]);
		expect(result[0]).toBe(both);
		expect(result[1].selector).toEqual({ type: "Invert", selections: [a] });
		expect(invertSelections([a.key])([both, a])).toEqual(result);
	});
});

describe("ghosting", () => {
	const [a, b, c] = [9, 8, 7].map((id) => buildSelection(tagSelector(id)));
	const row = (selection: Selection, ghosted = false): ListedSelection => ({ selection, ghosted });
	const flags = (rows: ListedSelection[]) => rows.map((r) => r.ghosted);

	it("toggleGhost flips one row", () => {
		const rows = [row(a), row(b, true)];
		expect(flags(toggleGhost(0)(rows))).toEqual([true, true]);
		expect(flags(toggleGhost(1)(rows))).toEqual([false, false]);
		expect(toggleGhost(5)(rows)).toBe(rows);
	});

	it("isolateGhost leaves only one row active, and a repeat un-ghosts everything", () => {
		const rows = [row(a), row(b, true), row(c)];
		const isolated = isolateGhost(1)(rows);
		expect(flags(isolated)).toEqual([true, false, true]);
		expect(flags(isolateGhost(1)(isolated))).toEqual([false, false, false]);
		expect(flags(isolateGhost(0)([row(a)]))).toEqual([false]);
	});

	it("toggleGhostAll ghosts every row, or un-ghosts them all when every one is", () => {
		expect(flags(toggleGhostAll()([row(a), row(b, true)]))).toEqual([true, true]);
		expect(flags(toggleGhostAll()([row(a, true), row(b, true)]))).toEqual([false, false]);
		expect(toggleGhostAll()([])).toEqual([]);
	});
});

describe("withActive", () => {
	const [a, b, c, d] = [9, 8, 7, 6].map((id) => buildSelection(tagSelector(id)));
	const row = (selection: Selection, ghosted = false): ListedSelection => ({ selection, ghosted });

	it("keeps ghosted rows in place and fills the others in order", () => {
		const rows = [row(a), row(b, true), row(c)];
		expect(withActive(rows, [d])).toEqual([row(d), row(b, true)]);
		expect(withActive(rows, [c, d, a])).toEqual([row(c), row(b, true), row(d), row(a)]);
	});

	it("drops every active row when the selection empties, and leaves ghosted ones", () => {
		expect(withActive([row(a), row(b, true)], [])).toEqual([row(b, true)]);
	});

	it("lands a selection already listed as a ghosted row on that row, still ghosted", () => {
		const updated = { ...b, color: [1, 2, 3] as RGB };
		const result = withActive([row(a), row(b, true)], [a, updated]);
		expect(result).toEqual([row(a), row(updated, true)]);
	});
});

describe("row edits carry the ghost", () => {
	const filterA = {
		type: "Filter" as const,
		field: "year",
		test: { op: "between" as const, lo: 2010, hi: 2015 },
	};
	const [a, b, c] = [9, 8, 7].map((id) => buildSelection(tagSelector(id)));
	const row = (selection: Selection, ghosted = false): ListedSelection => ({ selection, ghosted });

	it("an edited ghosted row stays ghosted", () => {
		const rows = [row(buildSelection(filterA), true)];
		const edited = replaceSelection([0], { ...filterA, test: { ...filterA.test, hi: 2020 } })(rows);
		expect(edited[0].ghosted).toBe(true);
		expect(toggleInvert([0])(rows)[0].ghosted).toBe(true);
	});

	it("a moved row keeps its own ghost, not its new neighbour's", () => {
		const moved = moveSelection([0], [1], "after")([row(a, true), row(b)]);
		expect(moved).toEqual([row(b), row(a, true)]);
	});

	it("a ghosted group ungrouped by removal leaves ghosted children", () => {
		const group = buildSelection({ type: "Union", selections: [a, b] });
		expect(removeSelectionAt([0])([row(group, true), row(c)])).toEqual([
			row(a, true),
			row(b, true),
			row(c),
		]);
	});

	it("a ghosted row dragged into an active one takes the drop's ghost", () => {
		const result = composeSelections([0], [1], "Union")([row(a, true), row(b)]);
		expect(result).toHaveLength(1);
		expect(result[0].ghosted).toBe(false);
	});
});

describe("toggleManualSelection", () => {
	it("creates manual selection if none exists", () => {
		const result = bare(toggleManualSelection(1))([]);
		expect(result).toHaveLength(1);
		expect(result[0].key).toBe("manual");
	});

	it("adds to existing manual selection", () => {
		const initial = bare(toggleManualSelection(1))([]);
		const result = bare(toggleManualSelection(2))(initial);
		const ids = (result[0].selector as { type: "Manual"; locations: number[] }).locations;
		expect(ids).toContain(1);
		expect(ids).toContain(2);
	});

	it("removes from existing manual selection", () => {
		let sels = bare(toggleManualSelection(1))([]);
		sels = bare(toggleManualSelection(2))(sels);
		sels = bare(toggleManualSelection(1))(sels);
		const ids = (sels[0].selector as { type: "Manual"; locations: number[] }).locations;
		expect(ids).toEqual([2]);
	});

	it("removes manual selection entirely when last location toggled off", () => {
		let sels = bare(toggleManualSelection(1))([]);
		sels = bare(toggleManualSelection(1))(sels);
		expect(sels).toHaveLength(0);
	});
});

describe("moveSelection", () => {
	const [a, b, c, d] = [9, 8, 7, 6].map((id) => buildSelection(tagSelector(id)));

	it("moves selection before target", () => {
		expect(bare(moveSelection([2], [0], "before"))([a, b, c])).toEqual([c, a, b]);
	});

	it("moves selection after target", () => {
		expect(bare(moveSelection([0], [2], "after"))([a, b, c])).toEqual([b, c, a]);
	});

	it("moves a child out next to a top-level selection", () => {
		const group = buildSelection({ type: "Union", selections: [a, b, c] });
		const result = bare(moveSelection([0, 1], [1], "before"))([group, d]);
		expect(result[0].selector).toEqual({ type: "Union", selections: [a, c] });
		expect(result.slice(1)).toEqual([b, d]);
	});

	it("moves a top-level selection into a group, next to a child", () => {
		const group = buildSelection({ type: "Union", selections: [a, b] });
		const result = bare(moveSelection([1], [0, 0], "after"))([group, c]);
		expect(result).toHaveLength(1);
		expect(result[0].selector).toEqual({ type: "Union", selections: [a, c, b] });
	});

	it("moves a child between two different groups", () => {
		const g1 = buildSelection({ type: "Union", selections: [a, b] });
		const g2 = buildSelection({ type: "Intersection", selections: [c, d] });
		const result = bare(moveSelection([0, 1], [1, 0], "before"))([g1, g2]);
		expect(result[0]).toBe(a);
		expect(result[1].selector).toEqual({ type: "Intersection", selections: [b, c, d] });
	});

	it("moves a child out past its own group, collapsing the group", () => {
		const group = buildSelection({ type: "Union", selections: [a, b] });
		expect(bare(moveSelection([0, 0], [0], "after"))([group])).toEqual([b, a]);
		expect(bare(moveSelection([0, 1], [0], "before"))([group])).toEqual([b, a]);
	});

	it("moves a nested group out whole, without leaking its children into the parent", () => {
		const union = buildSelection({ type: "Union", selections: [a, b] });
		const parent = buildSelection({ type: "Intersection", selections: [union, c] });
		expect(bare(moveSelection([0, 0], [0], "after"))([parent])).toEqual([c, union]);
	});

	it("drops a group emptied by the move", () => {
		const union = buildSelection({ type: "Union", selections: [a, b] });
		const parent = buildSelection({ type: "Intersection", selections: [union] });
		expect(bare(moveSelection([0, 0], [0], "after"))([parent])).toEqual([union]);
	});

	it("merges into an equal selection already at the destination", () => {
		const group = buildSelection({ type: "Union", selections: [a, b] });
		const result = bare(moveSelection([0, 0], [1], "after"))([group, a]);
		expect(result).toEqual([b, a]);
	});

	it("will not move a selection next to its own child", () => {
		const group = buildSelection({ type: "Union", selections: [a, b] });
		expect(bare(moveSelection([0], [0, 1], "after"))([group, c])).toEqual([group, c]);
	});

	it("will not put a second selection inside an Invert", () => {
		const inv = buildSelection({ type: "Invert", selections: [a] });
		expect(bare(moveSelection([1], [0, 0], "after"))([inv, b])).toEqual([inv, b]);
	});
});

describe("removeSelectionAt", () => {
	it("removes a top-level selection and leaves a removed group's children behind", () => {
		const a = buildSelection(tagSelector(9));
		const b = buildSelection(untaggedSelector());
		const c = buildSelection(unpannedSelector());
		const group = buildSelection({ type: "Union", selections: [a, b] });
		expect(bare(removeSelectionAt([1]))([c, group])).toEqual([c, a, b]);
		expect(bare(removeSelectionAt([0]))([c, group])).toEqual([group]);
	});

	it("removes an inverted selection whole", () => {
		const a = buildSelection(tagSelector(9));
		const inv = buildSelection({ type: "Invert", selections: [a] });
		expect(bare(removeSelectionAt([0]))([inv])).toEqual([]);
	});

	it("merges a removed group's children into equal selections already in the list", () => {
		const a = buildSelection(tagSelector(9));
		const b = buildSelection(untaggedSelector());
		const group = buildSelection({ type: "Union", selections: [a, b] });
		expect(bare(removeSelectionAt([0]))([group, a])).toEqual([b, a]);
	});
});

describe("setSelectionColor", () => {
	it("recolors a nested selection and keeps its ancestors' colors", () => {
		const a = buildSelection(tagSelector(9));
		const b = buildSelection(untaggedSelector());
		const group = { ...buildSelection({ type: "Union", selections: [a, b] }), color: [1, 2, 3] };
		const result = bare(setSelectionColor([0, 1], [4, 5, 6]))([group as typeof a]);
		expect(result[0].key).toBe(group.key);
		expect(result[0].color).toEqual([1, 2, 3]);
		expect((result[0].selector as { selections: any[] }).selections[1].color).toEqual([4, 5, 6]);
	});
});

describe("selectionDisplayName", () => {
	// Core field defs live in Rust now, not in a JS table, so seed fake fields covering
	// each type. These exercise the display mechanics (label, op symbol, enum/date/month
	// formatting) without depending on any specific real field's catalog entry.
	beforeEach(() => {
		setUserFieldDefs({
			label: createFieldDef("string", { label: "Country code" }),
			height: createFieldDef("number", { label: "Altitude" }),
			cam: createFieldDef("enum", {
				label: "Camera type",
				values: [{ value: "gen4", label: "Gen 4" }],
			}),
			month: createFieldDef("month", { label: "Image date" }),
			exact: createFieldDef("date", { label: "Exact date" }),
		});
	});
	afterEach(() => {
		setUserFieldDefs({});
	});

	it("returns type name for simple types", () => {
		const sel = buildSelection({ type: "Everything" });
		expect(selectionDisplayName(sel)).toBe("Everything");
	});

	it("returns tag name for Tag selection", () => {
		h.tags = { 42: { id: 42, name: "My Tag", color: "#f00", visible: true } };
		const sel = buildSelection(tagSelector(42));
		expect(selectionDisplayName(sel)).toBe("Tag: My Tag");
	});

	it("falls back to tag ID if tag not found", () => {
		const sel = buildSelection(tagSelector(999));
		expect(selectionDisplayName(sel)).toBe("Tag: 999");
	});

	it("display name for Filter eq", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "label",
			test: { op: "eq", value: "BR" },
		});
		expect(selectionDisplayName(sel)).toBe("Country code = BR");
	});

	it("display name for Filter between", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "height",
			test: { op: "between", lo: 0, hi: 3000 },
		});
		expect(selectionDisplayName(sel)).toBe("Altitude between 0..3000");
	});

	it("display name for Filter neq", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "label",
			test: { op: "neq", value: "BR" },
		});
		expect(selectionDisplayName(sel)).toBe("Country code != BR");
	});

	it("display name for Filter gt", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "height",
			test: { op: "gt", value: 500 },
		});
		expect(selectionDisplayName(sel)).toBe("Altitude > 500");
	});

	it("display name for Filter lt", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "height",
			test: { op: "lt", value: 100 },
		});
		expect(selectionDisplayName(sel)).toBe("Altitude < 100");
	});

	it("display name for Filter gte", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "height",
			test: { op: "gte", value: 200 },
		});
		expect(selectionDisplayName(sel)).toBe("Altitude >= 200");
	});

	it("display name for Filter lte", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "height",
			test: { op: "lte", value: 300 },
		});
		expect(selectionDisplayName(sel)).toBe("Altitude <= 300");
	});

	it("display name for Filter has", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "height",
			test: { op: "has" },
		});
		expect(selectionDisplayName(sel)).toBe("has Altitude");
	});

	it("display name for Filter nothas", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "height",
			test: { op: "nothas" },
		});
		expect(selectionDisplayName(sel)).toBe("missing Altitude");
	});

	it("display name for Filter between_anyyear formats MM-DD as month day", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "month",
			test: { op: "between_anyyear", lo: "01-15", hi: "03-20" },
		});
		expect(selectionDisplayName(sel)).toBe("Image date between (any year) Jan 15..Mar 20");
	});

	it("display name for Filter between_anytime uses raw values", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "month",
			test: { op: "between_anytime", lo: "08:00", hi: "16:00" },
		});
		expect(selectionDisplayName(sel)).toBe("Image date between (any date) 08:00..16:00");
	});

	it("display name for Filter enum field shows label not raw value", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "cam",
			test: { op: "eq", value: "gen4" },
		});
		expect(selectionDisplayName(sel)).toBe("Camera type = Gen 4");
	});

	it("display name for Filter date field formats unix timestamp", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "exact",
			test: { op: "gt", value: 1700000000 },
		});
		// Chip labels render date fields in local time to match the DatePicker.
		const d = new Date(1700000000 * 1000);
		const p = (n: number) => String(n).padStart(2, "0");
		const expected = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
		expect(selectionDisplayName(sel)).toBe(`Exact date > ${expected}`);
	});

	it("display name for tzLocal filters renders wall-clock values in UTC", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "exact",
			test: { op: "between", lo: 1583020800, hi: 1583107140, tzLocal: true },
		});
		expect(selectionDisplayName(sel)).toBe(
			"Exact date between 2020-03-01 00:00..2020-03-01 23:59 (location time)",
		);
	});

	it("tzLocal filters get a distinct key from absolute-frame filters", () => {
		const abs = buildSelection({
			type: "Filter",
			field: "exact",
			test: { op: "between", lo: 1, hi: 2 },
		});
		const local = buildSelection({
			type: "Filter",
			field: "exact",
			test: { op: "between", lo: 1, hi: 2, tzLocal: true },
		});
		expect(abs.key).not.toBe(local.key);
		expect(local.key.endsWith(":local")).toBe(true);
	});

	it("display name for Filter uses raw field name when no fieldDef exists", () => {
		const sel = buildSelection({
			type: "Filter",
			field: "unknownField",
			test: { op: "eq", value: "test" },
		});
		expect(selectionDisplayName(sel)).toBe("unknownField = test");
	});

	it("display name for Filter enum uses user-defined field defs", () => {
		setUserFieldDefs({
			myCustomField: createFieldDef("enum", {
				label: "Custom",
				values: [
					{ value: "a", label: "Alpha" },
					{ value: "b", label: "Beta" },
				],
			}),
		});
		const sel = buildSelection({
			type: "Filter",
			field: "myCustomField",
			test: { op: "eq", value: "a" },
		});
		expect(selectionDisplayName(sel)).toBe("Custom = Alpha");
	});

	it("display name for Locations with name", () => {
		const sel = buildSelection({ type: "Locations", locations: [1, 2], name: "My Set" });
		expect(selectionDisplayName(sel)).toBe("My Set");
	});

	it("display name for Locations without name", () => {
		const sel = buildSelection({ type: "Locations", locations: [1], name: null });
		expect(selectionDisplayName(sel)).toBe("Selection");
	});

	it("display name for Polygon without name", () => {
		const sel = buildSelection({
			type: "Polygon",
			polygon: {
				coordinates: [
					[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 0],
					],
				],
				extraPolygons: null,
			},
		});
		expect(selectionDisplayName(sel)).toBe("Polygon");
	});

	it("display name for Polygon with name", () => {
		const sel = buildSelection({
			type: "Polygon",
			polygon: {
				coordinates: [
					[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 0],
					],
				],
				extraPolygons: null,
				properties: { name: "Europe" },
			},
		});
		expect(selectionDisplayName(sel)).toBe("Polygon: Europe");
	});

	it("display name for Duplicates", () => {
		const sel = buildSelection({ type: "Duplicates", distance: 100 });
		setSetting("units", "metric");
		expect(selectionDisplayName(sel)).toBe("Duplicates (100 m)");
		setSetting("units", "imperial");
		expect(selectionDisplayName(sel)).toBe("Duplicates (328 ft)");
		setSetting("units", "auto");
	});

	it("display name for Manual", () => {
		const sel = buildSelection({ type: "Manual", locations: [1, 2, 3] });
		expect(selectionDisplayName(sel)).toBe("Manual selection");
	});

	it("display name for ValidationState", () => {
		const sel = buildSelection({
			type: "ValidationState",
			locations: [1],
			state: ValidationState.NotFound,
		});
		expect(selectionDisplayName(sel)).toBe("Not found");
	});

	it("display name for ValidationState PanoIdBroke", () => {
		const sel = buildSelection({
			type: "ValidationState",
			locations: [2],
			state: ValidationState.PanoIdBroke,
		});
		expect(selectionDisplayName(sel)).toBe("Pano ID broke");
	});

	it("display name for Intersection", () => {
		const s1 = buildSelection(panoIdSelector(true));
		const s2 = buildSelection(untaggedSelector());
		const inter = intersectSelections(null)([s1, s2]);
		expect(selectionDisplayName(inter[0])).toBe("Intersection");
	});

	it("display name for Union", () => {
		const s1 = buildSelection(panoIdSelector(true));
		const s2 = buildSelection(untaggedSelector());
		const union = unionSelections(null)([s1, s2]);
		expect(selectionDisplayName(union[0])).toBe("Union");
	});

	it("display name for Invert includes child name", () => {
		const s1 = buildSelection(panoIdSelector(true));
		const inverted = invertSelections(null)([s1]);
		expect(selectionDisplayName(inverted[0])).toBe("Coordinate locations");
	});

	it("every named selection is recognised from what its builder derives", () => {
		expect(selectionDisplayName(buildSelection(untaggedSelector()))).toBe("Untagged");
		expect(selectionDisplayName(buildSelection(unpannedSelector()))).toBe("Unpanned");
		expect(selectionDisplayName(buildSelection(panoIdSelector(true)))).toBe("Pano ID locations");
	});

	it("names a selection carrying a key saved before the field system", () => {
		const stale = { ...buildSelection(panoIdSelector(true)), key: "panoids" };
		expect(selectionDisplayName(stale)).toBe("Pano ID locations");
	});
});

describe("displayTagName", () => {
	afterEach(() => {
		setSetting("tagViewMode", "flat");
		setSetting("truncateTagPaths", false);
	});

	it("computes unique suffixes over visible tags only, ignoring soft-deleted ghosts", () => {
		setSetting("tagViewMode", "tree");
		setSetting("truncateTagPaths", true);
		h.tags = {
			1: { id: 1, name: "Europe/France", color: "#111", visible: true },
			// Deleted tag kept for undo — must not widen the survivor's suffix.
			2: { id: 2, name: "Asia/France", color: "#222", visible: false },
		};
		expect(displayTagName("Europe/France")).toBe("France");
	});

	it("returns the name verbatim outside tree/truncate mode", () => {
		h.tags = { 1: { id: 1, name: "Europe/France", color: "#111", visible: true } };
		expect(displayTagName("Europe/France")).toBe("Europe/France");
	});
});

describe("SELECTIONS.locations", () => {
	it("copies the ids out rather than aliasing them", () => {
		const locs = [10, 20, 30];
		const result = SELECTIONS.Manual.locations!({ type: "Manual", locations: locs });
		expect(result).toEqual([10, 20, 30]);
		expect(result).not.toBe(locs);
	});

	it("is declared by exactly the variants that carry an id list", () => {
		const carriers = Object.entries(SELECTIONS)
			.filter(([, d]) => d.locations)
			.map(([type]) => type)
			.sort();
		expect(carriers).toEqual(["Locations", "Manual", "Reviewed", "ValidationState"]);
	});
});

describe("moveSelection edge cases", () => {
	const s1 = buildSelection(tagSelector(9));
	const s2 = buildSelection(untaggedSelector());

	it("returns unchanged when the from path leads nowhere", () => {
		expect(bare(moveSelection([5], [1], "before"))([s1, s2])).toEqual([s1, s2]);
	});

	it("returns unchanged when the to path leads nowhere", () => {
		expect(bare(moveSelection([0], [5], "before"))([s1, s2])).toEqual([s1, s2]);
	});

	it("returns unchanged when from and to are the same", () => {
		expect(bare(moveSelection([0], [0], "before"))([s1, s2])).toEqual([s1, s2]);
	});
});

describe("composeSelections", () => {
	it("drag onto drop creates intersection", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const result = bare(composeSelections([1], [0], "Intersection"))([s1, s2]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Intersection");
	});

	it("drag onto drop creates union", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const result = bare(composeSelections([1], [0], "Union"))([s1, s2]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Union");
	});

	it("drag onto existing composite adds as child", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const composed = bare(composeSelections([1], [0], "Intersection"))([s1, s2]);
		const s3 = buildSelection(unpannedSelector());
		const result = bare(composeSelections([1], [0], "Intersection"))([...composed, s3]);
		expect(result).toHaveLength(1);
		const children = (result[0].selector as { selections: any[] }).selections;
		expect(children).toHaveLength(3);
	});

	it("returns unchanged if drag equals drop", () => {
		const s1 = buildSelection(tagSelector(9));
		const result = bare(composeSelections([0], [0], "Intersection"))([s1]);
		expect(result).toEqual([s1]);
	});

	it("returns unchanged if the path leads nowhere", () => {
		const s1 = buildSelection(tagSelector(9));
		const result = bare(composeSelections([5], [0], "Intersection"))([s1]);
		expect(result).toEqual([s1]);
	});

	it("returns unchanged when dropping a group onto its own child", () => {
		const a = buildSelection(tagSelector(9));
		const b = buildSelection(untaggedSelector());
		const group = buildSelection({ type: "Union", selections: [a, b] });
		expect(bare(composeSelections([0], [0, 1], "Intersection"))([group])).toEqual([group]);
		expect(bare(composeSelections([0, 1], [0], "Intersection"))([group])).toEqual([group]);
	});

	it("moves a child between two different groups", () => {
		const [a, b, c, d] = [9, 8, 7, 6].map((id) => buildSelection(tagSelector(id)));
		const g1 = buildSelection({ type: "Union", selections: [a, b] });
		const g2 = buildSelection({ type: "Union", selections: [c, d] });
		const result = bare(composeSelections([0, 0], [1, 0], "Intersection"))([g1, g2]);
		expect(result[0]).toBe(b);
		expect(result[1].selector).toEqual({
			type: "Union",
			selections: [buildSelection({ type: "Intersection", selections: [c, a] }), d],
		});
	});
});

describe("composeSelections preserves the Invert wrapper", () => {
	const invertedGroup = () => {
		const a = buildSelection(tagSelector(9));
		const b = buildSelection(untaggedSelector());
		const c = buildSelection(unpannedSelector());
		const group = buildSelection({ type: "Union", selections: [a, b, c] });
		const inv = buildSelection({ type: "Invert", selections: [group] });
		return { a, b, c, inv };
	};

	it("when nesting two children of an inverted group", () => {
		const { inv } = invertedGroup();
		const result = bare(composeSelections([0, 0, 0], [0, 0, 1], "Intersection"))([inv]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Invert");
		const innerGroup = (result[0].selector as { selections: any[] }).selections[0];
		expect(innerGroup.selector.type).toBe("Union");
	});

	it("when nesting a top-level selection onto a child", () => {
		const { inv } = invertedGroup();
		const drag = buildSelection(tagSelector(7));
		const result = bare(composeSelections([1], [0, 0, 0], "Intersection"))([inv, drag]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Invert");
		expect((result[0].selector as { selections: any[] }).selections[0].selector.type).toBe("Union");
	});
});

describe("removeSelectionAt inside a composite", () => {
	it("removes a child and reduces composite", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const s3 = buildSelection(unpannedSelector());
		const parent = buildSelection({ type: "Intersection", selections: [s1, s2, s3] });
		const result = bare(removeSelectionAt([0, 1]))([parent]);
		expect(result).toHaveLength(1);
		const children = (result[0].selector as { selections: any[] }).selections;
		expect(children.map((c: any) => c.key)).toEqual([s1.key, s3.key]);
	});

	it("removes only the copy at the path when the same selection sits in two places", () => {
		const a = buildSelection(tagSelector(9));
		const b = buildSelection(untaggedSelector());
		const c = buildSelection(unpannedSelector());
		const g1 = buildSelection({ type: "Intersection", selections: [a, b] });
		const g2 = buildSelection({ type: "Intersection", selections: [c, a] });
		const result = bare(removeSelectionAt([1, 1]))([g1, g2]);
		expect(result).toEqual([g1, c]);
	});

	// Deleting a nested group ungroups it: its children stay behind in the parent. Deliberate,
	// and the one place a removal is allowed to keep the removed node's children.
	it("ungroups a nested group into the parent", () => {
		const a = buildSelection(tagSelector(9));
		const b = buildSelection(untaggedSelector());
		const c = buildSelection(unpannedSelector());
		const union = buildSelection({ type: "Union", selections: [a, b] });
		const parent = buildSelection({ type: "Intersection", selections: [union, c] });

		const result = bare(removeSelectionAt([0, 0]))([parent]);

		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Intersection");
		expect((result[0].selector as { selections: any[] }).selections.map((s: any) => s.key)).toEqual(
			[a.key, b.key, c.key],
		);
	});

	it("removes a composite that has no children left", () => {
		const a = buildSelection(tagSelector(9));
		const b = buildSelection(untaggedSelector());
		const inner = buildSelection({ type: "Union", selections: [a, b] });
		const outer = buildSelection({ type: "Intersection", selections: [inner] });

		// Inner drops to one child, so it collapses, and so does the outer wrapping it.
		expect(bare(removeSelectionAt([0, 0, 0]))([outer])).toEqual([b]);
		// Nothing left in the parent at all: the parent goes too.
		const solo = buildSelection({ type: "Intersection", selections: [a] });
		expect(bare(removeSelectionAt([0, 0]))([solo])).toEqual([]);
	});

	it("preserves the Invert wrapper when removing a child from an inverted group", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const s3 = buildSelection(unpannedSelector());
		const group = buildSelection({ type: "Intersection", selections: [s1, s2, s3] });
		const inv = buildSelection({ type: "Invert", selections: [group] });
		const result = bare(removeSelectionAt([0, 0, 0]))([inv]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Invert");
		const innerGroup = (result[0].selector as { selections: any[] }).selections[0];
		expect(innerGroup.selector.type).toBe("Intersection");
		const children = (innerGroup.selector as { selections: any[] }).selections;
		expect(children.map((c: any) => c.key).sort()).toEqual([s2.key, s3.key].sort());
	});

	it("keeps Invert when the inverted group collapses to a single child", () => {
		const s1 = buildSelection(tagSelector(9));
		const s2 = buildSelection(untaggedSelector());
		const group = buildSelection({ type: "Intersection", selections: [s1, s2] });
		const inv = buildSelection({ type: "Invert", selections: [group] });
		const result = bare(removeSelectionAt([0, 0, 0]))([inv]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Invert");
		expect((result[0].selector as { selections: any[] }).selections[0].key).toBe(s2.key);
	});
});

describe("replaceSelection", () => {
	const filterA = {
		type: "Filter" as const,
		field: "year",
		test: { op: "between" as const, lo: 2010, hi: 2015 },
	};
	const filterAEdited = { ...filterA, test: { ...filterA.test, lo: 2012, hi: 2020 } };

	it("replaces a top-level selection and updates its key", () => {
		const sel = buildSelection(filterA);
		const result = bare(replaceSelection([0], filterAEdited))([sel]);
		expect(result).toHaveLength(1);
		expect(result[0].key).toBe(buildSelection(filterAEdited).key);
		expect(result[0].key).not.toBe(sel.key);
		expect((result[0].selector as typeof filterAEdited).test.lo).toBe(2012);
	});

	it("preserves the Invert wrapper when editing a child of an inverted group", () => {
		const a = buildSelection(filterA);
		const b = buildSelection(untaggedSelector());
		const group = buildSelection({ type: "Union", selections: [a, b] });
		const inv = buildSelection({ type: "Invert", selections: [group] });
		const result = bare(replaceSelection([0, 0, 0], filterAEdited))([inv]);
		expect(result).toHaveLength(1);
		expect(result[0].selector.type).toBe("Invert");
		const innerGroup = (result[0].selector as { selections: any[] }).selections[0];
		expect(innerGroup.selector.type).toBe("Union");
		const children = (innerGroup.selector as { selections: any[] }).selections;
		expect(children.some((c: any) => c.key === buildSelection(filterAEdited).key)).toBe(true);
		expect(children.some((c: any) => c.key === b.key)).toBe(true);
	});

	it("replaces a child inside a composite and rebuilds the parent key", () => {
		const a = buildSelection(filterA);
		const b = buildSelection(untaggedSelector());
		const composed = intersectSelections(null)([a, b]); // [Intersection(a,b)]
		const parent = composed[0];
		const result = bare(replaceSelection([0, 0], filterAEdited))(composed);

		expect(result).toHaveLength(1);
		expect(result[0].key).not.toBe(parent.key); // parent key rebuilt
		const children = (result[0].selector as { selections: any[] }).selections;
		expect(children).toHaveLength(2);
		expect(children.some((c: any) => c.key === buildSelection(filterAEdited).key)).toBe(true);
		expect(children.some((c: any) => c.key === b.key)).toBe(true); // sibling preserved
		expect(children.some((c: any) => c.key === a.key)).toBe(false); // old child gone
	});

	it("is a no-op when the path leads nowhere", () => {
		const rows = [{ selection: buildSelection(filterA), ghosted: false }];
		expect(replaceSelection([3], filterAEdited)(rows)).toBe(rows);
		expect(replaceSelection([0, 0], filterAEdited)(rows)).toBe(rows);
	});

	it("merges into the existing selection when the re-key collides, keeping the existing one", () => {
		const a = buildSelection(filterA);
		const b = buildSelection(filterAEdited);
		const result = bare(replaceSelection([0], filterAEdited))([a, b]); // edit A onto B's value
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(b); // pre-existing selection kept, untouched
	});

	it("keeps the existing selection regardless of list order (existing always wins)", () => {
		const a = buildSelection(filterA);
		const b = buildSelection(filterAEdited);
		const result = bare(replaceSelection([1], filterAEdited))([b, a]); // existing sits before the edit
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(b);
	});

	it("merges a child onto a sibling and unwraps the collapsed group", () => {
		const a = buildSelection(filterA);
		const b = buildSelection(filterAEdited);
		const group = unionSelections(null)([a, b]); // [Union(a, b)]
		const result = bare(replaceSelection([0, 0], filterAEdited))(group); // edit a -> b's value
		expect(result).toHaveLength(1);
		expect(result[0].key).toBe(b.key); // (b OR b) collapsed to just b
		expect(result[0].selector.type).toBe("Filter"); // unwrapped, no longer a Union
	});

	it("merges recursively when an edit makes two groups identical", () => {
		const shared = buildSelection(tagSelector(9));
		const b = buildSelection(filterA);
		const c = buildSelection(filterAEdited);
		const g1 = intersectSelections(null)([shared, b])[0]; // Intersection(shared, b)
		const g2 = intersectSelections(null)([shared, c])[0]; // Intersection(shared, c)
		const result = bare(replaceSelection([1, 1], filterA))([g1, g2]); // edit c -> b's value
		expect(result).toHaveLength(1);
		expect(result[0].key).toBe(g1.key); // g2 became g1 -> kept the pre-existing g1
	});
});

describe("sampleIds", () => {
	const ids = Array.from({ length: 20 }, (_, i) => i + 1);

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns exactly n distinct ids drawn from the input", () => {
		const out = sampleIds(ids, 5);
		expect(out).toHaveLength(5);
		expect(new Set(out).size).toBe(5); // no duplicates
		for (const x of out) expect(ids).toContain(x);
	});

	it("clamps n to the input length", () => {
		const out = sampleIds(ids, 999);
		expect(out).toHaveLength(ids.length);
		expect(new Set(out)).toEqual(new Set(ids)); // a permutation of all ids
	});

	it("floors fractional counts", () => {
		expect(sampleIds(ids, 3.9)).toHaveLength(3);
	});

	it("returns an empty array for non-positive counts", () => {
		expect(sampleIds(ids, 0)).toEqual([]);
		expect(sampleIds(ids, -4)).toEqual([]);
	});

	it("does not mutate the input array", () => {
		const input = ids.slice();
		sampleIds(input, 10);
		expect(input).toEqual(ids);
	});

	it("is deterministic given a fixed RNG", () => {
		vi.spyOn(Math, "random").mockReturnValue(0); // always pick the first remaining element
		expect(sampleIds([10, 20, 30, 40], 2)).toEqual([10, 20]);
	});
});

describe("rewriteSelectionFields", () => {
	const filter = (field: string) =>
		buildSelection({ type: "Filter", field, test: { op: "eq", value: 1 } });

	it("rewrites a Filter field and regenerates its key", () => {
		const out = bare(rewriteSelectionFields("a", "b"))([filter("a")]);
		expect(out).toHaveLength(1);
		expect((out[0].selector as { field: string }).field).toBe("b");
		expect(out[0].key).toBe("filter:b:eq:1");
	});

	it("leaves unrelated filters untouched", () => {
		const f = filter("c");
		const out = bare(rewriteSelectionFields("a", "b"))([f]);
		expect(out[0].key).toBe(f.key);
	});

	it("drops a Filter when the field is deleted (to = null)", () => {
		expect(bare(rewriteSelectionFields("a", null))([filter("a")])).toEqual([]);
	});

	it("rewrites filters nested in a composite", () => {
		const union = buildSelection({ type: "Union", selections: [filter("a"), filter("c")] });
		const out = bare(rewriteSelectionFields("a", "b"))([union]);
		const children = (out[0].selector as { selections: { selector: { field: string } }[] })
			.selections;
		expect(children.map((c) => c.selector.field)).toEqual(["b", "c"]);
	});

	it("collapses a group to its sole survivor when a child is deleted", () => {
		const tag = buildSelection(tagSelector(1));
		const union = buildSelection({ type: "Union", selections: [filter("a"), tag] });
		const out = bare(rewriteSelectionFields("a", null))([union]);
		expect(out).toHaveLength(1);
		expect(out[0].selector.type).toBe("Filter");
	});
});

describe("Ranked selector key derivation", () => {
	it("key includes expr, k, ascending, and empty inner selection", () => {
		const sel = buildSelection({
			type: "Ranked",
			selection: null,
			expr: "altitude",
			k: 10,
			ascending: false,
		});
		expect(sel.key).toBe("ranked:altitude:10:false:");
	});

	it("key includes inner selection key when present", () => {
		const inner = buildSelection(untaggedSelector());
		const sel = buildSelection({
			type: "Ranked",
			selection: inner,
			expr: "altitude",
			k: 5,
			ascending: true,
		});
		expect(sel.key).toBe(`ranked:altitude:5:true:${inner.key}`);
	});

	it("null k serializes as 'null' in the key", () => {
		const sel = buildSelection({
			type: "Ranked",
			selection: null,
			expr: "lat",
			k: null,
			ascending: false,
		});
		expect(sel.key).toBe("ranked:lat:null:false:");
	});

	it("label without k says 'Ranked by'", () => {
		const sel = buildSelection({
			type: "Ranked",
			selection: null,
			expr: "myField",
			k: null,
			ascending: false,
		});
		expect(selectionDisplayName(sel)).toBe("Ranked by myField");
	});

	it("label with k and ascending says 'Bottom k by'", () => {
		const sel = buildSelection({
			type: "Ranked",
			selection: null,
			expr: "myField",
			k: 3,
			ascending: true,
		});
		expect(selectionDisplayName(sel)).toBe("Bottom 3 by myField");
	});

	it("label with k and descending says 'Top k by'", () => {
		const sel = buildSelection({
			type: "Ranked",
			selection: null,
			expr: "myField",
			k: 3,
			ascending: false,
		});
		expect(selectionDisplayName(sel)).toBe("Top 3 by myField");
	});
});

describe("childSelections", () => {
	it("returns selections array for Intersection", () => {
		const a = buildSelection(panoIdSelector(true));
		const b = buildSelection(untaggedSelector());
		const sel = { type: "Intersection" as const, selections: [a, b] };
		expect(childSelections(sel)).toEqual([a, b]);
	});

	it("returns selections array for Union", () => {
		const a = buildSelection(panoIdSelector(true));
		const sel = { type: "Union" as const, selections: [a] };
		expect(childSelections(sel)).toEqual([a]);
	});

	it("returns single-element array for Ranked with selection", () => {
		const inner = buildSelection(untaggedSelector());
		const sel = { type: "Ranked" as const, selection: inner, expr: "lat", k: 5, ascending: true };
		expect(childSelections(sel)).toEqual([inner]);
	});

	it("returns empty array for Ranked without selection", () => {
		const sel = {
			type: "Ranked" as const,
			selection: null,
			expr: "lat",
			k: null,
			ascending: false,
		};
		expect(childSelections(sel)).toEqual([]);
	});

	it("returns empty array for leaf selectors", () => {
		expect(childSelections({ type: "Everything" })).toEqual([]);
		expect(childSelections(tagSelector(1))).toEqual([]);
		expect(childSelections(untaggedSelector())).toEqual([]);
		expect(childSelections({ type: "Duplicates", distance: 10 })).toEqual([]);
		expect(childSelections({ type: "Filter", field: "x", test: { op: "has" } })).toEqual([]);
	});
});

describe("withChildren", () => {
	it("replaces children in Intersection", () => {
		const a = buildSelection(panoIdSelector(true));
		const b = buildSelection(untaggedSelector());
		const sel = { type: "Intersection" as const, selections: [a] };
		const result = withChildren(sel, [a, b]);
		expect((result as { selections: unknown[] }).selections).toEqual([a, b]);
	});

	it("replaces children in Union", () => {
		const a = buildSelection(panoIdSelector(true));
		const sel = { type: "Union" as const, selections: [a] };
		const result = withChildren(sel, []);
		expect((result as { selections: unknown[] }).selections).toEqual([]);
	});

	it("replaces the optional selection in Ranked", () => {
		const inner = buildSelection(untaggedSelector());
		const replacement = buildSelection(panoIdSelector(true));
		const sel = { type: "Ranked" as const, selection: inner, expr: "lat", k: 5, ascending: true };
		const result = withChildren(sel, [replacement]);
		expect((result as { selection: unknown }).selection).toBe(replacement);
	});

	it("sets selection to null when children is empty for Ranked", () => {
		const inner = buildSelection(untaggedSelector());
		const sel = {
			type: "Ranked" as const,
			selection: inner,
			expr: "lat",
			k: null,
			ascending: true,
		};
		const result = withChildren(sel, []);
		expect((result as { selection: unknown }).selection).toBeNull();
	});

	it("returns the selector unchanged for leaf types", () => {
		const leaf = { type: "Everything" as const };
		expect(withChildren(leaf, [])).toEqual(leaf);
	});

	it("roundtrips: withChildren(sel, childSelections(sel)) preserves shape", () => {
		const a = buildSelection(panoIdSelector(true));
		const b = buildSelection(untaggedSelector());
		const intersection = { type: "Intersection" as const, selections: [a, b] };
		const result = withChildren(intersection, childSelections(intersection));
		expect((result as { selections: unknown[] }).selections).toEqual([a, b]);
	});
});

describe("locationsKey", () => {
	const keyOf = (ids: number[]) =>
		buildSelection({ type: "Locations", locations: ids, name: null }).key;

	it("is stable for the same ids", () => {
		expect(locationsKey([1, 2, 3])).toBe(locationsKey([1, 2, 3]));
		expect(keyOf([4, 5])).toBe(keyOf([4, 5]));
	});

	it("separates different id lists, including reorderings and subsets", () => {
		const keys = new Set([
			locationsKey([]),
			locationsKey([1]),
			locationsKey([2]),
			locationsKey([1, 2]),
			locationsKey([2, 1]),
			locationsKey([1, 2, 3]),
		]);
		expect(keys.size).toBe(6);
	});

	it("keys a huge selection in constant length", () => {
		const ids = Array.from({ length: 200_000 }, (_, i) => i);
		const key = locationsKey(ids);
		expect(key.length).toBeLessThan(40);
		expect(key.startsWith("locations:200000:")).toBe(true);
		expect(locationsKey(ids.slice(0, -1))).not.toBe(key);
	});

	it("does not collide across a large family of lists", () => {
		const keys = new Set<string>();
		for (let i = 0; i < 20_000; i += 1) keys.add(locationsKey([i, i + 1, i * 7]));
		expect(keys.size).toBe(20_000);
	});
});
