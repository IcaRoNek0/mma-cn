use super::*;
use crate::net::fetch::{HttpResponse, SendFn};
use std::sync::Mutex;
use std::time::Duration;

fn parsed(input: &str) -> ParsedLocation {
    parse(input).expect("parses")
}

#[test]
fn non_urls_and_unsupported_domains_parse_to_nothing() {
    assert_eq!(parse("not a url"), None);
    assert_eq!(parse(""), None);
    assert_eq!(parse("   "), None);
    assert_eq!(parse("https://example.com/maps"), None);
    assert_eq!(
        parse("https://openstreetmap.org/#map=14/51.5074/-0.1278"),
        None
    );
}

#[test]
fn a_pano_viewpoint_url_carries_the_whole_camera() {
    let p = parsed(
        "https://www.google.com/maps?map_action=pano&viewpoint=48.8566,2.3522&heading=90&pitch=-5&pano=CAoSK0FGtest&fov=90",
    );
    assert!((p.lat - 48.8566).abs() < 1e-4);
    assert!((p.lng - 2.3522).abs() < 1e-4);
    assert_eq!(p.heading, 90.0);
    assert_eq!(p.pitch, -5.0);
    assert_eq!(p.pano_id.as_deref(), Some("CAoSK0FGtest"));
    assert_eq!(p.flags, LocationFlags::LOAD_AS_PANO_ID);
}

#[test]
fn a_street_view_path_url_with_a_pano_loads_as_pano_id() {
    let p = parsed(
        "https://www.google.com/maps/@58.6190505,49.7204709,3a,75y,265.69h,98.54t/data=!3m8!1e1!3m6!1sbUp3OlCW2UH3MA4lYMRirQ!2e0!5s20130901T000000!7i13312!8i6656",
    );
    assert_eq!(p.pano_id.as_deref(), Some("bUp3OlCW2UH3MA4lYMRirQ"));
    assert_eq!(p.flags, LocationFlags::LOAD_AS_PANO_ID);
    assert!((p.lat - 58.6190505).abs() < 1e-7);
    assert!((p.heading - 265.69).abs() < 1e-9);
    assert!((p.pitch - (98.54 - 90.0)).abs() < 1e-9);
    assert!((p.zoom - fov_to_zoom(75.0)).abs() < 1e-12);
}

const KOREA_FIRST: &str = "https://www.google.com/maps/@8Q98FWJW+FMW54RX,3a,106.3y,96.73h,94.69t/data=!3m5!1e1!3m3!1sVCkBR3k2Lcvs3qBGSb4rGg!2e0?extra%5Btags%5D=South+Korea";
const KOREA_SECOND: &str = "https://www.google.com/maps/@8Q98QG96+W2XCHFV,3a,106.3y,254.92h,90.55t/data=!3m5!1e1!3m3!1skIj6lYm-HiSCvTxUEJcCeA!2e0?extra%5Btags%5D=South+Korea";

#[test]
fn korean_plus_code_share_links_preserve_the_panorama_camera_and_tags() {
    for (url, lat, lng, id, heading, pitch) in [
        (
            KOREA_FIRST,
            37.48122598,
            126.9467152709961,
            "VCkBR3k2Lcvs3qBGSb4rGg",
            96.73,
            4.69,
        ),
        (
            KOREA_SECOND,
            37.76986258,
            126.5101002807617,
            "kIj6lYm-HiSCvTxUEJcCeA",
            254.92,
            0.55,
        ),
    ] {
        let p = parsed(url);
        assert!((p.lat - lat).abs() < 1e-10);
        assert!((p.lng - lng).abs() < 1e-10);
        assert_eq!(p.pano_id.as_deref(), Some(id));
        assert_eq!(p.flags, LocationFlags::LOAD_AS_PANO_ID);
        assert!((p.heading - heading).abs() < 1e-10);
        assert!((p.pitch - pitch).abs() < 1e-10);
        assert!((p.zoom - fov_to_zoom(106.3)).abs() < 1e-12);
        assert_eq!(p.tags, ["South Korea"]);
    }
}

#[test]
fn a_plus_code_accepts_an_encoded_separator_and_lowercase_characters() {
    assert_eq!(
        parsed(&KOREA_FIRST.replace("8Q98FWJW+FMW54RX", "8q98fwjw%2bfmw54rx")),
        parsed(KOREA_FIRST)
    );
    assert_eq!(
        parsed(&KOREA_FIRST.replace("FWJW+", "FWJW%2B")),
        parsed(KOREA_FIRST)
    );
}

