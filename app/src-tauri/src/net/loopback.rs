//! The app's schemes, served over loopback to the sidecars it starts. A sidecar finds them
//! at the base handed to it in [`BASE_ENV`], and only schemes marked for sidecars answer.
//! The token in that base keeps every other local process out.

use std::sync::OnceLock;
use std::thread;

use tauri::async_runtime;
use tauri::http::{header, Method, Response};

use crate::net::proxy::{cors_resp, SchemeCall, SCHEMES};
use crate::types::{AppError, AppResult};

pub(crate) const BASE_ENV: &str = "MMA_SCHEMES";

/// Where sidecars reach the app's schemes, `http://127.0.0.1:{port}/{token}`, starting the
/// server on first use.
pub(crate) fn base() -> AppResult<&'static str> {
    static BASE: OnceLock<Result<String, String>> = OnceLock::new();
    BASE.get_or_init(|| start().map_err(|e| e.to_string()))
        .as_deref()
        .map_err(|e| AppError(e.clone()))
}

fn start() -> AppResult<String> {
    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| AppError(format!("loopback bind: {e}")))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("loopback server has no ip address")?
        .port();
    let token = uuid::Uuid::new_v4().simple().to_string();
    let prefix = format!("/{token}/");
    thread::Builder::new()
        .name("loopback".into())
        .spawn(move || {
            for req in server.incoming_requests() {
                let prefix = prefix.clone();
                async_runtime::spawn_blocking(move || respond(req, &prefix));
            }
        })?;
    log::info!("[loopback] serving sidecars on 127.0.0.1:{port}");
    Ok(format!("http://127.0.0.1:{port}/{token}"))
}

fn respond(req: tiny_http::Request, prefix: &str) {
    let reply = route(req.method().as_str(), req.url(), prefix);
    let content_type = reply
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| tiny_http::Header::from_bytes("Content-Type", v).ok());
    let mut out = tiny_http::Response::from_data(reply.body().clone())
        .with_status_code(reply.status().as_u16());
    if let Some(h) = content_type {
        out.add_header(h);
    }
    let _ = req.respond(out);
}

fn route(method: &str, url: &str, prefix: &str) -> Response<Vec<u8>> {
    let Some(rest) = url.strip_prefix(prefix) else {
        return cors_resp(403, Vec::new());
    };
    if method != Method::GET.as_str() {
        return cors_resp(405, Vec::new());
    }
    let (rest, query) = rest.split_once('?').unwrap_or((rest, ""));
    let (name, path) = rest.split_once('/').unwrap_or((rest, ""));
    match SCHEMES.iter().find(|s| s.sidecars && s.name == name) {
        Some(scheme) => (scheme.handle)(SchemeCall::from_http(
            method,
            path,
            query.to_string(),
            String::new(),
            String::new(),
            Vec::new(),
        )),
        None => cors_resp(404, Vec::new()),
    }
}

#[cfg(test)]
#[path = "loopback.test.rs"]
mod tests;
