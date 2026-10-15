// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { mount } from "./fixtures/harness";
import type { PsvPanoramaController } from "@/lib/sv/panoSingleton";

vi.mock("@/store/settings", () => ({ useSettings: () => ({ defaultMovementMode: "nmpz" }) }));
vi.mock("@/lib/i18n", () => ({ t: (value: string) => value }));
vi.mock("@/lib/util/toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/primitives/Tooltip", () => ({
	Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@radix-ui/react-popover", () => {
	const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
	return { Root: Wrapper, Trigger: Wrapper, Portal: Wrapper, Content: Wrapper, Close: Wrapper };
});

import { PsvControls } from "@/components/editor/location/PsvControls";

describe("PSV metadata details", () => {
	it.each([
		["14091134140630113614900", "qq_pano", "2014-06-30 11:36"],
		["09002000001407311630507506T", "baidu_pano", "2014-07-31 16:30"],
	])("shows minute capture time from %s and the footer address", (panoId, source, time) => {
		const panorama = {
			getMetadata: () => ({
				panoId,
				source,
				position: { lat: 39, lng: 116 },
				heading: 0,
				pitch: 0,
				northOffset: 0,
				address: "Provider address",
				altitude: 123,
			}),
			addListener: () => ({ remove() {} }),
		} as unknown as PsvPanoramaController;
		const view = mount(
			<PsvControls
				panorama={panorama}
				address="Footer address"
				isFullscreen={false}
				onFullscreen={() => {}}
				onReturnToSpawn={() => {}}
			/>,
		);
		const rows = Array.from(view.container.querySelectorAll("dl > div"));
		expect(
			rows.find((row) => row.querySelector("dt")?.textContent === "Address")?.querySelector("dd")
				?.textContent,
		).toBe("Footer address");
		expect(
			rows.find((row) => row.querySelector("dt")?.textContent === "Image date")?.querySelector("dd")
				?.textContent,
		).toBe(time);
		expect(rows.some((row) => row.querySelector("dt")?.textContent === "Altitude")).toBe(false);
	});
});
