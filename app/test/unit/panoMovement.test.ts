import { describe, expect, it } from "vitest";
import {
	angularDistance,
	distanceMeters,
	movementCandidates,
	selectMoveLink,
} from "@/lib/pano/movement";

const position = { lat: 39.9, lng: 116.4 };

describe("panorama movement", () => {
	it("measures angles across north", () => {
		expect(angularDistance(355, 5)).toBe(10);
		expect(angularDistance(90, 270)).toBe(180);
	});

	it("selects the nearest panorama in the requested direction", () => {
		const links = [
			{ panoId: "far", heading: 8, distanceMeters: 35 },
			{ panoId: "near", heading: 20, distanceMeters: 12 },
			{ panoId: "behind", heading: 185, distanceMeters: 10 },
		];
		expect(selectMoveLink(links, position, 0, "forward")?.panoId).toBe("near");
		expect(selectMoveLink(links, position, 0, "backward")?.panoId).toBe("behind");
	});

	it("prefers movement history for backward navigation", () => {
		const links = [
			{ panoId: "nearest", heading: 180, distanceMeters: 8 },
			{ panoId: "previous", heading: 190, distanceMeters: 16 },
		];
		expect(selectMoveLink(links, position, 0, "backward", "previous")?.panoId).toBe("previous");
	});

	it("rejects distant, off-axis, or non-adjacent panoramas", () => {
		const links = [
			{ panoId: "side", heading: 90, distanceMeters: 5 },
			{ panoId: "distant", heading: 0, distanceMeters: 80 },
			{ panoId: "hidden-far-scene", heading: 0, distanceMeters: 5, adjacent: false },
		];
		expect(selectMoveLink(links, position, 0, "forward")).toBeNull();
	});

	it("derives short local distances from provider coordinates", () => {
		expect(distanceMeters(position, { lat: 39.9001, lng: 116.4 })).toBeCloseTo(11.132, 1);
	});

	it("keeps non-adjacent markers hidden but clickable within 100 metres", () => {
		const links = [
			{ panoId: "near", heading: 0, distanceMeters: 99.9, adjacent: true },
			{ panoId: "far", heading: 180, distanceMeters: 100.1, adjacent: true },
			{ panoId: "hidden-far-scene", heading: 90, distanceMeters: 5, adjacent: false },
		];
		expect(
			movementCandidates(links, position).map(({ link, visible }) => ({
				panoId: link.panoId,
				visible,
			})),
		).toEqual([
			{ panoId: "near", visible: true },
			{ panoId: "hidden-far-scene", visible: false },
		]);
	});

	it("deduplicates nearby headings and keeps the nearest panorama", () => {
		const links = [
			{ panoId: "far", heading: 5, distanceMeters: 24 },
			{ panoId: "nearest", heading: 0, distanceMeters: 8 },
			{ panoId: "branch", heading: 20, distanceMeters: 12 },
		];
		expect(movementCandidates(links, position).map(({ link }) => link.panoId)).toEqual([
			"nearest",
			"branch",
		]);
	});

	it("prefers a visible adjacent marker when hidden candidates share its direction", () => {
		const candidates = movementCandidates(
			[
				{ panoId: "hidden-near", heading: 0, distanceMeters: 5, adjacent: false },
				{ panoId: "visible-adjacent", heading: 5, distanceMeters: 20, adjacent: true },
			],
			position,
		);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].link.panoId).toBe("visible-adjacent");
		expect(candidates[0].visible).toBe(true);
	});

	it("places move markers at a fixed -30 degree pitch", () => {
		const [candidate] = movementCandidates(
			[{ panoId: "next", heading: 0, distanceMeters: 10 }],
			position,
		);
		expect(candidate.pitch).toBeCloseTo(-Math.PI / 6);
	});
});
