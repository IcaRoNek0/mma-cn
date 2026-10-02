//! Everything that touches disk or SQLite for an open store: Arrow snapshots, msgpack deltas, edit history, tag display metadata.

use super::*;
use crate::store::arrow;
use crate::store::storage;
use crate::store::vcs::CommitDiff;
use crate::types::Location;
use crate::types::{AppError, AppResult};
use arrow_array::RecordBatch;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::Instant;

/// Bytes written by a save; 0 when there was nothing to save.
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub saved_bytes: usize,
}

/// Load the uncommitted-delta sidecar. An unreadable delta is set aside as a
/// `.corrupt` sibling - never left in place where the next autosave would
/// overwrite it - and the user is warned via a `store-warning` event.
pub(crate) fn load_delta(delta_path: &Path) -> Option<Overlay> {
    if !delta_path.exists() {
        return None;
    }
    let parsed = fs::read(delta_path)
        .map_err(|e| e.to_string())
        .and_then(|d| rmp_serde::from_slice::<Overlay>(&d).map_err(|e| e.to_string()));
    match parsed {
        Ok(p) => Some(p),
        Err(e) => {
            let kept = delta_path.with_extension("corrupt");
            let _ = fs::remove_file(&kept);
            let moved = fs::rename(delta_path, &kept).is_ok();
            log::error!(
                "[store_open] unreadable delta ({e}), set aside (moved={moved}) at {kept:?}"
            );
            crate::emit_event(StoreWarning::DeltaSetAside);
            None
        }
    }
}

pub(crate) fn flush_closed_store(map_id: &str, store: &Store) -> AppResult<()> {
    if let Some(unsaved) = store.unsaved()? {
        unsaved.write(
            &storage::open_db()?,
            map_id,
            &storage::arrow_delta_path(map_id)?,
        )?;
    }
    log::debug!(
        "[close_map] {map_id} flushed: undo={} redo={}",
        store.edits.undo_len(),
        store.edits.redo_len()
    );
    Ok(())
}

/// Msgpack-serialize the overlay (uncommitted changes) for the `.delta` sidecar.
/// This is what lets the base file stay pinned at the last commit: on next
/// `store_open_map` the blob is loaded straight back into the overlay, and a commit
/// bakes it into the base and deletes the file.
pub(crate) fn overlay_delta_bytes(overlay: &Overlay) -> AppResult<Vec<u8>> {
    rmp_serde::to_vec_named(overlay).map_err(AppError::from)
}

/// Read a map's full current state from disk = base file + uncommitted delta sidecar.
/// Use this for consumers (e.g. export) that read a map's locations directly off disk,
/// since the base file alone is only the last committed state.
pub(crate) fn read_full_state_from_disk(map_id: &str) -> AppResult<Vec<Location>> {
    let path = storage::arrow_path(map_id)?;
    // The base file may not exist for a map with no commits -- its data then lives entirely
    // in the delta sidecar, so always apply the delta below regardless.
    let mut locs = if path.exists() {
        arrow::batch_to_locations(&arrow::read_arrow_ipc(&path)?)
    } else {
        Vec::new()
    };

    let delta_path = storage::arrow_delta_path(map_id)?;
    if delta_path.exists() {
        if let Ok(data) = fs::read(&delta_path) {
            if let Ok(delta) = rmp_serde::from_slice::<Overlay>(&data) {
                delta.apply_to(&mut locs);
            }
        }
    }
    Ok(locs)
}

/// What an open map owes disk: its delta and its undo history, each stamped with the
/// revision it reflects, so edits made while the write runs stay unsaved.
pub(crate) struct Unsaved {
    delta: Option<At<Vec<u8>>>,
    edits: Option<At<EditStacks>>,
    alive: usize,
    pending: CommitDiff,
}

impl Unsaved {
    pub(crate) fn delta_len(&self) -> usize {
        self.delta.as_ref().map_or(0, |d| d.value().len())
    }

    /// Delta before history, so a crash between the two leaves history behind the data, never ahead of it.
    pub(crate) fn write(
        &self,
        conn: &Connection,
        map_id: &str,
        delta_path: &Path,
    ) -> AppResult<()> {
        if let Some(delta) = &self.delta {
            storage::atomic_write_bytes(delta_path, delta.value())?;
        }
        storage::set_map_counts(conn, map_id, self.alive, self.pending)?;
        if let Some(edits) = &self.edits {
            save_edit_history(conn, map_id, edits.value())?;
        }
        Ok(())
    }
}