#[test]
fn a_plus_code_retains_the_fragment_tags_and_lat_lng_load_mode() {
    let p = parsed(&format!(
        "{KOREA_FIRST}#extra[tags]=FromHash&extra[loadMode]=latLng"
    ));
    assert_eq!(p.flags, LocationFlags::empty());
    assert_eq!(p.pano_id.as_deref(), Some("VCkBR3k2Lcvs3qBGSb4rGg"));
    assert_eq!(p.tags, ["FromHash"]);
}

#[test]
fn a_plus_code_path_without_heading_keeps_roll_and_camera_parsing() {
    let p = parsed(&KOREA_SECOND.replace(",254.92h,90.55t", ",90.55t,2r"));
    assert_eq!(p.heading, 0.0);
    assert!((p.pitch - 0.55).abs() < 1e-10);
    assert_eq!(p.pano_id.as_deref(), Some("kIj6lYm-HiSCvTxUEJcCeA"));
}

#[test]
fn plus_code_decoding_matches_the_reference_pair_cell() {
    let (lat, lng) = decode_full_plus_code("8FVC9G8F+6X").expect("full code");
    assert!((lat - 47.3655625).abs() < 1e-10);
    assert!((lng - 8.5249375).abs() < 1e-10);
}

#[test]
fn malformed_short_and_out_of_range_plus_codes_are_rejected() {
    for code in [
        "FWJW+FM",
        "8Q98FWJW+F",
        "8Q98FWJW+FMW54RXX",
        "8Q98FWJW+FM0",
        "FQ98FWJW+FM",
        "8W98FWJW+FM",
    ] {
        assert_eq!(decode_full_plus_code(code), None, "{code}");
        assert_eq!(
            parse(&KOREA_FIRST.replace("8Q98FWJW+FMW54RX", code)),
            None,
            "{code}"
        );
    }
}

#[test]
fn load_mode_lat_lng_opts_out_of_load_as_pano_id() {
    let p = parsed(
        "https://www.google.com/maps?map_action=pano&viewpoint=48.8566,2.3522&pano=CAoSK0FGtest&extra[loadMode]=latLng",
    );
    assert_eq!(p.pano_id.as_deref(), Some("CAoSK0FGtest"));
    assert_eq!(p.flags, LocationFlags::empty());
}

#[test]
fn a_viewpoint_without_a_pano_is_a_bare_coordinate() {
    let p = parsed("https://www.google.com/maps?map_action=pano&viewpoint=40.7128,-74.006");
    assert!((p.lat - 40.7128).abs() < 1e-4);
    assert!((p.lng + 74.006).abs() < 1e-3);
    assert_eq!(p.pano_id, None);
    assert_eq!(p.flags, LocationFlags::empty());
    assert_eq!(p.heading, 0.0);
    assert_eq!(p.pitch, 0.0);
}

#[test]
fn a_pano_url_missing_its_viewpoint_parses_to_nothing() {
    assert_eq!(
        parse("https://www.google.com/maps?map_action=pano&heading=90"),
        None
    );
}

#[test]
fn the_legacy_cbll_layer_form_is_a_bare_coordinate() {
    let p = parsed("https://www.google.com/maps?layer=c&cbll=51.5074,-0.1278");
    assert!((p.lat - 51.5074).abs() < 1e-4);
    assert!((p.lng + 0.1278).abs() < 1e-4);
    assert_eq!(p.heading, 0.0);
    assert_eq!(p.pano_id, None);
}

#[test]
fn an_arts_and_culture_url_pins_its_pano() {
    let p = parsed(
        "https://artsandculture.google.com/streetview?sv_pid=PANO123&sv_lat=35.6762&sv_lng=139.6503&sv_h=180&s_p=10&sv_z=2",
    );
    assert!((p.lat - 35.6762).abs() < 1e-4);
    assert!((p.lng - 139.6503).abs() < 1e-4);
    assert_eq!(p.heading, 180.0);
    assert_eq!(p.pitch, 10.0);
    assert_eq!(p.pano_id.as_deref(), Some("PANO123"));
    assert_eq!(p.zoom, 2.0);
    assert_eq!(p.flags, LocationFlags::LOAD_AS_PANO_ID);
}

#[test]
fn tags_come_from_the_query_and_the_fragment_owns_them_when_present() {
    let p = parsed(
        "https://www.google.com/maps?map_action=pano&viewpoint=10,20&extra[tags]=Mountains&extra[tags]=Coastal",
    );
    assert_eq!(p.tags, ["Mountains", "Coastal"]);
    let p =
        parsed("https://www.google.com/maps?map_action=pano&viewpoint=10,20#extra[tags]=FromHash");
    assert_eq!(p.tags, ["FromHash"]);
    let p = parsed("https://www.google.com/maps?map_action=pano&viewpoint=10,20");
    assert!(p.tags.is_empty());
}

#[test]
fn input_whitespace_is_trimmed() {
    assert_eq!(
        parsed("  https://www.google.com/maps?map_action=pano&viewpoint=10,20  ").lat,
        10.0
    );
}

