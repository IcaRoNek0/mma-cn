use super::*;

const PARTS: [MapPart; 5] = [
    MapPart::Tags,
    MapPart::UnpinnedPano,
    MapPart::PanoDate,
    MapPart::Flags,
    MapPart::AppData,
];

fn kept(shape: MapShape) -> Vec<MapPart> {
    PARTS.into_iter().filter(|&p| shape.keeps(p)).collect()
}

#[test]
fn geoguessr_keeps_no_optional_part() {
    assert_eq!(kept(MapShape::GeoGuessr), vec![]);
}

#[test]
fn map_making_keeps_everything_but_app_data() {
    assert_eq!(
        kept(MapShape::MapMaking),
        vec![
            MapPart::Tags,
            MapPart::UnpinnedPano,
            MapPart::PanoDate,
            MapPart::Flags
        ]
    );
}

#[test]
fn local_keeps_every_part() {
    assert_eq!(kept(MapShape::Local), PARTS.to_vec());
}

#[test]
fn each_shape_keeps_everything_the_smaller_one_does() {
    let shapes = [MapShape::GeoGuessr, MapShape::MapMaking, MapShape::Local];
    for pair in shapes.windows(2) {
        for part in kept(pair[0]) {
            assert!(pair[1].keeps(part), "{:?} drops {part:?}", pair[1]);
        }
    }
}
