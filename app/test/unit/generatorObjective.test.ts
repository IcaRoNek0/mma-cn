import { describe, expect, it } from "vitest";
import { buildGenerationPlan, normalizeGeneratorSettings } from "@/plugins/generator/engine/types";

describe("generator objectives", () => {
	it("loads settings saved before objectives as a count run", () => {
		const settings = normalizeGeneratorSettings({
			defaultTarget: 75,
			samplingMode: "grid",
		});

		expect(settings.objective).toBe("count");
		expect(settings.defaultTarget).toBe(75);
		expect(buildGenerationPlan(settings)).toEqual({
			objective: "count",
			sampling: { mode: "grid" },
		});
	});

	it("makes spacing a finite Coverage plan regardless of the saved count sampler", () => {
		const settings = normalizeGeneratorSettings({
			objective: "spacing",
			spacing: 1_000,
			samplingMode: "random",
		});

		expect(buildGenerationPlan(settings)).toEqual({
			objective: "spacing",
			sampling: { mode: "blueline", spacing: 1_000 },
		});
	});

	it("repairs an invalid spacing distance", () => {
		expect(normalizeGeneratorSettings({ objective: "spacing", spacing: 0 }).spacing).toBe(1_000);
		expect(normalizeGeneratorSettings({ objective: "spacing", spacing: 1 }).spacing).toBe(1_000);
		expect(normalizeGeneratorSettings({ objective: "spacing", spacing: Infinity }).spacing).toBe(
			1_000,
		);
		expect(
			buildGenerationPlan({
				...normalizeGeneratorSettings({ objective: "spacing" }),
				spacing: 0,
			}),
		).toEqual({
			objective: "spacing",
			sampling: { mode: "blueline", spacing: 1_000 },
		});
	});
});
