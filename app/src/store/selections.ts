/** Pure selection transforms: build, compose, invert, rewrite, and remove selections. */

import type { FilterOp, PolygonGeometry } from "@/bindings.gen";
import type { Tag } from "@/types";
import { getVisibleTags, getTag } from "@/store/useMapStore";
import { hslToRgb, type RGB } from "@/lib/util/color";
import { getFieldDef, fieldValueLabel } from "@/lib/data/fieldDefRegistry";
import { formatDistance, localDateTime, utcDateTime } from "@/lib/util/format";
import { batch, clamp, isVariant, unionTuple, type Variant } from "@/types/util";
export { batch };
import { ValidationState } from "@/bindings.consts";
import { getSettings } from "@/store/settings";
import { dayMonthFmt } from "@/lib/util/format";
import { t, msg } from "@/lib/i18n";
import { shortestUniqueSuffixes } from "@/lib/data/tagPaths";

import type { Selection, Selector } from "@/bindings.gen";
export interface SelectionState {
	selections: Selection[];
	ghosted: ReadonlySet<string>;
}

export type SelectionPatch = Partial<SelectionState>;

/** Selector variants that wrap child selections (Intersection, Union, Invert). */
export type CompositeType = Extract<Selector, { selections: Selection[] }>["type"];
/** Composite variants that wrap exactly one child (e.g. Invert). */
export type UnaryType = "Invert";
/** Composite variants that are flat n-ary groups. */
export type GroupType = Exclude<CompositeType, UnaryType>;

const GROUP_TYPES = unionTuple<GroupType>()(["Intersection", "Union"]);
export const UNARY_TYPES = unionTuple<UnaryType>()(["Invert"]);

export type FilterOpKind = FilterOp["op"];

/** Whether a predicate reads the location's clock in its own timezone. Only a range can. */
export const filterIsLocalTime = (test: FilterOp): boolean =>
	"tzLocal" in test && test.tzLocal === true;

/** Display symbol/word for each filter operator. Symbols are language-neutral; only the worded
 *  operators are marked for translation. */
export const OP_LABELS: Record<FilterOpKind, string> = {
	eq: "=",
	neq: "!=",
	gt: ">",
	lt: "<",
	gte: ">=",
	lte: "<=",
	between: msg("between"),
	between_anyyear: msg("between (any year)"),
	between_anytime: msg("between (any date)"),
	has: msg("has"),
	nothas: msg("does not have"),
	contains: msg("contains"),
	notcontains: msg("does not contain"),
};

/** Locations carrying `tagId`. A tag is membership in the `tags` list field and nothing
 *  else, so there is no tag selector to build. */
export const tagSelector = (tagId: number): Selector => ({
	type: "Filter",
	field: "tags",
	test: { op: "contains", value: tagId },
});

/** Locations with no tags: `tags` resolves to nothing on an untagged row. */
export const untaggedSelector = (): Selector => ({
	type: "Filter",
	field: "tags",
	test: { op: "nothas" },
});

/** Locations whose heading was never set. */
export const unpannedSelector = (): Selector => ({
	type: "Filter",
	field: "heading",
	test: { op: "eq", value: 0 },
});

/** Locations pinned to one exact pano (the flag plus a pano id, mirroring Rust's
 *  `Selector::pano_ids`), or the locations not pinned. */
export function panoIdSelector(on: boolean): Selector {
	const pinned: Selector = {
		type: "Intersection",
		selections: [
			buildSelection({ type: "Filter", field: "loadAsPanoId", test: { op: "eq", value: true } }),
			buildSelection({ type: "Filter", field: "panoId", test: { op: "has" } }),
		],
	};
	return on ? pinned : { type: "Invert", selections: [buildSelection(pinned)] };
}

/** The tag a selector names, or null when it names something else. The single place that
 *  recognises tag membership, so nothing else has to know its shape. */
export function tagIdOf(selector: Selector): number | null {
	return selector.type === "Filter" &&
		selector.field === "tags" &&
		selector.test.op === "contains" &&
		typeof selector.test.value === "number"
		? selector.test.value
		: null;
}

/** Whether a selector is the pinned composite `panoIdSelector` builds (`true`), its
 *  inversion (`false`), or something else (`null`). Display-only. */
export function panoIdOf(selector: Selector): boolean | null {
	const { pano, types } = named();
	if (!types.has(selector.type)) return null;
	const key = buildSelection(selector).key;
	if (key === pano.on) return true;
	return key === pano.off ? false : null;
}

