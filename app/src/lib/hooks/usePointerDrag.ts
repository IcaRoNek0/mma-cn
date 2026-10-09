import { useCallback, useRef } from "react";

export interface PointerDragHandlers {
	onMove: (ev: PointerEvent) => void;
	onEnd?: (ev: PointerEvent) => void;
}

/** Pointer-capture drag: returns an onPointerDown for the drag handle. `begin`
 *  runs on press and returns the drag's handlers (or null to ignore the press),
 *  closing over any per-drag state; listeners detach on release. */
export function usePointerDrag(
	begin: (e: React.PointerEvent) => PointerDragHandlers | null,
): (e: React.PointerEvent) => void {
	const beginRef = useRef(begin);
	beginRef.current = begin;
	return useCallback((e: React.PointerEvent) => {
		e.preventDefault();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const drag = beginRef.current(e);
		if (!drag) return;
		const ac = new AbortController();
		el.addEventListener("pointermove", drag.onMove, { signal: ac.signal });
		el.addEventListener(
			"pointerup",
			(ev) => {
				ac.abort();
				drag.onEnd?.(ev);
			},
			{ signal: ac.signal },
		);
	}, []);
}
