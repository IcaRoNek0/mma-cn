/**
 * Creating a GeoGuessr draft from the sync sidebar, end to end against the local stub
 * (ggStubServer.ts): the create request, the link, and the first sync writing the map's
 * locations into the new draft.
 */

import { addLocs, createLocation, useMap, withApi } from "./helpers";
import { GG_STUB_CONTROL_PATH, ggStubPort } from "./ggStubServer";

const control = `http://127.0.0.1:${ggStubPort()}${GG_STUB_CONTROL_PATH}`;
const MAP_NAME = "E2E GG Create";

interface Hit {
	method: string;
	url: string;
	body: string;
}

async function hits(reset = false): Promise<Hit[]> {
	const res = await fetch(control, reset ? { method: "DELETE" } : undefined);
	return ((await res.json()) as { hits: Hit[] }).hits;
}

const stubbed = !!process.env.MMA_E2E_GG_ORIGIN;

describe("GeoGuessr draft creation", function () {
	useMap(MAP_NAME);

	before(async function () {
		if (!stubbed) this.skip();
		await withApi(async (api) => {
			api.setPluginEnabled("geoguessr", true);
			api.activatePlugin("geoguessr");
		});
		await hits(true);
	});

	it("creates a draft named after the map, links it, and writes the map into it", async () => {
		await addLocs([createLocation({ lat: 1, lng: 2 }), createLocation({ lat: 3, lng: 4 })]);

		await browser.$('button[aria-label="GeoGuessr"]').click();
		await browser.$("button=Create a new remote map from this one").click();
		await browser.$("button=Sync now").waitForExist();

		const puts = async () => (await hits()).filter((h) => h.method === "PUT");
		await browser.waitUntil(async () => (await puts()).length > 0, {
			timeoutMsg: "the first sync never wrote the new draft",
		});

		const create = (await hits()).find(
			(h) => h.method === "POST" && h.url === "/api/v4/user-maps/drafts",
		);
		expect(create && JSON.parse(create.body)).toEqual({ name: MAP_NAME, mode: "coordinates" });

		const [put] = await puts();
		const written = JSON.parse(put.body) as {
			version: number;
			customCoordinates: { lat: number; lng: number }[];
		};
		expect(written.version).toBe(1);
		expect(written.customCoordinates.map((c) => [c.lat, c.lng]).sort()).toEqual([
			[1, 2],
			[3, 4],
		]);
	});
});
