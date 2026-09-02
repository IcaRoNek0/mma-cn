import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import {
	LocationFlag,
	VIRTUAL_FLAGS,
	createLocation,
	isImportPreview,
	isSeenPreview,
} from "@/types";
import { Tooltip } from "@/components/primitives/Tooltip";
import { Icon } from "@/components/primitives/Icon";
import { Button } from "@/components/primitives/Button";
import { mdiChevronLeft, mdiChevronRight } from "@mdi/js";
import { storedZoom } from "@/lib/sv/constants";
import type { Tag } from "@/bindings.gen";
import {
	useMapState,
	updateLocations,
	getMapState,
	removeLocations,
	addLocations,
	createTags,
	setActiveLocation,
	getVisibleTags,
} from "@/store/useMapStore";
import { sortTagsByMode, tagColorFor, appendTagName } from "@/lib/util/util";
import { TagPill, TagPillButton } from "@/components/primitives/TagPill";
import { displayTagName } from "@/store/selections";
import { ReviewBar } from "@/components/editor/location/ReviewBar";
import {
	useReviewSession,
	reviewNext,
	reviewPrev,
	reviewDelete,
	isAtStart,
} from "@/lib/review/review";
import {
	useSettings,
	useSetting,
	GEOCODE_PROVIDER_LABELS,
	type GeocodeProvider,
} from "@/store/settings";
import { useHotkey } from "@/lib/hooks/useHotkey";
import { useBinding } from "@/lib/util/hotkeys";
import { PluginLocationPanels } from "@/plugins/PluginPanels";
import { relativeTime } from "@/lib/util/format";
import { toast } from "@/lib/util/toast";
import { FullscreenMiniMap } from "@/components/editor/location/FullscreenMiniMap";
import { FullscreenTagBar } from "@/components/editor/location/FullscreenTagBar";
import { PsvControls } from "./PsvControls";
import { seenUpdateGeo } from "@/lib/seen/seen";
import { useReverseGeocode, type GeoDisplay } from "@/components/editor/location/useReverseGeocode";
import { usePanoViewer, setPanoAltitude } from "./PanoViewerContext";
import {
	usePanoFullscreen,
	togglePanoFullscreen,
	exitPanoFullscreen,
	exitFullscreenMap,
} from "./fullscreenModeState";
import { FullscreenMiniLocationPreview } from "./FullscreenMiniLocationPreview";
import { getViewportLockInfo } from "@/lib/sv/viewportLock";
import { useEvent } from "@/lib/events";
import {
	singletonPano,
	singletonDiv,
	getPanorama,
	applyLocationPanorama,
} from "@/lib/sv/panoSingleton";
import { PanoDatePicker } from "./PanoDatePicker";
import { useLocationHotkeys } from "./useLocationHotkeys";
import { t } from "@/lib/i18n";

/** Tags are staged by name, not ID, because some tags do not exist yet. */
function idsToNames(ids: number[]): string[] {
	const tags = getMapState().tags;
	return ids.map((id) => tags[id]?.name).filter((n): n is string => n != null);
}

/** Pending-tag chips + add form + suggestion pills. Memoized and self-subscribed
 *  so pano-switch churn in the parent doesn't re-render every pill. */
