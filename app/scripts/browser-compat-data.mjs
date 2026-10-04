import bcd from "@mdn/browser-compat-data" with { type: "json" };

/** The oldest runtime we ship against. Safari = oldest WKWebView we support (also stands in
 *  for WebKitGTK); Chrome sits high because WebView2 is evergreen -- it only catches the rare
 *  builtin Safari shipped first. */
export const FLOOR = { safari: "18.4", chrome: "140" };

function cmp(a, b) {
	const A = String(a).split(".").map(Number);
	const B = String(b).split(".").map(Number);
	for (let i = 0; i < Math.max(A.length, B.length); i++) {
		const d = (A[i] || 0) - (B[i] || 0);
		if (d) return d;
	}
	return 0;
}

/** `version_added` is a version string, `true` (always shipped), `false` (never), `null`
 *  (BCD doesn't know) or "preview". Unknown is not the same as unsupported -- plenty of
 *  `bcd.api` entries are simply unresearched -- so only an explicit `false`/"preview"
 *  blocks. Returns the browser that falls short, or null when everything clears the floor. */
function need(compat) {
	if (!compat) return null;
	let worst = null;
	for (const [browser, floor] of Object.entries(FLOOR)) {
		const raw = compat.support[browser];
		const entry = Array.isArray(raw) ? raw[0] : raw;
		const v = entry?.version_added;
		if (entry?.flags) return `${browser} (behind a flag)`;
		if (v === true || v == null) continue;
		if (v === false || v === "preview") return `${browser} (unshipped)`;
		if (typeof v === "string" && cmp(v, floor) > 0) worst ??= `${browser} ${v}`;
	}
	return worst;
}

export const blockedGlobals = new Map(); // Temporal -> "safari (unshipped)"
export const blockedMembers = new Map(); // Iterator -> Map(take -> "safari 18.4")

/** BCD tags statics as `parse_static` and annotations as `foo_event`, `foo_permission` etc.
 *  Peel the static marker; anything still carrying an underscore is an annotation, not a
 *  property anyone writes. */
function memberName(key) {
	const name = key.replace(/_static$/, "");
	return name.includes("_") ? null : name;
}

// Both namespaces feed the same tables. `javascript.builtins` covers the language,
// `api` covers everything the platform adds (Blob, URL, AbortSignal, ...).
for (const namespace of [bcd.javascript.builtins, bcd.api]) {
	for (const [owner, node] of Object.entries(namespace)) {
		const ownerReq = need(node.__compat);
		if (ownerReq) {
			// The whole global is out of reach; flagging the identifier covers every member.
			blockedGlobals.set(owner, ownerReq);
			continue;
		}
		const members = blockedMembers.get(owner) ?? new Map();
		for (const [key, sub] of Object.entries(node)) {
			if (key === "__compat" || !sub?.__compat) continue;
			const member = memberName(key);
			const req = member && need(sub.__compat);
			if (req) members.set(member, req);
		}
		if (members.size) blockedMembers.set(owner, members);
	}
}

/** TypeScript's lib names the declaring interface differently from BCD in three mechanical
 *  ways: statics live on `XConstructor`, immutable views on `ReadonlyX`, and iterator
 *  helpers on `IteratorObject`. Peel those and see what BCD recognises. */
export function toBcdOwner(name) {
	if (!name) return null;
	const candidates = [
		name,
		name.replace(/Constructor$/, ""),
		name.replace(/^Readonly/, ""),
		name.replace(/Object$/, ""),
	];
	return candidates.find((c) => bcd.javascript.builtins[c] || bcd.api[c]) ?? null;
}
