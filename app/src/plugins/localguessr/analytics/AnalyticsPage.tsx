import { EmptyState } from "@/components/primitives/EmptyState";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/primitives/Button";
import { Checkbox } from "@/components/primitives/Checkbox";

import { useT, type MessageKey, type MessageParams } from "@/lib/i18n";
import { mdiChartBoxOutline, mdiChevronDown } from "@mdi/js";
import { computeAnalytics } from "./analyticsStore";
import { clearSessions, deleteSession } from "../gameSessionStore";
import { formatDistance } from "../ScoreUtils";
import { countryFlagHtml, type GameSession } from "../GameState";

type TrendRange = "all" | "year" | "month" | "week" | "today";

function trendRangeCutoff(range: TrendRange, now = Date.now()): number | null {
	if (range === "all") return null;
	if (range === "today") {
		const d = new Date(now);
		d.setHours(0, 0, 0, 0);
		return d.getTime();
	}
	const dayMs = 24 * 60 * 60 * 1000;
	if (range === "week") return now - 7 * dayMs;
	if (range === "month") return now - 30 * dayMs;
	return now - 365 * dayMs;
}

function ScoreTrendChart({
	points,
	t,
}: {
	points: { at: number; score: number; avgScore: number; totalScore: number; mapName: string }[];
	t: (key: MessageKey, params?: MessageParams) => string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 500, h: 220 });

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => {
			setSize({ w: el.clientWidth || 500, h: el.clientHeight || 220 });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// ── hover interaction ────────────────────────────────────────
	const [hoverIdx, setHoverIdx] = useState<number | null>(null);
	const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const handleMouseEnter = useCallback((i: number) => {
		if (leaveTimer.current) {
			clearTimeout(leaveTimer.current);
			leaveTimer.current = null;
		}
		setHoverIdx(i);
	}, []);
	const handleMouseLeave = useCallback(() => {
		leaveTimer.current = setTimeout(() => setHoverIdx(null), 200);
	}, []);
	useEffect(
		() => () => {
			if (leaveTimer.current) clearTimeout(leaveTimer.current);
		},
		[],
	);

	if (points.length < 2) {
		return <div className="gg-analytics__chart-empty">—</div>;
	}

	// ── geometry ──────────────────────────────────────────────────
	const { w, h } = size;
	const padL = 54,
		padR = 24,
		padT = 18,
		padB = 32;
	const pw = w - padL - padR,
		ph = h - padT - padB;

	const maxScore = Math.max(...points.map((p) => p.score), 1);
	const round = (v: number, step: number) => Math.ceil(v / step) * step;
	const yStep =
		maxScore <= 2000 ? 500 : maxScore <= 10000 ? 2000 : maxScore <= 25000 ? 5000 : 10000;
	const yMax = round(maxScore, yStep);

	const spanMs = points[points.length - 1].at - points[0].at || 3600000; // fallback 1 hour

	// Time formatter based on total span
	const fmtTime = (ts: number): string => {
		const d = new Date(ts);
		if (spanMs < 2 * 3600 * 1000) {
			// < 2 hours: HH:MM
			return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		}
		if (spanMs < 2 * 24 * 3600 * 1000) {
			// < 2 days: MM/DD HH:MM
			return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		}
		if (spanMs < 60 * 24 * 3600 * 1000) {
			// < 2 months: MM/DD
			return `${d.getMonth() + 1}/${d.getDate()}`;
		}
		// >= 2 months: YYYY/MM
		return `${d.getFullYear()}/${d.getMonth() + 1}`;
	};

	const dataPts = points.map((p) => ({
		x: padL + ((p.at - points[0].at) / spanMs) * pw,
		y: padT + ph - (p.score / yMax) * ph,
		score: p.score,
		avgScore: p.avgScore,
		at: p.at,
		map: p.mapName,
		totalScore: p.totalScore,
	}));

	// ── y‑ticks ───────────────────────────────────────────────────
	const yTicks: { y: number; label: string }[] = [];
	const steps = Math.max(2, Math.min(6, Math.floor(yMax / yStep)));
	for (let i = 0; i <= steps; i++) {
		const val = Math.round((yMax / steps) * i);
		if (val === 0 && i > 0) continue;
		yTicks.push({ y: padT + ph - (val / yMax) * ph, label: val.toLocaleString() });
	}

	// ── x‑ticks evenly spaced in time ────────────────────────────
	const xTickCount = Math.min(6, Math.max(2, points.length));
	const xTicks: { x: number; label: string }[] = [];
	for (let i = 0; i < xTickCount; i++) {
		const ts = points[0].at + (spanMs * i) / (xTickCount - 1);
		const x = padL + (i / (xTickCount - 1)) * pw;
		xTicks.push({ x, label: fmtTime(ts) });
	}

	// ── smooth path (monotone cubic — no overshoot past data extrema) ──
	const monotonePath = (pts: { x: number; y: number }[]) => {
		const n = pts.length;
		if (n < 2) return "";
		if (n === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;

		const dx: number[] = [];
		const dy: number[] = [];
		const secant: number[] = [];
		for (let i = 0; i < n - 1; i++) {
			dx[i] = pts[i + 1].x - pts[i].x;
			dy[i] = pts[i + 1].y - pts[i].y;
			secant[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;
		}

		const slope = new Array<number>(n);
		slope[0] = secant[0];
		slope[n - 1] = secant[n - 2];
		for (let i = 1; i < n - 1; i++) {
			slope[i] = secant[i - 1] * secant[i] <= 0 ? 0 : (secant[i - 1] + secant[i]) / 2;
		}
		// Fritsch–Carlson limiter — keeps the spline monotone in y between samples.
		for (let i = 0; i < n - 1; i++) {
			if (Math.abs(secant[i]) < 1e-12) {
				slope[i] = 0;
				slope[i + 1] = 0;
				continue;
			}
			const a = slope[i] / secant[i];
			const b = slope[i + 1] / secant[i];
			const s = a * a + b * b;
			if (s > 9) {
				const t = 3 / Math.sqrt(s);
				slope[i] = t * a * secant[i];
				slope[i + 1] = t * b * secant[i];
			}
		}

		let d = `M${pts[0].x},${pts[0].y}`;
		for (let i = 0; i < n - 1; i++) {
			const p0 = pts[i];
			const p1 = pts[i + 1];
			const h = dx[i];
			d += ` C${p0.x + h / 3},${p0.y + (slope[i] * h) / 3} ${p1.x - h / 3},${p1.y - (slope[i + 1] * h) / 3} ${p1.x},${p1.y}`;
		}
		return d;
	};
	const pathD = monotonePath(dataPts);
	const fillD = `${pathD} L${dataPts[dataPts.length - 1].x},${padT + ph} L${dataPts[0].x},${padT + ph} Z`;

	// ── hover tooltip position ───────────────────────────────────
	const hover = hoverIdx != null ? dataPts[hoverIdx] : null;
	const tooltipX = hover ? Math.min(Math.max(hover.x, 90), w - 90) : 0;
	const tooltipY = hover ? Math.max(4, hover.y - 56) : 0;

	return (
		<div ref={containerRef} className="gg-analytics__chart-wrap">
			<svg
				className="gg-analytics__chart"
				viewBox={`0 0 ${w} ${h}`}
				preserveAspectRatio="xMidYMid meet"
			>
				<defs>
					<linearGradient id="gg-chart-fill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="var(--gg-accent)" stopOpacity="0.25" />
						<stop offset="100%" stopColor="var(--gg-accent)" stopOpacity="0.02" />
					</linearGradient>
					<linearGradient id="gg-chart-stroke" x1="0" y1="0" x2="1" y2="0">
						<stop offset="0%" stopColor="var(--gg-accent)" stopOpacity="0.7" />
						<stop offset="100%" stopColor="var(--gg-accent-purple)" stopOpacity="1" />
					</linearGradient>
					<clipPath id="gg-chart-plot-clip">
						<rect x={padL} y={padT} width={pw} height={ph} />
					</clipPath>
				</defs>

				{/* grid lines */}
				{yTicks.map((tk) => (
					<line
						key={`g-${tk.y}`}
						x1={padL}
						y1={tk.y}
						x2={padL + pw}
						y2={tk.y}
						stroke="var(--gg-border)"
						strokeWidth="0.8"
						strokeDasharray="5,5"
					/>
				))}

				<g clipPath="url(#gg-chart-plot-clip)">
					{/* area fill under line */}
					<path d={fillD} fill="url(#gg-chart-fill)" />

					{/* line */}
					<path
						d={pathD}
						fill="none"
						stroke="url(#gg-chart-stroke)"
						strokeWidth="2.2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</g>

				{/* data dots */}
				{dataPts.map((p, i) => {
					const active = i === hoverIdx;
					return (
						<circle
							key={`pt-${i}`}
							cx={p.x}
							cy={p.y}
							r={active ? 5.5 : 3.5}
							fill={active ? "var(--gg-accent)" : "var(--gg-bg)"}
							stroke={active ? "var(--gg-accent)" : "var(--gg-accent)"}
							strokeWidth={active ? 2 : 1.6}
							style={{ cursor: "pointer", transition: "r 120ms, fill 120ms" }}
							onMouseEnter={() => handleMouseEnter(i)}
							onMouseLeave={handleMouseLeave}
						/>
					);
				})}

				{/* hover crosshair */}
				{hover && (
					<>
						<line
							x1={hover.x}
							y1={padT}
							x2={hover.x}
							y2={padT + ph}
							stroke="var(--gg-text)"
							strokeWidth="0.6"
							strokeDasharray="3,3"
							opacity="0.3"
						/>
						<line
							x1={padL}
							y1={hover.y}
							x2={padL + pw}
							y2={hover.y}
							stroke="var(--gg-text)"
							strokeWidth="0.6"
							strokeDasharray="3,3"
							opacity="0.3"
						/>
					</>
				)}

				{/* y‑axis labels */}
				{yTicks.map((tk) => (
					<text
						key={`yl-${tk.y}`}
						x={padL - 8}
						y={tk.y + 4}
						textAnchor="end"
						fontSize="10"
						fontFamily="var(--gg-font)"
						fill="var(--gg-muted)"
					>
						{tk.label}
					</text>
				))}

				{/* x‑axis labels */}
				{xTicks.map((tk, i) => (
					<text
						key={`xl-${i}`}
						x={tk.x}
						y={h - 6}
						textAnchor="middle"
						fontSize="10"
						fontFamily="var(--gg-font)"
						fill="var(--gg-muted)"
					>
						{tk.label}
					</text>
				))}

				{/* axis titles */}
				<text
					x={10}
					y={padT + ph / 2}
					textAnchor="middle"
					fontSize="10"
					fontFamily="var(--gg-font)"
					fill="var(--gg-muted)"
					opacity="0.55"
					transform={`rotate(-90, 10, ${padT + ph / 2})`}
				>
					{t("Avg Score")}
				</text>

				{/* hover tooltip */}
				{hover && (
					<g>
						<rect
							x={tooltipX - 110}
							y={tooltipY}
							width="220"
							height="42"
							rx="6"
							fill="var(--gg-panel)"
							stroke="var(--gg-border)"
							strokeWidth="0.8"
						/>
						<text
							x={tooltipX}
							y={tooltipY + 16}
							textAnchor="middle"
							fontSize="12"
							fontFamily="var(--gg-font)"
							fill="var(--gg-accent)"
							fontWeight={600}
						>
							{hover.score.toLocaleString()} {t("rolling ·")} {hover.avgScore.toLocaleString()}
							/round
						</text>
						<text
							x={tooltipX}
							y={tooltipY + 32}
							textAnchor="middle"
							fontSize="9"
							fontFamily="var(--gg-font)"
							fill="var(--gg-muted)"
						>
							{hover.map} · {new Date(hover.at).toLocaleString()}
						</text>
					</g>
				)}
			</svg>
		</div>
	);
}

// ── filter dropdown ────────────────────────────────────────────
function FilterDropdown({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (v: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	const selected = options.find((o) => o.value === value);
	const display = value === "__all__" ? label : (selected?.label ?? value);

	return (
		<div className="gg-trend-filter" ref={ref}>
			<button
				type="button"
				className={`gg-trend-filter__btn ${open ? "gg-trend-filter__btn--open" : ""}`}
				onClick={() => setOpen(!open)}
			>
				<span className="gg-trend-filter__display">{display}</span>
				<svg className="gg-trend-filter__chevron" viewBox="0 0 24 24" width="14" height="14">
					<path fill="currentColor" d={mdiChevronDown} />
				</svg>
			</button>
			{open && (
				<div className="gg-trend-filter__menu">
					{options.map((o) => (
						<button
							key={o.value}
							type="button"
							className={`gg-trend-filter__opt ${o.value === value ? "gg-trend-filter__opt--active" : ""}`}
							onClick={() => {
								onChange(o.value);
								setOpen(false);
							}}
						>
							{o.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function accuracyClass(pct: number): string {
	if (pct >= 90) return "gg-acc--green";
	if (pct >= 75) return "gg-acc--yellow";
	if (pct >= 50) return "gg-acc--orange";
	return "gg-acc--red";
}

function ReplayEntry({
	session,
	onReplay,
	onDelete,
}: {
	session: GameSession;
	onReplay: () => void;
	onDelete: () => void;
}) {
	const { t } = useT();
	return (
		<div className="gg-analytics__row gg-analytics__row">
			<span className="gg-analytics__name">{session.mapName}</span>
			<span className="gg-analytics__meta">
				{session.totalScore.toLocaleString()} · {session.config.movementMode} ·{" "}
				{session.rounds.length}r
				{session.rounds[0]?.distanceMeters != null
					? ` · ${formatDistance(session.rounds[0].distanceMeters)}`
					: ""}
			</span>
			<div className="gg-analytics__row-actions">
				<button type="button" className="gg-analytics__replay" onClick={onReplay}>
					{t("Replay")}
				</button>
				<button type="button" className="gg-analytics__delete" onClick={onDelete}>
					×
				</button>
			</div>
		</div>
	);
}

export function AnalyticsPage({
	mapId,
	onBack,
	onReplaySession,
}: {
	mapId?: string | null;
	onBack: () => void;
	onReplaySession?: (session: GameSession) => void;
}) {
	const { t } = useT();
	const [filterMap, setFilterMap] = useState(false);
	const [version, setVersion] = useState(0);
	const data = useMemo(
		() => computeAnalytics(filterMap ? mapId : null),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- manual recompute trigger after delete/clear
		[filterMap, mapId, version],
	);

	// ── score‑trend filters ──────────────────────────────────────
	const [trendFilterRange, setTrendFilterRange] = useState<TrendRange>("all");
	const [trendFilterCountry, setTrendFilterCountry] = useState<string>("__all__");
	const [trendFilterMap, setTrendFilterMap] = useState<string>("__all__");
	const [trendFilterProvider, setTrendFilterProvider] = useState<string>("__all__");
	const [trendFilterMode, setTrendFilterMode] = useState<string>("__all__");

	// Derive filter options from trend points
	const allCountryCodes = useMemo(() => {
		const set = new Set<string>();
		for (const p of data.scoreTrend) {
			for (const c of p.countryCodes) set.add(c);
		}
		return [...set].sort();
	}, [data.scoreTrend]);

	const uniqueMapIds = useMemo(() => {
		const seen = new Set<string>();
		const result: { id: string; name: string }[] = [];
		for (const p of data.scoreTrend) {
			if (!seen.has(p.mapId)) {
				seen.add(p.mapId);
				result.push({ id: p.mapId, name: p.mapName });
			}
		}
		return result;
	}, [data.scoreTrend]);

	const allProviders = useMemo(() => {
		const set = new Set<string>();
		for (const p of data.scoreTrend) {
			for (const pr of p.providers) set.add(pr);
		}
		return [...set].sort();
	}, [data.scoreTrend]);

	const uniqueModes = useMemo(() => {
		const set = new Set<string>();
		for (const p of data.scoreTrend) set.add(p.mode);
		return [...set];
	}, [data.scoreTrend]);

	const rangeOptions = useMemo(
		() => [
			{ value: "all", label: t("All time") },
			{ value: "year", label: t("Past year") },
			{ value: "month", label: t("Past month") },
			{ value: "week", label: t("Past week") },
			{ value: "today", label: t("Today") },
		],
		[t],
	);

	// Build option lists for filter dropdowns
	const countryOptions = useMemo(
		() => [
			{ value: "__all__", label: `${t("All")} ${t("Country")}` },
			...allCountryCodes.map((code) => ({ value: code, label: code })),
		],
		[allCountryCodes, t],
	);

	const mapOptions = useMemo(
		() => [
			{ value: "__all__", label: `${t("All")} ${t("Map")}` },
			...uniqueMapIds.map((m) => ({ value: m.id, label: m.name })),
		],
		[uniqueMapIds, t],
	);

	const providerOptions = useMemo(
		() => [
			{ value: "__all__", label: `${t("All")} ${t("Provider")}` },
			...allProviders.map((p) => ({ value: p, label: p })),
		],
		[allProviders, t],
	);

	const modeOptions = useMemo(
		() => [
			{ value: "__all__", label: `${t("All")} ${t("Mode")}` },
			...uniqueModes.map((m) => ({
				value: m,
				label:
					String(m) === "moving"
						? t("Moving")
						: m === "no-move"
							? t("No Move")
							: m === "nmpz"
								? "NMPZ"
								: m,
			})),
		],
		[uniqueModes, t],
	);

	const filteredTrend = useMemo(() => {
		const cutoff = trendRangeCutoff(trendFilterRange);
		const filtered = data.scoreTrend.filter((p) => {
			if (cutoff != null && p.at < cutoff) return false;
			if (trendFilterCountry !== "__all__") {
				if (!p.countryCodes.includes(trendFilterCountry)) return false;
			}
			if (trendFilterMap !== "__all__" && p.mapId !== trendFilterMap) return false;
			if (trendFilterProvider !== "__all__" && !p.providers.includes(trendFilterProvider))
				return false;
			if (trendFilterMode !== "__all__" && p.mode !== trendFilterMode) return false;
			return true;
		});
		// Recompute rolling average over the filtered subset
		let runningScore = 0;
		let runningRounds = 0;
		return filtered.map((p) => {
			runningScore += p.totalScore;
			runningRounds += p.roundCount;
			return {
				at: p.at,
				score: runningRounds > 0 ? Math.round(runningScore / runningRounds) : 0,
				avgScore: p.avgScore,
				totalScore: p.totalScore,
				mapName: p.mapName,
			};
		});
	}, [
		data.scoreTrend,
		trendFilterRange,
		trendFilterCountry,
		trendFilterMap,
		trendFilterProvider,
		trendFilterMode,
	]);

	const handleReplay = useCallback(
		(s: GameSession) => {
			onReplaySession?.(s);
		},
		[onReplaySession],
	);

	if (data.overview.gamesPlayed === 0) {
		return (
			<div className="gg-analytics">
				<header className="gg-analytics__header">
					<h2>{t("Analytics")}</h2>
					<Button variant="ghost" onClick={onBack}>
						{t("Back")}
					</Button>
				</header>
				<EmptyState icon={mdiChartBoxOutline}>
					{t("No games played yet. Start a round to build analytics.")}
				</EmptyState>
			</div>
		);
	}

	const o = data.overview;

	return (
		<div className="gg-analytics">
			<header className="gg-analytics__header">
				<div>
					<h2>{t("Analytics")}</h2>
					<p className="gg-analytics__sub">{t("Your local game history and accuracy")}</p>
				</div>
				<div className="gg-analytics__header-actions">
					{mapId && (
						<Checkbox
							className="gg-analytics__filter"
							checked={filterMap}
							onChange={(e) => setFilterMap(e.target.checked)}
						>
							{t("Current map only")}
						</Checkbox>
					)}
					<Button variant="ghost" onClick={onBack}>
						{t("Back")}
					</Button>
				</div>
			</header>

			<div className="gg-analytics__cards">
				<div className="gg-analytics__card">
					<span className="gg-analytics__card-label">{t("Games")}</span>
					<span className="gg-analytics__card-value">{o.gamesPlayed}</span>
				</div>
				<div className="gg-analytics__card">
					<span className="gg-analytics__card-label">{t("Avg score")}</span>
					<span className="gg-analytics__card-value">{o.averageScore.toLocaleString()}</span>
				</div>
				<div className="gg-analytics__card">
					<span className="gg-analytics__card-label">{t("Best score")}</span>
					<span className="gg-analytics__card-value">{o.bestScore.toLocaleString()}</span>
				</div>
				<div className="gg-analytics__card">
					<span className="gg-analytics__card-label">{t("Best streak")}</span>
					<span className="gg-analytics__card-value">{o.bestStreak}</span>
				</div>
				<div className="gg-analytics__card">
					<span className="gg-analytics__card-label">{t("5K rounds")}</span>
					<span className="gg-analytics__card-value">{o.perfectRounds}</span>
				</div>
				<div className="gg-analytics__card">
					<span className="gg-analytics__card-label">{t("Total rounds")}</span>
					<span className="gg-analytics__card-value">{o.totalRounds}</span>
				</div>
			</div>

			<section className="gg-analytics__section">
				<h3>{t("Score trend")}</h3>

				{/* Filter bar */}
				<div className="gg-analytics__trend-filters">
					<FilterDropdown
						label={t("Time")}
						value={trendFilterRange}
						options={rangeOptions}
						onChange={(v) => setTrendFilterRange(v as TrendRange)}
					/>
					<FilterDropdown
						label={t("Country")}
						value={trendFilterCountry}
						options={countryOptions}
						onChange={setTrendFilterCountry}
					/>
					<FilterDropdown
						label={t("Map")}
						value={trendFilterMap}
						options={mapOptions}
						onChange={setTrendFilterMap}
					/>
					<FilterDropdown
						label={t("Provider")}
						value={trendFilterProvider}
						options={providerOptions}
						onChange={setTrendFilterProvider}
					/>
					<FilterDropdown
						label={t("Mode")}
						value={trendFilterMode}
						options={modeOptions}
						onChange={setTrendFilterMode}
					/>
				</div>

				<ScoreTrendChart points={filteredTrend} t={t} />
			</section>

			<section className="gg-analytics__section">
				<h3>{t("By country")}</h3>
				<div className="gg-analytics__list">
					{data.byCountry.slice(0, 40).map((c) => (
						<div key={c.countryCode} className="gg-analytics__row">
							<span
								className="gg-analytics__flag"
								dangerouslySetInnerHTML={{
									__html: countryFlagHtml(c.countryCode) || c.countryCode,
								}}
							/>
							<span className="gg-analytics__name">{c.countryName}</span>
							<span className={`gg-analytics__acc ${accuracyClass(c.accuracy)}`}>
								{c.accuracy}%
							</span>
							<span className="gg-analytics__meta">
								{c.rounds} {t("· avg")} {c.avgScore}
							</span>
						</div>
					))}
				</div>
			</section>

			<section className="gg-analytics__section">
				<h3>{t("By provider")}</h3>
				<div className="gg-analytics__list">
					{data.byProvider.map((p) => (
						<div key={p.provider} className="gg-analytics__row">
							<span className="gg-analytics__name gg-analytics__provider">{p.provider}</span>
							<span className="gg-analytics__meta">
								{p.rounds} {t("rounds · avg")} {p.avgScore.toLocaleString()}
							</span>
						</div>
					))}
				</div>
			</section>

			<section className="gg-analytics__section">
				<h3>{t("By movement mode")}</h3>
				<div className="gg-analytics__list">
					{data.byMode.map((m) => (
						<div key={m.mode} className="gg-analytics__row">
							<span className="gg-analytics__name">
								{String(m.mode) === "moving"
									? t("Moving")
									: m.mode === "no-move"
										? t("No Move")
										: m.mode === "nmpz"
											? "NMPZ"
											: m.mode}
							</span>
							<span className="gg-analytics__meta">
								{m.games} {t("games · avg")} {m.avgScore.toLocaleString()}
							</span>
						</div>
					))}
				</div>
			</section>

			<section className="gg-analytics__section">
				<h3>{t("By map")}</h3>
				<div className="gg-analytics__list">
					{data.byMap.map((m) => (
						<div key={m.mapId} className="gg-analytics__row">
							<span className="gg-analytics__name">{m.mapName}</span>
							<span className="gg-analytics__meta">
								{m.games} {t("games · avg")} {m.avgScore.toLocaleString()} {t("· best")}{" "}
								{m.bestScore.toLocaleString()}
							</span>
						</div>
					))}
				</div>
			</section>

			<section className="gg-analytics__section">
				<h3>{t("Recently played")}</h3>
				<div className="gg-analytics__list">
					{data.recent.map((s) => (
						<ReplayEntry
							key={s.id}
							session={s}
							onReplay={() => handleReplay(s)}
							onDelete={() => {
								deleteSession(s.id);
								setVersion((n) => n + 1);
							}}
						/>
					))}
				</div>
			</section>

			<div className="gg-analytics__footer">
				<Button
					variant="destructive"
					onClick={() => {
						clearSessions();
						setVersion((n) => n + 1);
					}}
				>
					{t("Clear history")}
				</Button>
			</div>
		</div>
	);
}
