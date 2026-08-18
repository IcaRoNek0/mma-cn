use crate::types::{AppError, AppResult};
use crate::{storage, sync_client};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Mutex;

const COVERAGE_URL: &str = "https://qq-map.netlify.app/lines.pmtiles";
const MIN_PMTILES_SIZE: u64 = 16_384;
const MAX_RANGE_LENGTH: u32 = 32 * 1024 * 1024;

static CACHE_LOCK: Mutex<()> = Mutex::new(());

fn cache_path() -> AppResult<PathBuf> {
    Ok(storage::app_data_dir()?
        .join("cache")
        .join("tencent-lines.pmtiles"))
}

fn cache_is_ready(path: &std::path::Path) -> bool {
    path.metadata()
        .is_ok_and(|metadata| metadata.len() >= MIN_PMTILES_SIZE)
}

pub(crate) fn ensure_cache() -> AppResult<PathBuf> {
    let path = cache_path()?;
    if cache_is_ready(&path) {
        return Ok(path);
    }

    let _guard = CACHE_LOCK.lock()?;
    if cache_is_ready(&path) {
        return Ok(path);
    }

    let parent = path
        .parent()
        .ok_or_else(|| AppError("Tencent coverage cache path has no parent".into()))?;
    std::fs::create_dir_all(parent)?;
    let temporary = path.with_extension("pmtiles.download");
    let mut response = sync_client().get(COVERAGE_URL).send()?.error_for_status()?;
    let expected = response.content_length();
    let mut file = std::fs::File::create(&temporary)?;
    let written = std::io::copy(&mut response, &mut file)?;
    file.flush()?;
    if written < MIN_PMTILES_SIZE || expected.is_some_and(|size| size != written) {
        let _ = std::fs::remove_file(&temporary);
        return Err(AppError(format!(
            "Tencent coverage download is incomplete: wrote {written} bytes, expected {expected:?}"
        )));
    }
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    std::fs::rename(&temporary, &path)?;
    log::info!(
        "[tencent-coverage] cached {written} bytes at {}",
        path.display()
    );
    Ok(path)
}

fn read_range(offset: u64, length: u32) -> AppResult<Vec<u8>> {
    if length > MAX_RANGE_LENGTH {
        return Err(AppError(format!(
            "Tencent coverage range is too large: {length} bytes"
        )));
    }
    let path = cache_path()?;
    if !cache_is_ready(&path) {
        return Err(AppError("Tencent coverage cache is not ready".into()));
    }
    let mut file = std::fs::File::open(path)?;
    let file_len = file.metadata()?.len();
    if offset > file_len || offset.saturating_add(length as u64) > file_len {
        return Err(AppError(format!(
            "Tencent coverage range {offset}..{} exceeds file length {file_len}",
            offset.saturating_add(length as u64)
        )));
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut bytes = vec![0; length as usize];
    file.read_exact(&mut bytes)?;
    Ok(bytes)
}

#[tauri::command]
#[specta::specta]
pub fn tencent_coverage_is_cached() -> AppResult<bool> {
    Ok(cache_is_ready(&cache_path()?))
}

/// Download the Tencent PMTiles archive if it is not already cached.
#[tauri::command]
#[specta::specta]
pub async fn tencent_coverage_prepare() -> AppResult<()> {
    tokio::task::spawn_blocking(ensure_cache).await??;
    Ok(())
}

/// Read one byte range from a locally cached copy of the Tencent coverage archive.
#[tauri::command]
#[specta::specta]
pub async fn tencent_coverage_read(offset: u64, length: u32) -> AppResult<Vec<u8>> {
    tokio::task::spawn_blocking(move || read_range(offset, length)).await?
}
