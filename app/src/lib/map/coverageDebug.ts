import { log } from "@/lib/util/log";

/** Verbose coverage tracing is disabled; errors remain available for failures. */
export function coverageDebug(
	_scope: "map" | "baidu" | "tencent",
	_message: string,
	_data?: unknown,
) {}

export function coverageError(scope: "map" | "baidu" | "tencent", message: string, error: unknown) {
	const text = `[coverage:${scope}] ${message}`;
	// eslint-disable-next-line no-console
	console.error(text, error);
	if (!import.meta.env.DEV) log.error(text, error);
}
