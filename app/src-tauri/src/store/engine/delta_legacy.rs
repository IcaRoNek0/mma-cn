//! One-time conversion of msgpack `.delta` sidecars to the Arrow commit-delta format.
//!
//! Self-contained and disposable: nothing outside this file knows the msgpack shape, and
//! the app reaches in only through [`convert_msgpack_deltas`], called once at startup.
//! When every install has upgraded, delete this file, its test file, its `mod delta_legacy;`
//! line in `engine.rs`, the startup call in `lib.rs`, the `rmp-serde` dependency, and the
//! non-human-readable branches of `RawExtra`'s serde impls -- nothing else refers to any
//! of it.

use super::{set_aside_delta, Overlay};
use crate::store::arrow;
use crate::store::storage;
use crate::types::{AppError, AppResult, Location};
use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// The msgpack sidecar: the overlay with its dead ids and patches as plain lists.
#[derive(serde::Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
struct MsgpackDelta {
    adds: Vec<Location>,
    dead_ids: Vec<u32>,
    patches: Vec<Location>,
}

/// Rewrite every map's msgpack sidecar as an Arrow delta.
pub(crate) fn convert_msgpack_deltas() {
    let map_ids = storage::open_db().and_then(|conn| {
        conn.prepare("SELECT id FROM maps")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)
    });
    let map_ids = match map_ids {
        Ok(ids) => ids,
        Err(e) => {
            log::error!("[delta_legacy] could not list maps: {e}");
            return;
        }
    };
    for id in map_ids {
        match (storage::arrow_delta_path(&id), storage::arrow_path(&id)) {
            (Ok(delta), Ok(base)) => convert_msgpack_delta(&delta, &base),
            (Err(e), _) | (_, Err(e)) => log::error!("[delta_legacy] {id}: {e}"),
        }
    }
}

/// Rewrite one msgpack sidecar as an Arrow delta against `base_path`. A missing or
/// already-Arrow sidecar is left alone; one that cannot be converted is set aside.
fn convert_msgpack_delta(delta_path: &Path, base_path: &Path) {
    if !delta_path.exists() || is_arrow(delta_path) {
        return;
    }
    match convert(delta_path, base_path) {
        Ok(()) => log::info!("[delta_legacy] converted {delta_path:?}"),
        Err(e) => set_aside_delta(delta_path, &e),
    }
}

fn is_arrow(path: &Path) -> bool {
    let mut magic = [0u8; 6];
    File::open(path)
        .and_then(|mut f| f.read_exact(&mut magic))
        .is_ok_and(|()| &magic == b"ARROW1")
}

fn convert(delta_path: &Path, base_path: &Path) -> AppResult<()> {
    let old: MsgpackDelta =
        rmp_serde::from_slice(&fs::read(delta_path)?).map_err(|e| AppError::from(e.to_string()))?;
    let base = if base_path.exists() {
        Some(arrow::read_arrow_ipc(base_path)?)
    } else {
        None
    };
    let overlay = Overlay {
        adds: old.adds,
        dead: old.dead_ids.into_iter().collect(),
        patches: old.patches.into_iter().map(|l| (l.id, l)).collect(),
    };
    arrow::write_arrow_ipc(delta_path, &overlay.to_delta(base.as_ref()))
}

#[cfg(test)]
#[path = "delta_legacy.test.rs"]
mod tests;
