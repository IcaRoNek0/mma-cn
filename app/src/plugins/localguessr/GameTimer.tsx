import { useEffect, useRef, useState } from "react";
import type { TimerMode } from "./GameState";

export function GameTimer({
	mode,
	timeLimit,
	startedAt,
	running,
	onExpire,
	embedded,
}: {
	mode: TimerMode;
	timeLimit: number;
	startedAt: number;
	running: boolean;
	onExpire?: () => void;
	/** Render inside HUD status bar (no outer pill). */
	embedded?: boolean;
}) {
	const [elapsedMs, setElapsedMs] = useState(0);
	const expiredRef = useRef(false);

	useEffect(() => {
		expiredRef.current = false;
		setElapsedMs(0);
	}, [startedAt]);

	useEffect(() => {
		if (!running || mode === "off") return;
		const id = window.setInterval(() => {
			setElapsedMs(Date.now() - startedAt);
		}, 200);
		return () => clearInterval(id);
	}, [running, mode, startedAt]);

	useEffect(() => {
		if (!running || mode !== "countdown" || !onExpire || expiredRef.current) return;
		if (elapsedMs / 1000 >= timeLimit) {
			expiredRef.current = true;
			onExpire();
		}
	}, [elapsedMs, timeLimit, mode, running, onExpire]);

	if (mode === "off") return null;

	const elapsedSec = Math.max(0, elapsedMs / 1000);
	const display =
		mode === "countdown" ? Math.max(0, Math.ceil(timeLimit - elapsedSec)) : Math.floor(elapsedSec);
	const urgent = mode === "countdown" && display <= 10;

	const mm = Math.floor(display / 60);
	const ss = display % 60;
	const label = `${mm}:${String(ss).padStart(2, "0")}`;

	return (
		<div
			className={`${embedded ? " gg-timer--embedded" : ""} ${urgent ? "gg-timer--urgent" : ""}`}
			aria-live="polite"
		>
			{label}
		</div>
	);
}
