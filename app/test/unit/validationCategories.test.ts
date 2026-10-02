import { describe, it, expect } from "vitest";
import { ValidationFlag } from "@/bindings.consts";
import {
	STANDARD_VALIDATION_CATEGORIES,
	VALIDATION_CATEGORIES,
	type ValidationAnswer,
} from "@/lib/sv/validationCategories";

const matching = (answer: ValidationAnswer) =>
	VALIDATION_CATEGORIES.filter((c) => c.test(answer)).map((c) => c.key);

describe("validation categories", () => {
	it("keys are unique", () => {
		const keys = VALIDATION_CATEGORIES.map((c) => c.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("ask for one group per pre-flag validation state by default", () => {
		expect(STANDARD_VALIDATION_CATEGORIES).toEqual([
			"valid",
			"updateAvailable",
			"updateApplied",
			"notFound",
			"panoIdBroke",
			"unofficial",
			"goodcamAvailable",
		]);
	});

	it("split newer coverage by whether the location is pinned", () => {
		const newer = ValidationFlag.Newer;
		expect(matching({ flags: newer, pinned: true })).toEqual(["updateAvailable", "newer"]);
		expect(matching({ flags: newer, pinned: false })).toEqual(["updateApplied", "newer"]);
	});

	it("count a location as valid only when it has no findings", () => {
		expect(matching({ flags: ValidationFlag.None, pinned: true })).toEqual(["valid"]);
		expect(matching({ flags: ValidationFlag.DefaultStale, pinned: false })).not.toContain("valid");
	});

	it("reach every flag whether or not the location is pinned", () => {
		for (const flag of Object.values(ValidationFlag)) {
			for (const pinned of [true, false]) {
				expect(matching({ flags: flag, pinned }).length, `${flag} ${pinned}`).toBeGreaterThan(0);
			}
		}
	});
});
