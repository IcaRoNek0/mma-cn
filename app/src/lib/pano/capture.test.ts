import { describe, expect, it } from "vitest";
import {
	parsePanoCaptureParts,
	parsePanoCaptureDate,
	parsePanoDate,
	parsePanoVehicle,
} from "./types";

describe("provider ID capture metadata", () => {
	it.each([
		["14091134140630113614900", "qq_pano", [2014, 6, 30, 11, 36, 14], "1409-134车"],
		["09002000001407311630507506T", "baidu_pano", [2014, 7, 31, 16, 30, 50], "090_0000_6T"],
	] as const)("decodes %s", (id, source, fields, vehicle) => {
		const date = parsePanoCaptureDate(id, source)!;
		expect([
			date.getFullYear(),
			date.getMonth() + 1,
			date.getDate(),
			date.getHours(),
			date.getMinutes(),
			date.getSeconds(),
		]).toEqual(fields);
		expect(parsePanoVehicle(id, source)).toBe(vehicle);
	});
	it.each([
		"invalid",
		"14091134140230113614900",
		"14091134141330113614900",
		"14091134140630243614900",
	])("rejects invalid capture time %s", (id) => {
		expect(parsePanoCaptureDate(id, "qq_pano")).toBeNull();
		expect(parsePanoDate(id, "qq_pano").getTime()).toBe(0);
	});
	it("keeps civil capture parts across host DST gaps", () => {
		const previous = process.env.TZ;
		process.env.TZ = "America/New_York";
		try {
			const parts = parsePanoCaptureParts("14091134220313023000900", "qq_pano")!;
			expect(parts).toEqual({ year: 2022, month: 3, day: 13, hour: 2, minute: 30, second: 0 });
			expect(
				`${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
			).toBe("2022-03-13 02:30");
		} finally {
			if (previous === undefined) delete process.env.TZ;
			else process.env.TZ = previous;
		}
	});
	it("extracts vehicle identity independently of capture time validity", () => {
		expect(parsePanoVehicle("14091134140230113614900", "qq_pano")).toBe("1409-134车");
		expect(parsePanoVehicle("09002000001402311630507506T", "baidu_pano")).toBe("090_0000_6T");
		expect(parsePanoVehicle("invalid", "qq_pano")).toBeNull();
	});
});
