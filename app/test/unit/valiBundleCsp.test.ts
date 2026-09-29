import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ASSETS = join(__dirname, "../../public/valig/assets");
const CONF = join(__dirname, "../../src-tauri/tauri.conf.json");

describe("vendored Vali GUI bundle", () => {
	it("runs under a script-src without 'unsafe-eval'", () => {
		const csp: string = JSON.parse(readFileSync(CONF, "utf8")).app.security.csp;
		const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
		expect(scriptSrc).not.toContain("'unsafe-eval'");

		const scripts = readdirSync(ASSETS).filter((f) => f.endsWith(".js"));
		expect(scripts.length).toBeGreaterThan(0);
		const evaluating = scripts.filter((f) =>
			/\bnew Function\s*\(|\beval\s*\(/.test(readFileSync(join(ASSETS, f), "utf8")),
		);
		expect(evaluating).toEqual([]);
	});
});