const TagEditor = memo(function TagEditor({
	pendingTags,
	onChangeTags,
	isImport,
}: {
	pendingTags: string[];
	onChangeTags: React.Dispatch<React.SetStateAction<string[]>>;
	isImport: boolean;
}) {
	const [tagInput, setTagInput] = useState("");
	const visibleTags = useMapState(getVisibleTags);
	const tagCounts = useMapState((s) => s.tagCounts);
	const tagSortMode = useSetting("tagSortMode");
	const suggestionLimit = useSetting("tagSuggestionLimit");

	const allTags = useMemo(
		() => sortTagsByMode(visibleTags, tagSortMode, tagCounts),
		[visibleTags, tagSortMode, tagCounts],
	);
	const suggestions = useMemo(() => {
		const pendingLower = new Set(pendingTags.map((n) => n.toLowerCase()));
		const available = allTags.filter((t) => !pendingLower.has(t.name.toLowerCase()));
		const cap = suggestionLimit || available.length;
		if (tagInput.trim()) {
			const lower = tagInput.toLowerCase();
			return available.filter((t) => t.name.toLowerCase().includes(lower)).slice(0, cap);
		}
		return available.slice(0, cap);
	}, [allTags, pendingTags, tagInput, suggestionLimit]);

	const addPendingTag = (name: string) =>
		onChangeTags((prev) => appendTagName(prev, name, getVisibleTags()));

	const handleAddTag = (e: React.FormEvent) => {
		e.preventDefault();
		const name = tagInput.trim();
		if (!name) return;
		addPendingTag(name);
		setTagInput("");
	};

	const handleRemoveTag = (name: string) => {
		onChangeTags((prev) => prev.filter((t) => t !== name));
	};

	const handleSuggestionClick = (t: Tag) => {
		addPendingTag(t.name);
		setTagInput("");
	};

	if (isImport) {
		return (
			<p>
				{t(
					"This location is still being imported and cannot be modified. Complete the import before\n\t\t\t\tmaking changes.",
				)}
			</p>
		);
	}

	return (
		<>
			<ul className="tag-list">
				{pendingTags.map((name) => (
					<TagPill
						as="li"
						key={name}
						small
						color={tagColorFor(name, allTags)}
						label={displayTagName(name)}
						button={<TagPillButton variant="delete" onClick={() => handleRemoveTag(name)} />}
					/>
				))}
				<li>
					<form className="form-add-tag" onSubmit={handleAddTag}>
						<button className="button form-add-tag__button" type="submit">
							+
						</button>
						<input
							className="form-add-tag__input"
							type="text"
							placeholder={t("Add a tag…")}
							value={tagInput}
							onChange={(e) => setTagInput(e.target.value)}
						/>
					</form>
				</li>
			</ul>
			{suggestions.length > 0 && (
				<div
					style={{
						paddingTop: "0.5rem",
						maxHeight: "40vh",
						overflowY: "auto",
						scrollbarWidth: "none",
					}}
				>
					<ol className="tag-list">
						{suggestions.map((t) => (
							<TagPill
								as="li"
								key={t.id}
								small
								color={t.color}
								label={displayTagName(t.name)}
								button={<TagPillButton variant="add" onClick={() => handleSuggestionClick(t)} />}
							/>
						))}
					</ol>
				</div>
			)}
		</>
	);
});