impl Store {
    /// The state disk lacks, or `None` when disk is current.
    pub(crate) fn unsaved(&self) -> AppResult<Option<Unsaved>> {
        if !self.overlay.is_unsaved() && !self.edits.is_unsaved() {
            return Ok(None);
        }
        let delta = if self.overlay.is_unsaved() {
            Some(self.overlay.stamp(overlay_delta_bytes(&self.overlay)?))
        } else {
            None
        };
        Ok(Some(Unsaved {
            delta,
            edits: self
                .edits
                .is_unsaved()
                .then(|| self.edits.stamp((*self.edits).clone())),
            alive: *self.alive_count,
            pending: self.overlay_diff_counts().into(),
        }))
    }

    /// Disk now holds `written`.
    pub(crate) fn saved(&mut self, written: &Unsaved) {
        if let Some(delta) = &written.delta {
            self.overlay.saved_at(delta.rev());
        }
        if let Some(edits) = &written.edits {
            self.edits.saved_at(edits.rev());
        }
    }
}

/// Write a map's dirty state: delta sidecar (if any), location and pending counts, and
/// tags JSON (if any), for a map that is not open.
pub(crate) fn persist_dirty(
    map_id: &str,
    delta_data: Option<Vec<u8>>,
    alive: usize,
    pending: CommitDiff,
    tags_json: Option<String>,
) -> AppResult<()> {
    if let Some(delta_data) = delta_data {
        let path = storage::arrow_delta_path(map_id)?;
        storage::atomic_write_bytes(&path, &delta_data)?;
    }
    let conn = storage::open_db()?;
    storage::set_map_counts(&conn, map_id, alive, pending)?;
    if let Some(tags_json) = tags_json {
        conn.execute(
            "UPDATE maps SET tags = ?1 WHERE id = ?2",
            rusqlite::params![tags_json, map_id],
        )?;
    }
    Ok(())
}

fn stack_code(stack: Stack) -> i64 {
    match stack {
        Stack::Undo => 0,
        Stack::Redo => 1,
    }
}

