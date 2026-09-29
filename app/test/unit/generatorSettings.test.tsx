// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@/store/settings", () => ({
	getSettings: () => ({ units: "metric" }),
	useSetting: () => "metric",
}));

import { DEFAULT_SETTINGS } from "@/plugins/generator/engine/types";
import { SettingsPanel } from "@/plugins/generator/ui/SettingsPanel";
import { mount } from "./fixtures/harness";

function render(objective: "count" | "spacing", running = false) {
	return mount(
		<SettingsPanel
			settings={{ ...DEFAULT_SETTINGS, objective }}
			onChange={() => {}}
			running={running}
		/>,
	);
}

describe("generator objective settings", () => {
	it("shows sampling allocation only for Count and distance only for Spacing", () => {
		const count = render("count");
		expect(count.container.textContent).toContain("Goal");
		expect(count.container.textContent).toContain("Sampling");
		expect(count.container.textContent).not.toContain("Spacing (");

		const spacing = render("spacing");
		expect(spacing.container.textContent).toContain("Spacing (");
		expect(spacing.container.textContent).toContain("Spacing defines the probe plan.");
		expect(spacing.container.textContent).not.toContain("Sampling");
	});

	it("freezes plan-defining controls while generation runs", () => {
		const view = render("spacing", true);
		const count = [...view.container.querySelectorAll("button")].find(
			(button) => button.textContent === "Count",
		);
		const spacing = [...view.container.querySelectorAll("input")].find((input) =>
			input.closest("label")?.textContent?.startsWith("Spacing"),
		);

		expect(count?.disabled).toBe(true);
		expect(spacing?.disabled).toBe(true);
	});
});
