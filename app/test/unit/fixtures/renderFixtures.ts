import type { SelColor } from "@/lib/render/CellManager";
import type { RenderDelta, RenderEntry } from "@/bindings.gen";

export function entry(
	cell: string,
	id: number,
	lng: number,
	lat: number,
	heading = 0,
	sel: SelColor = null,
): RenderEntry {
	return { cell, id, lng, lat, heading, sel, movedFrom: null };
}

/** A `SelColor`: the paint a delta entry carries. `idx` is the drawing selection's
 *  position in the selection list, which is what the overlay orders by. */
export function paint(color: [number, number, number], idx = 0): SelColor {
	return { idx, color };
}

/** A render delta with everything defaulted, so a case names only what it exercises. */
export function delta(parts: Partial<RenderDelta> = {}): RenderDelta {
	return { added: [], updated: [], removed: [], ...parts };
}

/** A coordinate-free patch: the shape a pure membership change arrives as. */
export function selPatch(cell: string, cellIndex: number, sel: SelColor) {
	return { cell, cellIndex, lng: null, lat: null, heading: null, sel };
}
