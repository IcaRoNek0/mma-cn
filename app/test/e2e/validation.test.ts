/* eslint-disable @typescript-eslint/no-explicit-any */
import { addLocs, createLocation, useMap, withApi } from "./helpers";
import type { Location } from "@/bindings.gen";
import { LocationFlag, ValidationFlag } from "@/bindings.consts";

const OFFICIAL_PANO = "-zrYsLR4Fh-cfJG_EMZ1-A";
const OFFICIAL_COORDS = { lat: 52.10947502806108, lng: 34.90131410856584 };
/// Not decodable as an image key, so it reaches the mock as itself: too long to be official.
const USER_PANO = "USER_UPLOADED_PANO_ID_!!!!!!";

function loc(overrides: Partial<Location> = {}): Location {
	return createLocation({ lat: 0, lng: 0, ...overrides });
}

/** `validateLocations` over a scope, as [flag, ids] pairs (a Map cannot cross the bridge). */
async function validate(ids: number[]): Promise<Map<number, number[]>> {
	const pairs = (await withApi(async (api, locIds) => {
		const grouped = await api.validateLocations({
			type: "Locations",
			locations: locIds,
			name: null,
		});
		return [...grouped.flags.entries()];
	}, ids)) as [number, number[]][];
	return new Map(pairs);
}

describe("Validation - coverage flags come back from the procedure", () => {
	useMap("validation");

	it("groups every location under each flag the procedure answered with", async () => {
		const ids = await addLocs([
			// Its pano resolves and the coordinate still finds the same one.
			loc({ ...OFFICIAL_COORDS, panoId: OFFICIAL_PANO }),
			// Open ocean: no pano stored, none at the coordinate.
			loc({ lat: 0, lng: 0 }),
			// Pinned to a pano that no longer resolves, but the coordinate has coverage.
			loc({ ...OFFICIAL_COORDS, panoId: "DEAD_PANO", flags: LocationFlag.LoadAsPanoId }),
			// A user-uploaded panorama.
			loc({ ...OFFICIAL_COORDS, panoId: USER_PANO, flags: LocationFlag.LoadAsPanoId }),
		]);

		const byFlag = await validate(ids);
		expect(byFlag.get(ValidationFlag.None)).toEqual([ids[0]]);
		expect(byFlag.get(ValidationFlag.NotFound)).toEqual([ids[1]]);
		expect(byFlag.get(ValidationFlag.PanoIdBroke)).toEqual([ids[2]]);
		expect(byFlag.get(ValidationFlag.Unofficial)).toEqual([ids[3]]);
		expect(byFlag.get(ValidationFlag.OffDefault)).toEqual([ids[3]]);
	});

	it("writes nothing to the locations it validates", async () => {
		const ids = await addLocs([loc({ ...OFFICIAL_COORDS, panoId: OFFICIAL_PANO })]);
		const before = await withApi(async (api, id) => {
			const l = await api.fetchLocation(id);
			return JSON.stringify({ panoId: l?.panoId, extra: l?.extra ?? null, mod: l?.modifiedAt });
		}, ids[0]);

		const byFlag = await validate(ids);
		expect(byFlag.get(ValidationFlag.None)).toEqual([ids[0]]);

		const after = await withApi(async (api, id) => {
			const l = await api.fetchLocation(id);
			return JSON.stringify({ panoId: l?.panoId, extra: l?.extra ?? null, mod: l?.modifiedAt });
		}, ids[0]);
		expect(after).toEqual(before);
	});

	it("reports progress and answers every location in the scope", async () => {
		const ids = await addLocs([
			loc({ ...OFFICIAL_COORDS, panoId: OFFICIAL_PANO }),
			loc({ ...OFFICIAL_COORDS, panoId: OFFICIAL_PANO }),
			loc({ lat: 0, lng: 0 }),
		]);

		const seen = (await withApi(async (api, locIds) => {
			const ticks: number[][] = [];
			const grouped = await api.validateLocations(
				{ type: "Locations", locations: locIds, name: null },
				{ onProgress: (done: number, total: number) => ticks.push([done, total]) },
			);
			const answered = new Set([...grouped.flags.values()].flat()).size;
			return { answered, last: ticks.at(-1) ?? null };
		}, ids)) as any;

		expect(seen.answered).toBe(3);
		expect(seen.last).toEqual([3, 3]);
	});
});
