import { createPluginStorage } from "@/plugins/registry";
import type { ActiveGame } from "./GameState";

const PLUGIN_ID = "localguessr";
const ONGOING_KEY = "ongoingGames";

const storage = createPluginStorage(PLUGIN_ID);

export interface OngoingGameRecord {
	sessionId: string;
	mapId: string;
	mapName: string;
	startedAt: number;
	active: ActiveGame;
}

export function getOngoingGames(): OngoingGameRecord[] {
	const raw = storage.get<OngoingGameRecord[]>(ONGOING_KEY, []);
	return Array.isArray(raw) ? raw : [];
}

export function saveOngoingGame(record: OngoingGameRecord): void {
	const list = getOngoingGames().filter((g) => g.sessionId !== record.sessionId);
	list.unshift(record);
	storage.set(ONGOING_KEY, list.slice(0, 20));
}

export function deleteOngoingGame(sessionId: string): void {
	storage.set(
		ONGOING_KEY,
		getOngoingGames().filter((g) => g.sessionId !== sessionId),
	);
}

export function clearOngoingGames(): void {
	storage.set(ONGOING_KEY, []);
}

export function getOngoingGame(sessionId: string): OngoingGameRecord | null {
	return getOngoingGames().find((g) => g.sessionId === sessionId) ?? null;
}
