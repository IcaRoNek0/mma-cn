use super::*;

const GET_METADATA: &str =
    "https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetMetadata";

#[test]
fn keeps_path_and_query() {
    assert_eq!(
        rewrite_origin(GET_METADATA, "http://127.0.0.1:4599"),
        "http://127.0.0.1:4599/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetMetadata"
    );
    assert_eq!(
        rewrite_origin(
            "https://www.google.com/maps/photometa/ac/v1?pb=!1m1",
            "http://127.0.0.1:4599"
        ),
        "http://127.0.0.1:4599/maps/photometa/ac/v1?pb=!1m1"
    );
}

#[test]
fn origin_without_path_becomes_root() {
    assert_eq!(
        rewrite_origin("https://example.com", "http://127.0.0.1:1"),
        "http://127.0.0.1:1/"
    );
}

#[test]
fn trailing_slash_on_origin_does_not_double_up() {
    assert_eq!(
        rewrite_origin("https://example.com/a/b", "http://127.0.0.1:1/"),
        "http://127.0.0.1:1/a/b"
    );
}