export function LocationPreview() {
	const location = useMapState((s) => s.activeLocation);
	const map = useMapState((s) => s.map);
	const reviewSession = useReviewSession();
	const isReviewMode = reviewSession !== null;
	const panoContainerRef = useRef<HTMLDivElement>(null);
	const fullscreenContainerRef = useRef<HTMLDivElement>(null);
	const {
		currentPano,
		setCurrentPano,
		panoDates,
		setPanoDates,
		panoReady,
		setPanoReady,
		selectedPanoId,
	} = usePanoViewer();
	const isFullscreen = usePanoFullscreen();
	const [pendingTags, setPendingTags] = useState<string[]>(() => idsToNames(location?.tags ?? []));
	const visibleTags = useMapState(getVisibleTags);
	const [panoGeo, setPanoGeo] = useState<GeoDisplay | null>(null);
	const geocodeProvider = useSetting("geocodeProvider");
	const geoResult = useReverseGeocode(
		location?.lat ?? 0,
		location?.lng ?? 0,
		panoGeo,
		location?.extra?.source,
	);
	const cancelTweenRef = useRef<(() => void) | null>(null);
	useEffect(() => {
		setPendingTags((prev) => {
			const next = idsToNames(location?.tags ?? []);
			return prev.length === next.length && prev.every((n, i) => n === next[i]) ? prev : next;
		});
		setPanoGeo(null);
	}, [location?.id]);
	useEffect(() => {
		if (geoResult) seenUpdateGeo(geoResult);
	}, [geoResult]);
	const appSettings = useSettings();

	const chipMode = appSettings.fullscreenMap && appSettings.showFullscreenMiniLocationPreview;
	const bottomTrayRef = useRef<HTMLDivElement>(null);
	// Written straight to the CSS var, not through state: the tray animates its height, so
	// this fires every frame and a re-render per frame would leave the chrome lagging behind.
	useLayoutEffect(() => {
		const root = fullscreenContainerRef.current;
		const el = bottomTrayRef.current;
		if (!root) return;
		if (!el) {
			root.style.setProperty("--fs-tray-h", "0px");
			return;
		}
		const obs = new ResizeObserver(() =>
			root.style.setProperty("--fs-tray-h", `${el.offsetHeight}px`),
		);
		obs.observe(el);
		return () => obs.disconnect();
	}, [isFullscreen, appSettings.showFullscreenTagbar, appSettings.showFullscreenDatePicker]);
	useEvent("viewport-lock:changed");
	const lockInfo = getViewportLockInfo();

	// Mount/unmount: move the persistent div in/out of the container.
	// useLayoutEffect so appendChild runs before paint.
	useLayoutEffect(() => {
		const container = panoContainerRef.current;
		if (!container) return;
		container.appendChild(singletonDiv);
		getPanorama().resize();
		return () => {
			if (container.contains(singletonDiv)) container.removeChild(singletonDiv);
		};
	}, [chipMode]);

	useEffect(() => {
		if (!location) return;
		let cancelled = false;
		const panorama = getPanorama();
		const syncMetadata = () => {
			if (cancelled) return;
			const metadata = panorama.getMetadata();
			const pos = panorama.getPosition();
			if (!metadata || !pos) return;
			setCurrentPano({ location: { pano: metadata.panoId, latLng: pos } });
			setPanoDates(metadata.timeline.map((entry) => ({ pano: entry.panoId, date: entry.date })));
			setPanoGeo({ address: metadata.address ?? "", countryCode: null });
			setPanoAltitude(metadata.altitude ?? 0);
			setPanoReady(true);
		};
		const panoListener = panorama.addListener("pano_changed", syncMetadata);
		setCurrentPano(null);
		setPanoDates([]);
		setPanoReady(false);
		applyLocationPanorama(location)
			.then(syncMetadata)
			.catch((error) => {
				if (!cancelled)
					toast(error instanceof Error ? error.message : t("Panorama failed to load"), 4000);
			});

		return () => {
			cancelled = true;
			panoListener.remove();
		};
	}, [location?.id]);

	// Reads the active location at call time to stay referentially stable
	// (it is a memo'd PanoDatePicker prop).
	const handleDateChange = useCallback((panoId: string | null) => {
		const loc = getMapState().activeLocation;
		if (!singletonPano || !loc) return;
		// updateLocation no-ops for staged (virtual) locations at the store level.
		if (panoId == null) {
			updateLocations([{ id: loc.id, patch: { flags: loc.flags & ~LocationFlag.LoadAsPanoId } }]);
			if (loc.panoId) singletonPano.setPano(loc.panoId);
		} else {
			updateLocations([{ id: loc.id, patch: { flags: loc.flags | LocationFlag.LoadAsPanoId } }]);
			singletonPano.setPano(panoId);
		}
	}, []);

	const handleSave = useCallback(async () => {
		if (!location || !singletonPano) return;
		// Staged (virtual) location: updateLocation no-ops, cursorId can't match a
		// negative id, so this falls through to setActiveLocation(null) = close.
		const pov = singletonPano.getPov();
		const zoom = storedZoom(singletonPano.getZoom());
		const pano = singletonPano.getPano();
		const pos = singletonPano.getPosition();

		const savedPanoId = selectedPanoId ?? pano ?? location.panoId;

		if (isSeenPreview(location)) {
			await addLocations([
				createLocation({
					lat: pos?.lat() ?? location.lat,
					lng: pos?.lng() ?? location.lng,
					heading: pov.heading,
					pitch: pov.pitch,
					zoom,
					panoId: savedPanoId,
					flags: location.flags & ~VIRTUAL_FLAGS, // keep LoadAsPanoId; drop the preview-kind bits
					tags: (await createTags(pendingTags)).map((t) => t.id),
				}),
			]);
			setActiveLocation(null);
			return;
		}

		const panoChanged = savedPanoId !== location.panoId;
		updateLocations([
			{
				id: location.id,
				patch: {
					heading: pov.heading,
					pitch: pov.pitch,
					zoom: zoom,
					panoId: savedPanoId,
					lat: pos?.lat() ?? location.lat,
					lng: pos?.lng() ?? location.lng,
					tags: (await createTags(pendingTags)).map((t) => t.id),
					extra: panoChanged ? {} : location.extra,
				},
			},
		]);
		if (isReviewMode && reviewSession?.cursorId === location.id) {
			reviewNext();
		} else {
			setActiveLocation(null);
		}
	}, [location, selectedPanoId, isReviewMode, reviewSession, pendingTags]);

	const handleClose = useCallback(() => {
		if (exitPanoFullscreen()) return;
		if (exitFullscreenMap()) return;
		if (isReviewMode) {
			reviewNext();
		} else {
			setActiveLocation(null);
		}
	}, [isReviewMode]);

	const handleDelete = useCallback(() => {
		if (!location) return;
		if (isReviewMode && reviewSession?.cursorId === location.id) {
			reviewDelete();
		} else {
			removeLocations(new Set([location.id]));
		}
	}, [location, isReviewMode, reviewSession]);

	// Reads the active location at call time so the callback stays referentially
	// stable (it is a memo'd PanoControls prop).
	const handleReturnToSpawn = useCallback(async () => {
		const loc = getMapState().activeLocation;
		if (!loc || !singletonPano) return;
		await applyLocationPanorama(loc);
		updateLocations([{ id: loc.id, patch: { flags: loc.flags & ~LocationFlag.LoadAsPanoId } }]);
	}, []);

	const handleFullscreen = useCallback(() => {
		if (location) togglePanoFullscreen();
	}, [location]);

	useHotkey(useBinding("toggleFullscreen"), handleFullscreen);

	useEffect(() => {
		if (!chipMode) return;
		const el = panoContainerRef.current;
		if (!el) return;
		const obs = new ResizeObserver(() => {
			if (singletonPano) singletonPano.resize();
		});
		obs.observe(el);
		return () => obs.disconnect();
	}, [chipMode]);

	useEffect(() => {
		if (singletonPano) singletonPano.resize();
	}, [appSettings.previewAspectRatio]);

	useEffect(() => {
		if (!singletonPano || appSettings.previewAspectRatio !== "free") return;
		const el = fullscreenContainerRef.current;
		if (!el) return;
		let timer: ReturnType<typeof setTimeout>;
		const obs = new ResizeObserver(() => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				if (singletonPano) singletonPano.resize();
			}, 150);
		});
		obs.observe(el);
		return () => {
			obs.disconnect();
			clearTimeout(timer);
		};
	}, [singletonPano, appSettings.previewAspectRatio]);

	useLocationHotkeys({
		location,
		isReviewMode,
		panoDates,
		selectedPanoId,
		currentPano,
		cancelTweenRef,
		pendingTags,
		setPendingTags,
		fullscreenContainerRef,
		panoContainerRef,
		handleSave,
		handleClose,
		handleDelete,
		handleReturnToSpawn,
		handleDateChange,
	});

	if (!location || !map) return null;

	if (chipMode) {
		return (
			<>
				<ReviewBar />
				<FullscreenMiniLocationPreview>
					<div ref={panoContainerRef} className="fullscreen-mini-location__pano" />
				</FullscreenMiniLocationPreview>
			</>
		);
	}

	return (
		<>
			<ReviewBar />
			<section
				className={`location-preview${appSettings.previewAspectRatio === "free" ? " free-resize" : ""}`}
			>
				<div
					className={`location-preview__panorama${isFullscreen ? " is-fullscreen" : ""}${appSettings.hidePanoUI ? " hide-pano-ui" : ""}`}
					ref={fullscreenContainerRef}
					style={
						isFullscreen
							? undefined
							: appSettings.previewAspectRatio === "free"
								? undefined
								: { aspectRatio: appSettings.previewAspectRatio }
					}
				>
					<div className="location-preview__embed">
						<div style={{ position: "absolute", inset: 0 }} ref={panoContainerRef} />
						{appSettings.defaultMovementMode === "nmpz" && (
							<div style={{ position: "absolute", inset: 0, zIndex: 1 }} />
						)}
						{panoReady && singletonPano && (
							<PsvControls
								panorama={singletonPano}
								isFullscreen={isFullscreen}
								onFullscreen={handleFullscreen}
								onReturnToSpawn={handleReturnToSpawn}
							/>
						)}
						{lockInfo && (
							<div className="viewport-lock-badge">
								{t("VIEWPORT LOCK")} h{" "}
								<span className="mono">{lockInfo.relHeading.toFixed(1)}</span> p{" "}
								<span className="mono">{lockInfo.relPitch.toFixed(1)}</span> z{" "}
								<span className="mono">{lockInfo.lockedZoom.toFixed(1)}</span>
							</div>
						)}
					</div>
					{isFullscreen && appSettings.showFullscreenMinimap && <FullscreenMiniMap />}
					{isFullscreen && (
						<div className="fullscreen-topbar">
							{appSettings.showFullscreenReviewBar && <ReviewBar />}
							{appSettings.showFullscreenGeocode &&
								(geoResult?.countryCode || geoResult?.address) && (
									<div className="fullscreen-geocode">
										<GeoSummary geo={geoResult} provider={geocodeProvider} />
									</div>
								)}
						</div>
					)}
					{isFullscreen && (
						<div className="fullscreen-bottom-tray" ref={bottomTrayRef}>
							{appSettings.showFullscreenTagbar && (
								<FullscreenTagBar
									pendingTags={pendingTags}
									onChangeTags={setPendingTags}
									tags={visibleTags}
								/>
							)}
						</div>
					)}
					{isFullscreen && appSettings.showFullscreenDatePicker && (
						<div className="fullscreen-date-picker">
							<PanoDatePicker onChange={handleDateChange} />
						</div>
					)}
				</div>
				<div className="location-preview__meta">
					<span className="location-preview__description">
						<GeoSummary geo={geoResult} provider={geocodeProvider} />
						{(geoResult?.address || geoResult?.countryCode) && (
							<span className="location-preview__timestamp-sep"> · </span>
						)}
						<span className="location-preview__timestamps">
							{t("Created")} {relativeTime(location.createdAt)}
							{location.modifiedAt != null && (
								<>
									{" · "}
									{t("Modified")} {relativeTime(location.modifiedAt)}
								</>
							)}
						</span>
					</span>
					<div className="location-preview__date">
						<PanoDatePicker onChange={handleDateChange} />
					</div>
					<div className="location-preview__actions">
						<Button variant="primary" onClick={handleSave} data-qa="location-save">
							{isSeenPreview(location) ? t("Add to map") : t("Save")}
						</Button>
						{isReviewMode ? (
							<div style={{ display: "flex", justifyContent: "space-around" }}>
								<Tooltip content={t("Go to previous location (Control+Left)")}>
									<Button
										onClick={() => reviewPrev()}
										disabled={reviewSession ? isAtStart(reviewSession) : true}
										aria-label={t("Go to previous location (Control+Left)")}
										data-qa="review-prev"
									>
										<Icon path={mdiChevronLeft} />
									</Button>
								</Tooltip>
								<Tooltip content={t("Go to next location (Control+Right)")}>
									<Button
										onClick={handleClose}
										aria-label={t("Go to next location (Control+Right)")}
										data-qa="review-next"
									>
										<Icon path={mdiChevronRight} />
									</Button>
								</Tooltip>
							</div>
						) : (
							<Button onClick={handleClose} data-qa="location-close">
								{t("Close")}
							</Button>
						)}
						<Button variant="destructive" onClick={handleDelete} data-qa="location-delete">
							{t("Delete")}
						</Button>
					</div>
					<div className="location-preview__tags">
						<TagEditor
							pendingTags={pendingTags}
							onChangeTags={setPendingTags}
							isImport={isImportPreview(location)}
						/>
					</div>
					<PluginLocationPanels />
				</div>
			</section>
		</>
	);
}

function GeoSummary({ geo, provider }: { geo: GeoDisplay | null; provider: GeocodeProvider }) {
	if (!geo?.countryCode && !geo?.address) return null;
	return (
		<>
			{geo.countryCode && (
				<Tooltip content={t(GEOCODE_PROVIDER_LABELS[provider])}>
					<span>
						<img
							height={15}
							width={20}
							src={`/flags/${geo.countryCode.toUpperCase()}.svg`}
							alt={geo.countryCode}
							style={{ borderRadius: "2px", verticalAlign: "middle" }}
						/>
					</span>
				</Tooltip>
			)}
			{geo.countryCode && geo.address && " "}
			{geo.address && <span>{geo.address}</span>}
		</>
	);
}
