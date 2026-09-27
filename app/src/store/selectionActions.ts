import { memoOnRefs } from "@/lib/util/memoOnRefs";
import type { Selection } from "@/bindings.gen";
import { getActiveSelections, getMapState } from "@/store/useMapStore";
import { tagIdOf } from "@/store/selections";

/** Tag ids that have a top-level Tag selection listed, ghosted or not. */
export const getSelectedTagIds: () => ReadonlySet<number> = (() => {
	let prev: Set<number> | null = null;
	return memoOnRefs(
		() => [getMapState().selectionList] as const,
		(rows) => {
			const ids = new Set(
				rows.flatMap((r) => {
					const id = tagIdOf(r.selection.selector);
					return id == null ? [] : [id];
				}),
			);
			if (prev && prev.symmetricDifference(ids).size === 0) return prev;
			prev = ids;
			return ids;
		},
	);
})();

/** Tag ids of every Tag leaf in the active selection tree, in list order.
 *  Includes composite children, excludes ghosted selections; ids may repeat. */
export const getSelectedTagIdsDeep: () => readonly number[] = memoOnRefs(
	() => [getActiveSelections()] as const,
	(sels) => {
		const out: number[] = [];
		const walk = (list: Selection[]) => {
			for (const s of list) {
				const id = tagIdOf(s.selector);
				if (id != null) out.push(id);
				if ("selections" in s.selector) walk(s.selector.selections);
			}
		};
		walk(sels);
		return out;
	},
);
