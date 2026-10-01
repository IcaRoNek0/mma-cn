use super::*;
use rusqlite::Connection;

fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    storage::run_migrations_on(&conn).unwrap();
    conn
}

fn stored(conn: &Connection) -> Option<serde_json::Value> {
    conn.query_row(
        "SELECT preferences FROM map_defaults WHERE id = 1",
        [],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .unwrap()
    .map(|json| serde_json::from_str(&json).unwrap())
}

#[test]
fn defaults_saved_from_a_map_keep_only_its_preferences() {
    let conn = db();
    let preferences: MapPreferences = serde_json::from_value(serde_json::json!({
        "pointAlongRoad": false,
        "keyBindings": [{"key": "m", "action": {"type": "applyTag", "tagId": 7}}],
        "virtualTags": {"Europe": {"color": "#123456"}},
        "aliases": {"Europe/France": 7}
    }))
    .unwrap();
    save(&conn, Some(&preferences)).unwrap();

    let saved = stored(&conn).unwrap();
    assert_eq!(saved["pointAlongRoad"], false);
    for key in ["keyBindings", "virtualTags", "aliases"] {
        assert!(saved.get(key).is_none(), "{key} was saved as a default");
    }
    let settings = new_map_settings(&conn).unwrap();
    assert!(!settings.preferences.point_along_road);
    assert!(settings.key_bindings.is_empty());
    assert!(settings.virtual_tags.is_empty());
    assert!(settings.aliases.is_empty());
}

#[test]
fn new_maps_fall_back_to_factory_defaults() {
    let conn = db();
    assert!(load(&conn).unwrap().is_none());
    assert!(
        new_map_settings(&conn)
            .unwrap()
            .preferences
            .point_along_road
    );

    conn.execute(
        "INSERT INTO map_defaults (id, preferences) VALUES (1, ?1)",
        [r#"{"pointAlongRoad":false}"#],
    )
    .unwrap();
    let settings = new_map_settings(&conn).unwrap();
    assert!(!settings.preferences.point_along_road);
    assert!(
        settings.preferences.prefer_official,
        "an unsaved key keeps its factory value"
    );

    conn.execute(
        "UPDATE map_defaults SET preferences = 'not json' WHERE id = 1",
        [],
    )
    .unwrap();
    assert!(
        new_map_settings(&conn)
            .unwrap()
            .preferences
            .point_along_road
    );
}

#[test]
fn resetting_restores_factory_defaults() {
    let conn = db();
    let preferences = MapPreferences {
        point_along_road: false,
        ..MapPreferences::default()
    };
    save(&conn, Some(&preferences)).unwrap();
    save(&conn, Some(&preferences)).unwrap();
    save(&conn, None).unwrap();

    assert!(stored(&conn).is_none());
    assert!(
        new_map_settings(&conn)
            .unwrap()
            .preferences
            .point_along_road
    );
}
