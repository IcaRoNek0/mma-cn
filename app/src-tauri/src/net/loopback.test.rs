use super::*;

const PREFIX: &str = "/t0k3n/";

fn status(method: &str, url: &str) -> u16 {
    route(method, url, PREFIX).status().as_u16()
}

#[test]
fn a_request_without_the_token_is_refused() {
    assert_eq!(status("GET", "/pano/abc/2"), 403);
    assert_eq!(status("GET", "/wrong/pano/abc/2"), 403);
}

#[test]
fn only_schemes_marked_for_sidecars_answer() {
    assert_eq!(status("GET", "/t0k3n/mma-buf/C:/secrets.txt"), 404);
    assert_eq!(status("GET", "/t0k3n/gmaps/maps"), 404);
    assert_eq!(status("GET", "/t0k3n/nope/x"), 404);
}

#[test]
fn a_sidecar_only_reads() {
    assert_eq!(status("POST", "/t0k3n/pano/abc/2"), 405);
}

#[test]
fn a_marked_scheme_gets_the_path_after_its_name() {
    let reply = route("GET", "/t0k3n/pano/abc", PREFIX);
    assert_eq!(reply.status().as_u16(), 502);
    assert!(String::from_utf8_lossy(reply.body()).contains("bad panorama path '/abc'"));
}
