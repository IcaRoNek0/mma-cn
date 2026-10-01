//! Everything an e2e build does differently, in one place: the harness points the app at
//! local stubs and hands it the session a real sign-in would have produced.

use std::sync::OnceLock;

use crate::net::fetch::SendFn;
use crate::net::geoguessr;

fn env_origin(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|o| o.trim_end_matches('/').to_string())
        .filter(|o| !o.is_empty())
}

fn sv_origin() -> Option<&'static str> {
    static O: OnceLock<Option<String>> = OnceLock::new();
    O.get_or_init(|| env_origin("MMA_E2E_SV_ORIGIN")).as_deref()
}

/// The GeoGuessr stub's origin, when the harness runs one.
pub(crate) fn gg_origin() -> Option<&'static str> {
    static O: OnceLock<Option<String>> = OnceLock::new();
    O.get_or_init(|| env_origin("MMA_E2E_GG_ORIGIN")).as_deref()
}

/// `send` with every request sent to the Street View stub instead, when the harness runs one.
pub(crate) fn stub_origin(send: SendFn) -> SendFn {
    match sv_origin() {
        None => send,
        Some(origin) => Box::new(move |mut req| {
            req.url = rewrite_origin(&req.url, origin);
            send(req)
        }),
    }
}

/// `url` with its origin swapped for `origin`, keeping path and query.
fn rewrite_origin(url: &str, origin: &str) -> String {
    let path = url
        .find("://")
        .map(|i| i + 3)
        .and_then(|start| url[start..].find('/').map(|j| &url[start + j..]))
        .unwrap_or("/");
    format!("{}{}", origin.trim_end_matches('/'), path)
}

/// There is no credential store and no interactive sign-in, so the harness hands over the
/// session the proxy is expected to replay. Seeded once at startup, so a logout during a
/// run clears it for good exactly as in production.
pub(crate) fn seed_gg_session() {
    if let Some(ncfa) = std::env::var("MMA_E2E_GG_NCFA")
        .ok()
        .filter(|v| !v.is_empty())
    {
        let _ = geoguessr::set_session(Some(ncfa));
    }
}

#[cfg(test)]
#[path = "e2e.test.rs"]
mod tests;
