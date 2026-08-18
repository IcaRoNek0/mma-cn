export async function fetchWithTimeout(
	url: string,
	init: RequestInit = {},
	timeoutMs = 12_000,
): Promise<Response> {
	const timeout = AbortSignal.timeout(timeoutMs);
	const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
	const response = await fetch(url, { ...init, signal });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response;
}

export async function responseJsonGbk<T>(response: Response): Promise<T> {
	const bytes = await response.arrayBuffer();
	return JSON.parse(new TextDecoder("gbk").decode(bytes)) as T;
}
