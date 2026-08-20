import { describe, expect, it } from "vitest";
import {
	INPUT_SENSITIVITY_MAX,
	INPUT_SENSITIVITY_MIN,
	normalizeInputSensitivity,
} from "@/store/settings";

describe("input sensitivity", () => {
	it("keeps valid multipliers unchanged", () => {
		expect(normalizeInputSensitivity(0.25)).toBe(0.25);
		expect(normalizeInputSensitivity(1)).toBe(1);
		expect(normalizeInputSensitivity(2.75)).toBe(2.75);
	});

	it("clamps out-of-range values and defaults invalid persisted data", () => {
		expect(normalizeInputSensitivity(0)).toBe(INPUT_SENSITIVITY_MIN);
		expect(normalizeInputSensitivity(99)).toBe(INPUT_SENSITIVITY_MAX);
		expect(normalizeInputSensitivity(Number.NaN)).toBe(1);
		expect(normalizeInputSensitivity("2")).toBe(1);
	});
});
