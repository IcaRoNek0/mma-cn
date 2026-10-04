import { describe, it, expect } from "vitest";
import { cargoVersion } from "../../../plugins/check-sidecars.mjs";

describe("check-sidecars reads the package version", () => {
	it("takes the [package] version, not a later dependency table's", () => {
		const toml =
			'[package]\nname = "x"\nversion = "0.5.0"\n\n[dependencies.ort]\nversion = "2.0.0"\n';
		expect(cargoVersion(toml)).toBe("0.5.0");
	});

	it("ignores inline dependency versions", () => {
		expect(cargoVersion('[dependencies]\nserde = { version = "1" }\n')).toBe("");
	});
});
