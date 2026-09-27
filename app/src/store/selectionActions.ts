import { memoOnRefs } from "@/lib/util/memoOnRefs";
import type { Selection } from "@/bindings.gen";
import { applyListUpdate, getActiveSelections, getMapState } from "@/store/useMapStore";
import {
	addSelection,
	buildSelection,
	removeSelection,
	tagIdOf,
	tagSelector,
} from "@/store/selections";

/** Toggle tag selections on or off for the given tags. */
export function toggleTagSelections(tagIds: number[]) {
	if (tagIds.length === 0) return;
	void applyListUpdate((rows) =>
		tagIds.reduce((result, tagId) => {
			const key = buildSelection(tagSelector(tagId)).key;
			return result.some((r) => r.selection.key === key)
				? removeSelection(key)(result)
				: addSelection(tagSelector(tagId))(result);
		}, rows),
	);
}

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
