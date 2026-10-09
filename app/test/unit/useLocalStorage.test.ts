// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getLocal, setLocal, persisted } from "@/lib/hooks/useLocalStorage";
import { MIGRATIONS, type StoredMigration } from "@/store/migrations";

/** Register a migration for the duration of one test; the registry is module-level. */
function withMigration(m: StoredMigration, run: () => void) {
	MIGRATIONS.push(m);
	try {
		run();
	} finally {
		MIGRATIONS.splice(MIGRATIONS.indexOf(m), 1);
	}
}

describe("useLocalStorage shared store", () => {
	beforeEach(() => localStorage.clear());

	it("getLocal returns the default for a missing key", () => {
		expect(getLocal("missing-1", 42)).toBe(42);
		expect(getLocal("missing-2", [])).toEqual([]);
	});

	it("setLocal updates the in-memory authority that getLocal reads", () => {
		setLocal("k-write", [{ name: "a" }]);
		expect(getLocal("k-write", [])).toEqual([{ name: "a" }]);
	});

	it("setLocal persists JSON to localStorage", () => {
		setLocal("k-persist", { x: 1 });
		expect(JSON.parse(localStorage.getItem("k-persist")!)).toEqual({ x: 1 });
	});

	it("all consumers of a key share one authority", () => {
		setLocal("k-shared", "first");
		const a = getLocal("k-shared", "default");
		setLocal("k-shared", "second");
		const b = getLocal("k-shared", "default");
		expect(a).toBe("first");
		expect(b).toBe("second");
	});

	it("rehydrates from a pre-existing localStorage value", () => {
		localStorage.setItem("k-rehydrate", JSON.stringify(["x", "y"]));
		expect(getLocal("k-rehydrate", [])).toEqual(["x", "y"]);
	});

	it("merges defaults under a stored object so new keys resolve", () => {
		localStorage.setItem("k-merge", JSON.stringify({ a: 1 }));
		expect(getLocal("k-merge", { a: 0, b: 2 })).toEqual({ a: 1, b: 2 });
	});

	it("runs migrations on the stored blob before defaults merge in", () => {
		localStorage.setItem("k-mig", JSON.stringify({ color: { r: 1, g: 2, b: 3 } }));
		withMigration(
			{
				since: "0.0.0",
				key: "k-mig",
				describe: "color object -> tuple",
				apply: (v) => {
					const c = v.color as { r: number; g: number; b: number };
					if (c && !Array.isArray(c)) v.color = [c.r, c.g, c.b];
				},
			},
			() => {
				expect(getLocal(persisted("k-mig", { color: [0, 0, 0], size: 5 }))).toEqual({
					color: [1, 2, 3],
					size: 5,
				});
			},
		);
	});

	it("migrations are idempotent across repeated reads", () => {
		localStorage.setItem("k-idem", JSON.stringify({ n: "7" }));
		withMigration(
			{
				since: "0.0.0",
				key: "k-idem",
				describe: "n string -> number",
				apply: (v) => {
					if (typeof v.n === "string") v.n = Number(v.n);
				},
			},
			() => {
				const store = persisted("k-idem", { n: 0 });
				expect(getLocal(store)).toEqual({ n: 7 });
				setLocal(store, getLocal(store));
				expect(getLocal(store)).toEqual({ n: 7 });
			},
		);
	});

	it("a migration can rename a key", () => {
		localStorage.setItem("k-rename", JSON.stringify({ old: "carried" }));
		withMigration(
			{
				since: "0.0.0",
				key: "k-rename",
				describe: "old -> next",
				apply: (v) => {
					if ("old" in v) {
						v.next = v.old;
						delete v.old;
					}
				},
			},
			() => {
				expect(getLocal(persisted("k-rename", { next: "default" }))).toEqual({ next: "carried" });
			},
		);
	});

	it("leaves a store with no migrations untouched", () => {
		localStorage.setItem("k-nomig", JSON.stringify({ a: 1 }));
		expect(getLocal(persisted("k-nomig", { a: 0, b: 2 }))).toEqual({ a: 1, b: 2 });
	});

	it("writes the migrated shape back to disk, without baking defaults in", () => {
		localStorage.setItem("k-wb", JSON.stringify({ color: { r: 1, g: 2, b: 3 } }));
		withMigration(
			{
				since: "0.0.0",
				key: "k-wb",
				describe: "color object -> tuple",
				apply: (v) => {
					const c = v.color as { r: number; g: number; b: number };
					if (c && !Array.isArray(c)) v.color = [c.r, c.g, c.b];
				},
			},
			() => {
				getLocal(persisted("k-wb", { color: [0, 0, 0], size: 5 }));
				// Disk holds the new shape (safe to prune the migration) but not `size` --
				// absent keys keep tracking whatever the default is at read time.
				expect(JSON.parse(localStorage.getItem("k-wb")!)).toEqual({ color: [1, 2, 3] });
			},
		);
	});

	it("does not rewrite disk when migrations change nothing", () => {
		const raw = JSON.stringify({ n: 7 });
		localStorage.setItem("k-noop", raw);
		withMigration(
			{
				since: "0.0.0",
				key: "k-noop",
				describe: "n string -> number",
				apply: (v) => {
					if (typeof v.n === "string") v.n = Number(v.n);
				},
			},
			() => {
				getLocal(persisted("k-noop", { n: 0 }));
				expect(localStorage.getItem("k-noop")).toBe(raw);
			},
		);
	});
});
