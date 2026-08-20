import { emit, useEventValue } from "@/lib/events";
import { log } from "@/lib/util/log";
import { getSettings } from "@/store/settings";
import { saveSession } from "@/store/session";
import { openMapWindowIds } from "@/lib/window";

type Phase = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";

interface UpdateState {
	phase: Phase;
	version: string | null;
	notes: string;
	percent: number;
	error: string | null;
	dismissed: boolean;
}

let state: UpdateState = {
	phase: "idle",
	version: null,
	notes: "",
	percent: 0,
	error: null,
	dismissed: false,
};

function set(patch: Partial<UpdateState>) {
	state = { ...state, ...patch };
	emit("update:changed");
}

const DISMISS_KEY = "mma-update-dismissed-version";

export async function checkForUpdate() {
	// MMA-CN releases are distributed directly and must not consume upstream MMA updates.
	set({ phase: "up-to-date", version: null, error: null });
}

// Relaunches bypass the normal close flow, so persist the current session first.
async function snapshotSessionForRestart() {
	if (!getSettings().restoreSession) return;
	try {
		const ids = await openMapWindowIds();
		saveSession(ids);
		log.info(`[session] saved ${ids.length} open map(s) before restart: ${ids.join(", ")}`);
	} catch (e) {
		log.warn("[session] snapshot before restart failed:", e);
	}
}

export function installUpdate() {
	// No updater endpoint is configured for direct MMA-CN distributions.
}

export async function relaunchApp() {
	await snapshotSessionForRestart();
	const { relaunch } = await import("@tauri-apps/plugin-process");
	await relaunch();
}

export function dismissUpdate() {
	if (!state.version) return;
	localStorage.setItem(DISMISS_KEY, state.version);
	set({ dismissed: true });
}

export function useUpdateState(): UpdateState {
	return useEventValue("update:changed", () => state);
}