#[test]
fn a_non_official_street_view_key_becomes_the_encoded_pano_id() {
    let p = parsed(
        "https://www.google.com/maps/@1,2,3a,75y,0h,90t/data=!1sCIHM0ogKEICAgICEm_ixqwE!2e10",
    );
    assert_eq!(
        p.pano_id.as_deref(),
        Some("CAoSF0NJSE0wb2dLRUlDQWdJQ0VtX2l4cXdF")
    );
}

#[test]
fn a_missing_fov_defaults_to_ninety_degrees() {
    let p = parsed("https://www.google.com/maps?map_action=pano&viewpoint=10,20");
    assert_eq!(p.zoom, fov_to_zoom(90.0));
}

// The writer is `app/src/lib/sv/mapsLink.ts`; `app/test/unit/mapsLink.test.ts` pins these
// same strings as its expected output.
// If either side drifts, one of the two suites goes red.
const OFFICIAL_PINNED: &str = "https://www.google.com/maps/@58.6190505,49.7204709,3a,66.3y,265.69h,98.54t/data=!3m5!1e1!3m3!1sbUp3OlCW2UH3MA4lYMRirQ!2e0!6shttps%3A%2F%2Fstreetviewpixels-pa.googleapis.com%2Fv1%2Fthumbnail%3Fpanoid%3DbUp3OlCW2UH3MA4lYMRirQ%26cb_client%3Dmaps_sv.share%26w%3D900%26h%3D600%26yaw%3D265.69%26pitch%3D-8.54%26thumbfov%3D66?coh=235716&entry=tts";

const UNOFFICIAL_NO_TAGS: &str = "https://www.google.com/maps/@1,2,3a,73.7y,0.00h,90.00t/data=!3m4!1e1!3m2!1sCIHM0ogKEICAgICEm_ixqwE!2e0?coh=235716&entry=tts";

const TAGGED_LAT_LNG: &str = "https://www.google.com/maps/@35.6762,139.6503,3a,89.4y,180.00h,85.00t/data=!3m5!1e1!3m3!1sQmgLCWv3QpNiK-1F3ZK_1Q!2e0!6shttps%3A%2F%2Fstreetviewpixels-pa.googleapis.com%2Fv1%2Fthumbnail%3Fpanoid%3DQmgLCWv3QpNiK-1F3ZK_1Q%26cb_client%3Dmaps_sv.share%26w%3D900%26h%3D600%26yaw%3D180%26pitch%3D5%26thumbfov%3D89?coh=235716&entry=tts&extra%5Btags%5D=Mountains&extra%5Btags%5D=Coastal&extra%5BloadMode%5D=latLng";

/// Zoom survives the writer's one-decimal field of view.
fn assert_zoom(p: &ParsedLocation, written: f64) {
    assert!(
        (p.zoom - written).abs() < 2e-3,
        "zoom {} != {written}",
        p.zoom
    );
}

#[test]
fn an_official_pano_link_round_trips_its_whole_camera() {
    let p = parsed(OFFICIAL_PINNED);
    assert!((p.lat - 58.6190505).abs() < 1e-9);
    assert!((p.lng - 49.7204709).abs() < 1e-9);
    assert!((p.heading - 265.69).abs() < 1e-9);
    assert!((p.pitch - 8.54).abs() < 1e-9);
    assert_zoom(&p, 1.2);
    assert_eq!(p.pano_id.as_deref(), Some("bUp3OlCW2UH3MA4lYMRirQ"));
    assert_eq!(p.flags, LocationFlags::LOAD_AS_PANO_ID);
    assert!(p.tags.is_empty());
}

#[test]
fn an_unofficial_pano_link_round_trips_without_a_thumbnail() {
    let p = parsed(UNOFFICIAL_NO_TAGS);
    assert!((p.lat - 1.0).abs() < 1e-9);
    assert!((p.lng - 2.0).abs() < 1e-9);
    assert_eq!(p.heading, 0.0);
    assert_eq!(p.pitch, 0.0);
    assert_zoom(&p, 1.0);
    assert_eq!(p.pano_id.as_deref(), Some("CIHM0ogKEICAgICEm_ixqwE"));
    assert_eq!(p.flags, LocationFlags::LOAD_AS_PANO_ID);
}

#[test]
fn a_written_link_round_trips_its_tags_and_lat_lng_load_mode() {
    let p = parsed(TAGGED_LAT_LNG);
    assert!((p.lat - 35.6762).abs() < 1e-9);
    assert!((p.lng - 139.6503).abs() < 1e-9);
    assert!((p.heading - 180.0).abs() < 1e-9);
    assert!((p.pitch + 5.0).abs() < 1e-9);
    assert_zoom(&p, 0.6);
    assert_eq!(p.pano_id.as_deref(), Some("QmgLCWv3QpNiK-1F3ZK_1Q"));
    assert_eq!(p.flags, LocationFlags::empty());
    assert_eq!(p.tags, ["Mountains", "Coastal"]);
}

