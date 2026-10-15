// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { mount } from "./fixtures/harness";
import { PsvCompass } from "@/components/primitives/PsvCompass";
import type { PsvPanoramaController } from "@/lib/sv/panoSingleton";

describe("PSV compass", () => {
	it("follows panorama rotation and removes the listener on unmount", () => {
		let heading = 90;
		let update = () => {};
		const remove = vi.fn();
		const panorama = {
			getPov: () => ({ heading }),
			addListener: vi.fn((_event: string, listener: () => void) => {
				update = listener;
				return { remove };
			}),
		} as unknown as PsvPanoramaController;
		const view = mount(<PsvCompass panorama={panorama} className="gg-psv-compass" />);
		const compass = document.querySelector<HTMLElement>(".gg-psv-compass")!;
		expect(compass.style.getPropertyValue("--heading")).toBe("-90deg");
		heading = 270;
		act(() => update());
		expect(compass.style.getPropertyValue("--heading")).toBe("-270deg");
		view.unmount();
		expect(remove).toHaveBeenCalledOnce();
	});
});