/** The name a selection carries of its own, when it is one the builders name. */
function namedLabel(selector: Selector): string | undefined {
	const { labels, types } = named();
	if (!types.has(selector.type)) return undefined;
	return labels.get(buildSelection(selector).key)?.();
}

let registry: {
	labels: Map<string, () => string>;
	types: Set<Selector["type"]>;
	pano: { on: string; off: string };
} | null = null;

/** The selections that carry a name of their own, recognised by the key their builder
 *  derives: recognition is the builder inverted, so the shape is described once. Labels
 *  stay thunks because the locale resolves at render. */
function named() {
	if (!registry) {
		const entry = (selector: Selector, label: () => string) => ({
			key: buildSelection(selector).key,
			type: selector.type,
			label,
		});
		const panoOn = entry(panoIdSelector(true), () => t("Pano ID locations"));
		const panoOff = entry(panoIdSelector(false), () => t("Coordinate locations"));
		const all = [
			entry(untaggedSelector(), () => t("Untagged")),
			entry(unpannedSelector(), () => t("Unpanned")),
			panoOn,
			panoOff,
		];
		registry = {
			labels: new Map(all.map((n) => [n.key, n.label])),
			types: new Set(all.map((n) => n.type)),
			pano: { on: panoOn.key, off: panoOff.key },
		};
	}
	return registry;
}

/** Deterministic color derived from a selection key string. */
export function colorForKey(key: string): RGB {
	let t = 0;
	for (let i = 0; i < key.length; i += 1) t = ((key.charCodeAt(i) + (t << 5)) | 0) + t;
	t = (((t * 214013) | 0) + 2531011) | 0;
	return hslToRgb(Math.abs(t) % 360, 0.5, 0.5);
}

/** Key an id list by hashing it: the same ids in the same order give the same key.
 *  Order-sensitive, like the list it identifies. Key length is constant. */
