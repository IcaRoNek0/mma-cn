import { describe, it, expect } from "vitest";
import { modalTop } from "@/components/primitives/Dialog";

describe("a modal's top edge", () => {
	it("opens centred", () => {
		expect(modalTop(null, 400, 1000)).toBe(300);
	});

	it("stays put while the modal grows, so growth runs downward", () => {
		expect(modalTop(300, 500, 1000)).toBe(300);
	});

	it("settles back to centre when the modal shrinks", () => {
		expect(modalTop(300, 200, 1000)).toBe(400);
	});

	it("never sits above centre after growing and shrinking back", () => {
		expect(modalTop(150, 400, 1000)).toBe(300);
	});

	it("returns to where it opened when it shrinks and grows back", () => {
		const opened = modalTop(null, 400, 1000);
		expect(modalTop(opened, 200, 1000)).toBe(400);
		expect(modalTop(opened, 400, 1000)).toBe(opened);
	});

	it("moves up only as far as keeping the bottom on screen needs", () => {
		expect(modalTop(300, 800, 1000)).toBe(150);
	});

	it("never climbs past the top margin", () => {
		expect(modalTop(300, 990, 1000)).toBe(50);
	});
});