/// Bring the stored history in line with the stacks: store edits it lacks, move the ones
/// that changed stack, drop the ones the stacks no longer hold. An edit is serialized
/// once, when first stored.
pub(crate) fn save_edit_history(
    conn: &Connection,
    map_id: &str,
    edits: &EditStacks,
) -> AppResult<()> {
    let stored: HashMap<u64, i64> = conn
        .prepare("SELECT seq, stack FROM edit_entries WHERE map_id = ?1")?
        .query_map([map_id], |r| Ok((r.get::<_, i64>(0)? as u64, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let tx = conn.unchecked_transaction()?;
    let mut live = HashSet::with_capacity(edits.undo_len() + edits.redo_len());
    for (stack, edit) in edits.iter() {
        live.insert(edit.seq);
        let stack = stack_code(stack);
        match (stored.get(&edit.seq), &edit.entry) {
            (Some(&at), _) if at == stack => {}
            (Some(_), _) => {
                tx.prepare_cached(
                    "UPDATE edit_entries SET stack = ?3 WHERE map_id = ?1 AND seq = ?2",
                )?
                .execute(rusqlite::params![map_id, edit.seq as i64, stack])?;
            }
            (None, Some(entry)) => {
                tx.prepare_cached(
                    "INSERT INTO edit_entries (map_id, seq, stack, max_id, entry) VALUES (?1, ?2, ?3, ?4, ?5)",
                )?
                .execute(rusqlite::params![
                    map_id,
                    edit.seq as i64,
                    stack,
                    entry.max_id(),
                    rmp_serde::to_vec_named(&**entry)?
                ])?;
            }
            (None, None) => log::warn!(
                "[save_edit_history] {map_id} edit {} is on no disk",
                edit.seq
            ),
        }
    }
    for seq in stored.keys().filter(|seq| !live.contains(seq)) {
        tx.prepare_cached("DELETE FROM edit_entries WHERE map_id = ?1 AND seq = ?2")?
            .execute(rusqlite::params![map_id, *seq as i64])?;
    }
    tx.commit()?;
    Ok(())
}

/// The stored undo/redo stacks, without reading any edit: each is fetched with
/// [`load_edit`] when undo or redo first reaches it.
pub(crate) fn load_edit_history(conn: &Connection, map_id: &str) -> AppResult<EditStacks> {
    let rows = conn
        .prepare("SELECT seq, stack FROM edit_entries WHERE map_id = ?1")?
        .query_map([map_id], |r| {
            let stack = if r.get::<_, i64>(1)? == stack_code(Stack::Redo) {
                Stack::Redo
            } else {
                Stack::Undo
            };
            Ok((r.get::<_, i64>(0)? as u64, stack))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    log::debug!("[load_edit_history] {map_id} {} edits on disk", rows.len());
    Ok(EditStacks::on_disk(rows))
}

/// One stored edit.
pub(crate) fn load_edit(conn: &Connection, map_id: &str, seq: u64) -> AppResult<EditEntry> {
    let bytes: Vec<u8> = conn.query_row(
        "SELECT entry FROM edit_entries WHERE map_id = ?1 AND seq = ?2",
        rusqlite::params![map_id, seq as i64],
        |r| r.get(0),
    )?;
    Ok(rmp_serde::from_slice(&bytes)?)
}

/// Highest location id the stored history can re-materialize, without reading it.
pub(crate) fn stored_history_max_id(conn: &Connection, map_id: &str) -> AppResult<u32> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(max_id), 0) FROM edit_entries WHERE map_id = ?1",
        [map_id],
        |r| r.get(0),
    )?)
}

/// Bake the overlay into the base, write it to `path`, and only then adopt it, clear the
/// overlay, drop the stale delta file, and re-mmap. A failed write leaves the store as it was.
pub(crate) fn write_baked_base(store: &mut Store, path: &Path, delta_path: &Path) -> AppResult<()> {
    let _t = Instant::now();
    let Some(batch) = store.current_batch() else {
        return Ok(());
    };
    let t_bake = _t.elapsed();
    arrow::write_arrow_ipc(path, &batch)?;
    let t_write = _t.elapsed();
    store.adopt_base(batch);
    let _ = fs::remove_file(delta_path);
    let (batch, handle) = arrow::read_arrow_ipc_mmap(path)?;
    store.batch = Some(batch);
    store.mmap_handle = Some(handle);
    log::debug!(
        "[write_baked_base] bake={:.0}ms base-write={:.0}ms remmap={:.0}ms",
        t_bake.as_millis(),
        (t_write - t_bake).as_millis(),
        (_t.elapsed() - t_write).as_millis()
    );
    Ok(())
}

/// Write the baked base for `store_commit` and flush the location count.
pub(crate) fn bake_and_save(store: &mut Store, map_id: &str) -> AppResult<()> {
    write_baked_base(
        store,
        &storage::arrow_path(map_id)?,
        &storage::arrow_delta_path(map_id)?,
    )?;
    let count = store.batch.as_ref().map_or(0, RecordBatch::num_rows);
    let conn = storage::open_db()?;
    storage::set_map_counts(&conn, map_id, count, CommitDiff::default())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tag value records: the `maps.tags` JSON column
// ---------------------------------------------------------------------------
// The disk home of the `tags` field's interned-value records (`values.rs`). The engine's
// data-side tag concept is only the id-list column on locations; the piles live here.
// The format is the legacy per-tag object (`{"<id>": {name, color, ...}}`), so old maps
// read as-is; `id` and `visible` inside the objects are legacy keys - identity is the
// map key and visibility is derived - stripped on read, `id` re-injected on write so
// older builds still parse the column.

/// Load the tag records from the SQLite `maps.tags` JSON column.
pub(crate) fn read_tags_json(conn: &Connection, map_id: &str) -> HashMap<u32, ValueRecord> {
    let json: String = conn
        .query_row("SELECT tags FROM maps WHERE id = ?1", [map_id], |row| {
            row.get(0)
        })
        .unwrap_or_else(|_| "{}".into());
    let raw: HashMap<String, ValueRecord> = serde_json::from_str(&json).unwrap_or_default();
    raw.into_iter()
        .filter_map(|(k, mut rec)| {
            rec.remove("id");
            rec.remove("visible");
            k.parse::<u32>().ok().map(|id| (id, rec))
        })
        .collect()
}

/// Serialize tag records to JSON with string keys (SQLite stores them this way).
pub(crate) fn serialize_tags_json(tags: &HashMap<u32, ValueRecord>) -> String {
    let as_str_keys: HashMap<String, ValueRecord> = tags
        .iter()
        .map(|(k, v)| {
            let mut rec = v.clone();
            rec.insert("id".into(), (*k).into());
            (k.to_string(), rec)
        })
        .collect();
    serde_json::to_string(&as_str_keys).unwrap_or_default()
}

/// Persist tag records to the SQLite `maps.tags` JSON column.
pub(crate) fn write_tags_json(
    conn: &Connection,
    map_id: &str,
    tags: &HashMap<u32, ValueRecord>,
) -> AppResult<()> {
    let json = serialize_tags_json(tags);
    conn.execute(
        "UPDATE maps SET tags = ?1 WHERE id = ?2",
        rusqlite::params![json, map_id],
    )?;
    Ok(())
}
