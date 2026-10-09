import { storage as createPluginStorage } from "@/plugins/pluginStorage";

const PLUGIN_ID = "localguessr";
const RECENT_TAGS_KEY = "recentTags";
const MAX_RECENT = 20;

const storage = createPluginStorage(PLUGIN_ID);

function normalize(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const name = item
			.trim()
			.replace(/^\/+|\/+$/g, "")
			.replace(/\/{2,}/g, "/");
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(name);
		if (out.length >= MAX_RECENT) break;
	}
	return out;
}

/** Recently used tag names for LocalGuessr add-tag UI (independent of map tags). */
export function getRecentTags(): string[] {
	return normalize(storage.get(RECENT_TAGS_KEY, []));
}

/** Push a tag name to the front of the recent list (max 20). */
export function rememberRecentTag(name: string): string[] {
	const trimmed = name
		.trim()
		.replace(/^\/+|\/+$/g, "")
		.replace(/\/{2,}/g, "/");
	if (!trimmed) return getRecentTags();
	const lower = trimmed.toLowerCase();
	const next = [trimmed, ...getRecentTags().filter((n) => n.toLowerCase() !== lower)].slice(
		0,
		MAX_RECENT,
	);
	storage.set(RECENT_TAGS_KEY, next);
	return next;
}