export function locationsKey(ids: number[]): string {
	let h1 = 0xdeadbeef | 0;
	let h2 = 0x41c6ce57 | 0;
	for (const id of ids) {
		h1 = Math.imul(h1 ^ id, 2654435761);
		h2 = Math.imul(h2 ^ id, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return `locations:${ids.length}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** Ghost keys that "solo" `key`: everything except it. Returns an empty set when `key`
 *  is already the sole visible selection, so a repeat call un-isolates (clears all ghosts). */
export function isolateGhostKeys(
	keys: string[],
	ghosted: ReadonlySet<string>,
	key: string,
): Set<string> {
	const alreadyIsolated = !ghosted.has(key) && keys.every((k) => k === key || ghosted.has(k));
	return alreadyIsolated ? new Set() : new Set(keys.filter((k) => k !== key));
}

/** Toggle one selection's ghosted (dimmed) state. */
export const toggleGhost =
	(key: string) =>
	(_sels: Selection[], ghosted: ReadonlySet<string>): SelectionPatch => ({
		ghosted: ghosted.symmetricDifference(new Set([key])),
	});

/** Solo one selection by ghosting all others. Repeat to clear all ghosts. */
export const isolateGhost =
	(key: string) =>
	(sels: Selection[], ghosted: ReadonlySet<string>): SelectionPatch => ({
		ghosted: isolateGhostKeys(
			sels.map((s) => s.key),
			ghosted,
			key,
		),
	});

/** Ghost all selections, or clear all ghosts if every selection is already ghosted. */
export const toggleGhostAll =
	() =>
	(sels: Selection[], ghosted: ReadonlySet<string>): SelectionPatch => {
		const keys = new Set(sels.map((s) => s.key));
		const allGhosted = keys.size > 0 && keys.isSubsetOf(ghosted);
		return { ghosted: allGhosted ? new Set() : ghosted.union(keys) };
	};

/** Pick `n` distinct ids uniformly at random from `ids`. `n` is floored and clamped to
 *  `[0, ids.length]`, so an over-large count returns all ids. `ids` is not mutated. */
export function sampleIds(ids: number[], n: number): number[] {
	const k = clamp(Math.floor(n), 0, ids.length);
	const pool = ids.slice();
	for (let i = 0; i < k; i += 1) {
		const j = i + Math.floor(Math.random() * (pool.length - i));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return pool.slice(0, k);
}

/** What one selection type answers about itself; optional answers default at the lookup. */
interface SelectionDescriptor<K extends Selector["type"]> {
	key(selector: Variant<Selector, K>, locations: number[]): string;
	label(selector: Variant<Selector, K>, tagNames?: Record<number, string>): string;
	/** Null falls through to the key hash. */
	color?(selector: Variant<Selector, K>): RGB | null;
	locations?(selector: Variant<Selector, K>): number[];
}

const ownLocations = (s: { locations: number[] }) => [...s.locations];

/** Per-type descriptor for each selector variant: key derivation, display label, and optional color/location overrides. */
export const SELECTIONS: { [K in Selector["type"]]: SelectionDescriptor<K> } = {
	Locations: {
		key: (_s, locations) => locationsKey(locations),
		label: (s) => s.name ?? t("Selection"),
		locations: ownLocations,
	},
	Everything: {
		key: () => "everything",
		label: () => t("Everything"),
	},
	Polygon: {
		key: (s) => polygonKey(s.polygon),
		label: (s) =>
			s.polygon.properties?.name
				? t("Polygon: {name}", { name: String(s.polygon.properties.name) })
				: t("Polygon"),
		color: () => {
			const { polygonColorMode, polygonColor } = getSettings();
			return polygonColorMode === "fixed" ? polygonColor : null;
		},
	},
	Uncommitted: {
		key: () => "uncommitted",
		label: () => t("Uncommitted"),
	},
	Duplicates: {
		key: (s) => `duplicates:${s.distance}`,
		label: (s) => t("Duplicates ({distance})", { distance: formatDistance(s.distance) }),
	},
	Manual: {
		key: () => "manual",
		label: () => t("Manual selection"),
		locations: ownLocations,
	},
	ValidationState: {
		key: (s) => `validation:${s.state}`,
		label: (s) => t(validationStateLabel(s.state as ValidationState)),
		locations: ownLocations,
	},
	Reviewed: {
		key: (s) => `review:${s.sessionId}:${s.mode}`,
		label: (s) => (s.mode === "unreviewed" ? t("Unreviewed") : t("Reviewed")),
		// Green reviewed, violet unreviewed: both stay clear of the red active marker.
		color: (s) => (s.mode === "unreviewed" ? hslToRgb(280, 0.6, 0.5) : hslToRgb(145, 0.6, 0.5)),
		locations: ownLocations,
	},
	Intersection: {
		key: (s) => s.selections.map((c) => `(${c.key})`).join("^"),
		label: () => t("Intersection"),
	},
	Union: {
		key: (s) => s.selections.map((c) => `(${c.key})`).join("|"),
		label: () => t("Union"),
	},
	Invert: {
		key: (s) => `!${s.selections[0].key}`,
		label: (s, tagNames) =>
			t("Invert: {selection}", { selection: selectionDisplayName(s.selections[0], tagNames) }),
	},
	Filter: {
		key: (s) => {
			const t = s.test;
			const operands = "lo" in t ? [t.lo, t.hi] : "value" in t ? [t.value] : [null];
			const frame = filterIsLocalTime(t) ? ":local" : "";
			return `filter:${s.field}:${t.op}:${operands.map(String).join(":")}${frame}`;
		},
		label: (p, tagNames) => {
			const fieldDef = getFieldDef(p.field);
			const fieldLabel = fieldDef?.label ? t(fieldDef.label) : p.field;
			const test = p.test;
			const tagId = tagIdOf(p);
			if (tagId != null) return t("Tag: {name}", { name: tagDisplayName(tagId, tagNames) });
			if (test.op === "has") return t("has {field}", { field: fieldLabel });
			if (test.op === "nothas") return t("missing {field}", { field: fieldLabel });
			const fmtMD = (v: unknown) => {
				const s = String(v);
				const m = /^(\d{2})-(\d{2})$/.exec(s);
				if (m) {
					const dt = new Date(2000, Number(m[1]) - 1, Number(m[2]));
					return dayMonthFmt.format(dt);
				}
				return s;
			};
			// Local-time values are wall-clock instants encoded as UTC epochs: render via UTC getters.
			const local = filterIsLocalTime(test);
			const fmtVal = (v: unknown) => {
				if (fieldDef?.type === "date") {
					const n = Number(v);
					if (!isNaN(n)) return local ? utcDateTime(n) : localDateTime(n);
				}
				return fieldValueLabel(fieldDef, v);
			};
			const tzSuffix = local ? " " + t("(location time)") : "";
			const clause = (value: string) =>
				t("{field} {op} {value}", { field: fieldLabel, op: t(OP_LABELS[test.op]), value }) +
				tzSuffix;
			if (test.op === "between_anyyear") return clause(`${fmtMD(test.lo)}..${fmtMD(test.hi)}`);
			if (test.op === "between_anytime") return clause(`${test.lo}..${test.hi}`);
			if (test.op === "between") return clause(`${fmtVal(test.lo)}..${fmtVal(test.hi)}`);
			return clause(fmtVal(test.value));
		},
	},
	Ranked: {
		key: (s) => `ranked:${s.expr}:${s.k}:${s.ascending}:${s.selection?.key ?? ""}`,
		label: (s) => {
			const fieldDef = getFieldDef(s.expr);
			const by = fieldDef?.label ? t(fieldDef.label) : s.expr;
			if (s.k == null) return t("Ranked by {field}", { field: by });
			return s.ascending
				? t("Bottom {k} by {field}", { k: s.k, field: by })
				: t("Top {k} by {field}", { k: s.k, field: by });
		},
	},
};

function descriptorFor(selector: Selector) {
	const d = SELECTIONS[selector.type] as SelectionDescriptor<Selector["type"]>;
	return {
		key: (locations: number[]) => d.key(selector, locations),
		label: (tagNames?: Record<number, string>) => d.label(selector, tagNames),
		color: () => d.color?.(selector) ?? null,
		locations: () => d.locations?.(selector) ?? [],
	};
}

// Key a polygon by hashing its raw coordinates: identical geometry = identical key.
function polygonKey(geom: PolygonGeometry): string {
	let h1 = 0xdeadbeef | 0;
	let h2 = 0x41c6ce57 | 0;
	const f64 = new Float64Array(2);
	const u32 = new Uint32Array(f64.buffer);
	const foldRing = (ring: [number, number][]) => {
		for (const [lng, lat] of ring) {
			f64[0] = lng;
			f64[1] = lat;
			h1 = Math.imul(h1 ^ u32[0], 2654435761) ^ u32[1];
			h2 = Math.imul(h2 ^ u32[2], 1597334677) ^ u32[3];
		}
	};
	for (const ring of geom.coordinates) foldRing(ring);
	for (const poly of geom.extraPolygons ?? []) for (const ring of poly) foldRing(ring);
	return `polygon:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** Every child selection a selector wraps, whatever shape it wraps them in. */
export function childSelections(selector: Selector): Selection[] {
	if ("selections" in selector) return selector.selections;
	if ("selection" in selector) return selector.selection ? [selector.selection] : [];
	return [];
}

/** `selector` with its children replaced, keeping the shape it wraps them in. */
export function withChildren(selector: Selector, children: Selection[]): Selector {
	if ("selections" in selector) return { ...selector, selections: children };
	if ("selection" in selector) return { ...selector, selection: children[0] ?? null };
	return selector;
}

/** Create a Selection with a deterministic key and color from its selector. */
export function buildSelection(selector: Selector): Selection {
	const d = descriptorFor(selector);
	const key = d.key(d.locations());
	return { key, color: d.color() ?? colorForKey(key), selector };
}

// dedupe by key, preserving order of last occurrence
function dedupe(selections: Selection[]): Selection[] {
	const map = new Map<string, Selection>();
	for (const s of selections) map.set(s.key, s);
	return map.size === selections.length ? selections : Array.from(map.values());
}

function compose(type: GroupType, selectors: Selector[]): Selector {
	const parts = selectors.flatMap((s): Selection[] => {
		if (s.type === type) return s.selections;
		if (type === "Intersection" && s.type === "Everything") return [];
		return [buildSelection(s)];
	});
	if (parts.length === 1) return parts[0].selector;
	if (parts.length === 0 && type === "Intersection") return { type: "Everything" };
	return { type, selections: dedupe(parts) };
}

/** Locations matching every one of `selectors`; with none, every location. */
export const all = (...selectors: Selector[]): Selector => compose("Intersection", selectors);

/** Locations matching any of `selectors`; with none, no location. */
export const any = (...selectors: Selector[]): Selector => compose("Union", selectors);

/** Locations not matching `selector`. */
export const not = (selector: Selector): Selector =>
	selector.type === "Invert"
		? selector.selections[0].selector
		: { type: "Invert", selections: [buildSelection(selector)] };

/** Locations holding a value for `field`. */
export const has = (field: string): Selector => ({ type: "Filter", field, test: { op: "has" } });

/** Locations holding no value for `field`. */
export const lacks = (field: string): Selector => ({
	type: "Filter",
	field,
	test: { op: "nothas" },
});

/** Append a new selection built from `selector`, deduplicating by key. */
export const addSelection =
	(selector: Selector) =>
	(current: Selection[]): Selection[] =>
		dedupe([...current, buildSelection(selector)]);

/** Remove the top-level selection whose key is `key`. A removed group leaves its children behind in its place. */
export const removeSelection =
	(key: string) =>
	(current: Selection[]): Selection[] => {
		const i = current.findIndex((s) => s.key === key);
		return i === -1 ? current : removeSelectionAt([i])(current);
	};

/** Split selections into [matching the keys, everything else]. */
function partitionByKeys(current: Selection[], keys: string[]): [Selection[], Selection[]] {
	const targets: Selection[] = [];
	const others: Selection[] = [];
	for (const s of current) (keys.includes(s.key) ? targets : others).push(s);
	return [targets, others];
}

/** Merge targeted selections into a single composite, flattening nested groups of the same type. */
function composeSelectionGroup(
	current: Selection[],
	keys: string[] | null,
	type: "Intersection" | "Union",
): Selection[] {
	if (current.length < 2) return current;
	const [targets, others] = partitionByKeys(current, keys ?? current.map((s) => s.key));
	const flat = targets.flatMap((s) => (s.selector.type === type ? s.selector.selections : [s]));
	return [...others, buildSelection({ type, selections: dedupe(flat) })];
}

/** Merge the targeted selections (or all, when `keys` is null) into a single Intersection. */
export const intersectSelections =
	(keys: string[] | null = null) =>
	(current: Selection[]) =>
		composeSelectionGroup(current, keys, "Intersection");

/** Merge the targeted selections (or all, when `keys` is null) into a single Union. */
export const unionSelections =
	(keys: string[] | null = null) =>
	(current: Selection[]) =>
		composeSelectionGroup(current, keys, "Union");

/** Invert targeted top-level selections. A single target toggles in place; several are wrapped in Union then Invert. */
export const invertSelections =
	(keys: string[] | null = null) =>
	(current: Selection[]): Selection[] => {
		if (current.length === 0) return current;
		const targetKeys = keys ?? current.map((s) => s.key);
		if (targetKeys.length === 1) {
			const i = current.findIndex((s) => s.key === targetKeys[0]);
			return i === -1 ? current : toggleInvert([i])(current);
		}
		const [targets, others] = partitionByKeys(current, targetKeys);
		const flat = targets.flatMap((s) =>
			s.selector.type === "Union" ? s.selector.selections : [s],
		);
		const inner = flat.length === 1 ? flat[0] : buildSelection({ type: "Union", selections: flat });
		return [...others, buildSelection({ type: "Invert", selections: [inner] })];
	};

/** Add or remove a location from the Manual selection, creating it if needed. */
export const toggleManualSelection =
	(locationId: number) =>
	(current: Selection[]): Selection[] => {
		const idx = current.findIndex((s) => s.key === "manual");
		if (idx === -1)
			return [...current, buildSelection({ type: "Manual", locations: [locationId] })];
		const sel = current[idx];
		const ids = (sel.selector as Variant<Selector, "Manual">).locations.slice();
		const at = ids.indexOf(locationId);
		if (at === -1) ids.push(locationId);
		else ids.splice(at, 1);
		if (ids.length === 0) return current.toSpliced(idx, 1);
		const next = buildSelection({ type: "Manual", locations: ids });
		return current.with(idx, next);
	};

/** Where a selection sits: its index in the list, then its index among the children of each
 *  selection it is nested in. */
export type SelectionPath = readonly number[];

/** The selection at `path`, or undefined when nothing sits there. */
export function selectionAt(list: Selection[], path: SelectionPath): Selection | undefined {
	let node: Selection | undefined = list[path[0]];
	for (const i of path.slice(1)) node = node && childSelections(node.selector)[i];
	return node;
}

const isWithin = (inner: SelectionPath, outer: SelectionPath) =>
	outer.length <= inner.length && outer.every((i, depth) => inner[depth] === i);

interface PathEdit {
	path: SelectionPath;
	edit: (node: Selection) => Selection[];
}

// Swap each edited node for what its edit returns, rebuilding the ancestors around it: a group
// left with one member collapses to it, an emptied composite disappears, and a node that now
// duplicates a sibling merges into that sibling. Edits must not nest inside one another.
function spliceAt(list: Selection[], edits: PathEdit[]): Selection[] {
	const byIndex = [...Map.groupBy(edits, (e) => e.path[0])].sort(([a], [b]) => b - a);
	let out = list;
	byIndex.forEach(([i, here], n) => {
		const node = list[i];
		if (!node) return;
		const leaf = here.find((e) => e.path.length === 1);
		const replacement = leaf ? leaf.edit(node) : rebuildAround(node, here);
		if (replacement.length === 1 && replacement[0] === node) return;
		const pending = new Set(byIndex.slice(n + 1).map(([j]) => j));
		out = spliceMerging(out, i, replacement, pending);
	});
	return out;
}

function rebuildAround(node: Selection, edits: PathEdit[]): Selection[] {
	const children = childSelections(node.selector);
	const next = spliceAt(
		children,
		edits.map((e) => ({ ...e, path: e.path.slice(1) })),
	);
	if (next === children) return [node];
	if (isVariant(node.selector, GROUP_TYPES) && next.length <= 1) return next;
	if (isVariant(node.selector, UNARY_TYPES) && next.length === 0) return [];
	const rebuilt = buildSelection(withChildren(node.selector, next));
	return [rebuilt.key === node.key ? { ...rebuilt, color: node.color } : rebuilt];
}

// Put `replacement` at `index`, dropping whatever of it already sits elsewhere in `list`: the
// existing selection wins. Nodes at `pending` indices are about to be edited, so they don't count.
function spliceMerging(
	list: Selection[],
	index: number,
	replacement: Selection[],
	pending: ReadonlySet<number>,
): Selection[] {
	const kept = new Set(list.filter((_, j) => j !== index && !pending.has(j)).map((s) => s.key));
	return list.toSpliced(index, 1, ...dedupe(replacement.filter((s) => !kept.has(s.key))));
}

/** Invert the selection at `path` in place, or restore it when it is already inverted. */
export const toggleInvert =
	(path: SelectionPath) =>
	(current: Selection[]): Selection[] =>
		spliceAt(current, [
			{
				path,
				edit: (node) => [
					node.selector.type === "Invert"
						? node.selector.selections[0]
						: buildSelection({ type: "Invert", selections: [node] }),
				],
			},
		]);

/** Merge the selection at `drag` into the one at `drop` as a `mode` composite, absorbing it into
 *  `drop` when that already is one. Nothing happens when either contains the other. */
export const composeSelections =
	(drag: SelectionPath, drop: SelectionPath, mode: GroupType) =>
	(current: Selection[]): Selection[] => {
		const dragged = selectionAt(current, drag);
		if (!dragged || !selectionAt(current, drop)) return current;
		if (isWithin(drag, drop) || isWithin(drop, drag)) return current;
		const merge = (target: Selection): Selection[] => [
			buildSelection({
				type: mode,
				selections: dedupe(
					isVariant(target.selector, mode)
						? [...target.selector.selections, dragged]
						: [target, dragged],
				),
			}),
		];
		return spliceAt(current, [
			{ path: drag, edit: () => [] },
			{ path: drop, edit: merge },
		]);
	};

/** Move the selection at `from` to just before or after the one at `to`, which must sit in the
 *  list or directly in a group. Nothing happens when `to` is inside the moved selection. */
export const moveSelection =
	(from: SelectionPath, to: SelectionPath, position: "before" | "after") =>
	(current: Selection[]): Selection[] => {
		const moved = selectionAt(current, from);
		if (!moved || !selectionAt(current, to) || isWithin(to, from)) return current;
		const parent = to.length > 1 ? selectionAt(current, to.slice(0, -1)) : undefined;
		if (parent && !isVariant(parent.selector, GROUP_TYPES)) return current;
		const place = (rest: Selection[]) =>
			position === "before" ? [moved, ...rest] : [...rest, moved];
		if (isWithin(from, to)) {
			const within = [0, ...from.slice(to.length)];
			const lift = (target: Selection) =>
				place(spliceAt([target], [{ path: within, edit: () => [] }]));
			return spliceAt(current, [{ path: to, edit: lift }]);
		}
		return spliceAt(current, [
			{ path: from, edit: () => [] },
			{ path: to, edit: (target) => place([target]) },
		]);
	};

/** Remove the selection at `path`. A removed group leaves its children behind in its place. */
export const removeSelectionAt =
	(path: SelectionPath) =>
	(current: Selection[]): Selection[] =>
		spliceAt(current, [
			{
				path,
				edit: (node) => (isVariant(node.selector, GROUP_TYPES) ? node.selector.selections : []),
			},
		]);

/** Replace the selection at `path` with one built from `selector`. If that duplicates a sibling,
 *  the existing sibling wins and the replacement is dropped. */
export function replaceSelection(
	current: Selection[],
	path: SelectionPath,
	selector: Selector,
): Selection[] {
	return spliceAt(current, [{ path, edit: () => [buildSelection(selector)] }]);
}

/** Human-readable label for a selection. Pass `tagNames` to resolve tags by saved name
 *  rather than the open map's tags. */
export function selectionDisplayName(sel: Selection, tagNames?: Record<number, string>): string {
	return namedLabel(sel.selector) ?? descriptorFor(sel.selector).label(tagNames);
}

let suffixCache: { tags: Tag[]; suffixes: Map<string, string> } | null = null;

/** Display label for a tag name. In tree view with `truncateTagPaths` on, collapses
 *  the `/`-path to its shortest unique suffix; otherwise returns the name verbatim. */
export function displayTagName(name: string): string {
	const s = getSettings();
	if (s.tagViewMode !== "tree" || !s.truncateTagPaths) return name;
	const tags = getVisibleTags();
	if (!suffixCache || suffixCache.tags !== tags) {
		suffixCache = { tags, suffixes: shortestUniqueSuffixes(tags.map((t) => t.name)) };
	}
	return suffixCache.suffixes.get(name) ?? name;
}

function tagDisplayName(tagId: number, tagNames?: Record<number, string>): string {
	const name = getTag(tagId)?.name;
	if (name != null) return displayTagName(name);
	// Not a tag on this map: a saved rule still knows what it was called where it was saved.
	return tagNames?.[tagId] ?? String(tagId);
}

function validationStateLabel(state: ValidationState): string {
	switch (state) {
		case ValidationState.Ok:
			return msg("Valid location");
		case ValidationState.UpdateAvailable:
			return msg("Newer coverage available");
		case ValidationState.UpdateApplied:
			return msg("Coverage updated since last view");
		case ValidationState.NotFound:
			return msg("Not found");
		case ValidationState.PanoIdBroke:
			return msg("Pano ID broke");
		case ValidationState.Unofficial:
			return msg("Unofficial");
		case ValidationState.GoodcamAvailable:
			return msg("Badcam, but good coverage available");
	}
}

/** Recolor the selection at `path`. */
export const setSelectionColor =
	(path: SelectionPath, color: RGB) =>
	(current: Selection[]): Selection[] =>
		spliceAt(current, [{ path, edit: (s) => [{ ...s, color }] }]);

/** Rename a Polygon selection's display name. */
export const setPolygonName =
	(path: SelectionPath, name: string) =>
	(current: Selection[]): Selection[] =>
		spliceAt(current, [
			{
				path,
				edit: (s) => {
					if (s.selector.type !== "Polygon") return [s];
					const polygon = {
						...s.selector.polygon,
						properties: { ...s.selector.polygon.properties, name },
					};
					return [{ ...s, selector: { ...s.selector, polygon } }];
				},
			},
		]);

// Rewrite Filter `field` references in a selection tree: `from` -> `to`, or drop the
// Filter when `to` is null. Composites collapse if emptied or unwrap to their sole survivor.
function rewriteSelection(sel: Selection, from: string, to: string | null): Selection | null {
	const p = sel.selector;
	if (p.type === "Filter") {
		if (p.field !== from) return sel;
		return to === null ? null : buildSelection({ ...p, field: to });
	}
	if ("selections" in p) {
		const children = p.selections
			.map((c) => rewriteSelection(c, from, to))
			.filter((c): c is Selection => c !== null);
		if (children.length === 0) return null;
		if (children.length === 1 && p.type !== "Invert") return children[0];
		return buildSelection({ ...p, selections: children } as Selector);
	}
	return sel;
}

/** Rename or remove a field across all Filter selections. When `to` is null, filters on that field are dropped. */
export const rewriteSelectionFields =
	(from: string, to: string | null) =>
	(selections: Selection[]): Selection[] =>
		selections.map((s) => rewriteSelection(s, from, to)).filter((s): s is Selection => s !== null);
