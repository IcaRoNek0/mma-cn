import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ListedSelection, PolygonGeometry } from "@/bindings.gen";

const h = vi.hoisted(() => ({
	updates: [] as ((rows: ListedSelection[]) => ListedSelection[])[],
	asked: [] as PolygonGeometry[],
}));

vi.mock("@/store/useMapStore", () => ({
	applySelectionUpdate: (op: (rows: ListedSelection[]) => ListedSelection[]) => {
		h.updates.push(op);
		return Promise.resolve();
	},
}));

// A polygon named "flat" encloses nothing; any other comes back as one untangled lobe.
vi.mock("@/lib/commands", () => ({
	cmd: {
		polygonUntangle: (polygon: PolygonGeometry) => {
			h.asked.push(polygon);
			if (polygon.properties?.name === "flat") return Promise.resolve(null);
			return Promise.resolve({ ...polygon, coordinates: lobe(String(polygon.properties?.name)) });
		},
	},
}));

import { addPolygonSelections } from "@/lib/map/addPolygonSelections";

const lobe = (name: string): [number, number][][] => {
	const x = name.charCodeAt(0);
	return [
		[
			[x, 0],
			[x + 1, 1],
			[x, 2],
			[x, 0],
		],
	];
};
const bowtie = (name: string): PolygonGeometry => ({
	coordinates: [
		[
			[0, 0],
			[2, 2],
			[2, 0],
			[0, 2],
			[0, 0],
		],
	],
	extraPolygons: null,
	properties: { name },
});

beforeEach(() => {
	h.updates = [];
	h.asked = [];
});

describe("addPolygonSelections", () => {
	it("stores the untangled geometry, never the drawn one", async () => {
		await addPolygonSelections([bowtie("a"), bowtie("b")]);
		expect(h.asked.map((p) => p.properties?.name)).toEqual(["a", "b"]);
		expect(h.updates).toHaveLength(1);
		const rows = h.updates[0]([]);
		expect(rows).toHaveLength(2);
		expect(
			rows.map(
				({ selection: { selector } }) =>
					selector.type === "Polygon" && selector.polygon.coordinates,
			),
		).toEqual([lobe("a"), lobe("b")]);
	});

	it("drops polygons that enclose nothing, and adds nothing when none are left", async () => {
		await addPolygonSelections([bowtie("flat"), bowtie("kept")]);
		expect(h.updates[0]([])).toHaveLength(1);
		h.updates = [];
		await addPolygonSelections([bowtie("flat")]);
		expect(h.updates).toHaveLength(0);
	});
});
