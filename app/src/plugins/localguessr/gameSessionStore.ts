import { createPluginStorage } from "@/plugins/registry";
import type { GameSession } from "./GameState";

const PLUGIN_ID = "localguessr";
const SESSIONS_KEY = "sessions";
const MAX_SESSIONS = 100;

const storage = createPluginStorage(PLUGIN_ID);

export function getSessions(): GameSession[] {
	const raw = storage.get<GameSession[]>(SESSIONS_KEY, []);
	if (!Array.isArray(raw)) return [];
	return raw;
}

export function getSessionById(id: string): GameSession | null {
	return getSessions().find((s) => s.id === id) ?? null;
}

export function saveSession(session: GameSession): void {
	const list = getSessions().filter((s) => s.id !== session.id);
	list.unshift(session);
	storage.set(SESSIONS_KEY, list.slice(0, MAX_SESSIONS));
}

export function deleteSession(id: string): void {
	storage.set(
		SESSIONS_KEY,
		getSessions().filter((s) => s.id !== id),
	);
}

export function clearSessions(): void {
	storage.set(SESSIONS_KEY, []);
}

export function getSessionsForMap(mapId: string): GameSession[] {
	return getSessions().filter((s) => s.mapId === mapId);
}
