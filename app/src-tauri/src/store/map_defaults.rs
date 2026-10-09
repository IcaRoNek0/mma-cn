//! The preferences every new map starts from, kept as a single row.

use crate::store::maps::{MapPreferences, MapSettings};
use crate::store::storage;
use crate::types::AppResult;
use rusqlite::{params, Connection, OptionalExtension};

/// The saved preferences, or `None` when new maps start from the factory defaults.
fn load(conn: &Connection) -> rusqlite::Result<Option<MapPreferences>> {
    let json: Option<String> = conn
        .query_row(
            "SELECT preferences FROM map_defaults WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(json.and_then(|json| serde_json::from_str(&json).ok()))
}

fn save(conn: &Connection, preferences: Option<&MapPreferences>) -> AppResult<()> {
    match preferences {
        Some(preferences) => conn.execute(
            "INSERT INTO map_defaults (id, preferences) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET preferences = excluded.preferences",
            params![serde_json::to_string(preferences)?],
        )?,
        None => conn.execute("DELETE FROM map_defaults WHERE id = 1", [])?,
    };
    Ok(())
}

/// The settings a new map is created with.
pub(crate) fn new_map_settings(conn: &Connection) -> rusqlite::Result<MapSettings> {
    Ok(MapSettings {
        preferences: load(conn)?.unwrap_or_default(),
        ..MapSettings::default()
    })
}

/// The preferences new maps start from, or `null` when they start from the factory defaults.
#[tauri::command]
#[specta::specta]
pub async fn store_get_map_defaults() -> AppResult<Option<MapPreferences>> {
    storage::with_db(|conn| Ok(load(conn)?)).await
}

/// Set the preferences new maps start from; `null` restores the factory defaults. Maps
/// that already exist keep their own.
#[tauri::command]
#[specta::specta]
pub async fn store_set_map_defaults(preferences: Option<MapPreferences>) -> AppResult<()> {
    storage::with_db(move |conn| save(conn, preferences.as_ref())).await
}

#[cfg(test)]
#[path = "map_defaults.test.rs"]
mod tests;
