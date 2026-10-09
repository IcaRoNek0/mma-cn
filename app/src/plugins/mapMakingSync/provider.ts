import { mapMakingApp } from "@/components/primitives/Icon";
import { isAuthPrefixed, type SyncProvider } from "@/lib/sync/provider";

export const PLUGIN_ID = "map-making-sync";

export const mapMakingProvider: SyncProvider = {
	id: "map-making.app",
	label: "map-making.app",
	icon: mapMakingApp,

	isAuthError: isAuthPrefixed,

	remoteMapUrl: (id) => `https://map-making.app/maps/${id}`,
};