#[test]
fn fov_to_zoom_is_monotonically_decreasing_and_near_one_at_ninety() {
    let zooms: Vec<f64> = [30.0, 45.0, 60.0, 90.0, 120.0]
        .into_iter()
        .map(fov_to_zoom)
        .collect();
    assert!(zooms.windows(2).all(|w| w[0] > w[1]));
    assert!((fov_to_zoom(90.0) - 1.0).abs() < 0.5);
}

const KOREA_PANO_ONLY: &str = "https://www.google.com/maps/@/data=!3m7!1e1!3m5!1sWp9HXFu9pYKjlNw6E6YR-w!2e0!6shttps:%2F%2Fstreetviewpixels-pa.googleapis.com%2Fv1%2Fthumbnail%3Fcb_client%3Dmaps_sv.tactile%26w%3D900%26h%3D600%26pitch%3D0%26panoid%3DWp9HXFu9pYKjlNw6E6YR-w%26yaw%3D260.07!7i13312!8i6656?entry=ttu&g_ep=EgoyMDI2MDkyOC4wIKXMDSoASAFQAw%3D%3D";
const GETMETADATA_PB: &[u8] = include_bytes!("../sv/testdata/getmetadata.pb");

/// A session whose GetMetadata answers with `body`, recording every pano id asked for.
fn metadata_session(status: u16, body: &'static [u8]) -> (Session, Arc<Mutex<Vec<String>>>) {
    let asked: Arc<Mutex<Vec<String>>> = Arc::default();
    let log = asked.clone();
    let send: SendFn = Box::new(move |req| {
        let body_text = String::from_utf8_lossy(req.body.as_deref().unwrap_or_default());
        if body_text.contains("Wp9HXFu9pYKjlNw6E6YR-w") {
            log.lock().unwrap().push("Wp9HXFu9pYKjlNw6E6YR-w".into());
        }
        Box::pin(async move {
            Ok(HttpResponse {
                status,
                body: body.to_vec(),
            })
        })
    });
    let transport = Arc::new(Transport {
        send,
        backoff: Duration::from_millis(1),
    });
    (Session::new(transport, Arc::default()), asked)
}

fn parsed_over(input: &str, session: &Session) -> Option<ParsedLocation> {
    parse_expanded(&Url::parse(input).unwrap(), session)
}

#[test]
fn a_link_naming_only_its_pano_stands_where_the_pano_does_and_looks_where_its_thumbnail_does() {
    let (session, asked) = metadata_session(200, GETMETADATA_PB);
    let p = parsed_over(KOREA_PANO_ONLY, &session).expect("parses");
    let pano = pano::decode_response(GETMETADATA_PB)[0]
        .clone()
        .expect("fixture pano");
    assert_eq!((p.lat, p.lng), (pano.lat, pano.lng));
    assert_eq!(*asked.lock().unwrap(), ["Wp9HXFu9pYKjlNw6E6YR-w"]);
    assert_eq!(p.pano_id.as_deref(), Some("Wp9HXFu9pYKjlNw6E6YR-w"));
    assert_eq!(p.flags, LocationFlags::LOAD_AS_PANO_ID);
    assert!((p.heading - 260.07).abs() < 1e-9);
    assert!(p.pitch == 0.0 && p.pitch.is_sign_positive());
    assert_eq!(p.zoom, 0.0);
}

#[test]
fn a_pano_only_link_whose_pano_does_not_resolve_parses_to_nothing() {
    let (session, _) = metadata_session(404, b"");
    assert_eq!(parsed_over(KOREA_PANO_ONLY, &session), None);
}

#[test]
fn a_thumbnail_carries_pitch_and_field_of_view_the_way_the_link_writer_puts_them() {
    let (session, _) = metadata_session(200, GETMETADATA_PB);
    let link = KOREA_PANO_ONLY.replace("pitch%3D0", "pitch%3D-12.5%26thumbfov%3D75");
    let p = parsed_over(&link, &session).expect("parses");
    assert!((p.pitch - 12.5).abs() < 1e-9);
    assert!((p.zoom - fov_to_zoom(75.0)).abs() < 1e-12);
}

#[test]
fn a_link_with_its_position_never_asks_for_the_pano() {
    let (session, asked) = metadata_session(200, GETMETADATA_PB);
    let p = parsed_over(KOREA_FIRST, &session).expect("parses");
    assert!((p.lat - 37.48122598).abs() < 1e-10);
    assert!(asked.lock().unwrap().is_empty());
}
