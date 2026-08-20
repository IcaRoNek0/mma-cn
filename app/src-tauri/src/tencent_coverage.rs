use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

const ARCHIVE_NAME: &str = "tencent-lines.pmtiles";
const MAX_RANGE_LENGTH: usize = 16 * 1024 * 1024;

fn archive_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(configured) = std::env::var("MMA_TENCENT_COVERAGE_PATH") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Ok(path);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join(ARCHIVE_NAME);
        if path.is_file() {
            return Ok(path);
        }
    }

    // `tauri build --no-bundle` runs directly from target/, so use the vendored
    // project asset when no installed resource directory exists.
    let project_asset = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(ARCHIVE_NAME);
    if project_asset.is_file() {
        return Ok(project_asset);
    }

    Err(format!(
        "local Tencent coverage archive not found: {ARCHIVE_NAME}"
    ))
}

fn range_params(query: &str) -> Result<(u64, usize), String> {
    let value = |name: &str| {
        query
            .split('&')
            .filter_map(|part| part.split_once('='))
            .find_map(|(key, value)| (key == name).then_some(value))
    };
    let offset = value("offset")
        .ok_or_else(|| "missing offset".to_string())?
        .parse::<u64>()
        .map_err(|_| "invalid offset".to_string())?;
    let length = value("length")
        .ok_or_else(|| "missing length".to_string())?
        .parse::<usize>()
        .map_err(|_| "invalid length".to_string())?;
    if length == 0 || length > MAX_RANGE_LENGTH {
        return Err(format!("invalid range length: {length}"));
    }
    Ok((offset, length))
}

pub(crate) fn response<R: Runtime>(
    app: &AppHandle<R>,
    query: &str,
) -> tauri::http::Response<Vec<u8>> {
    let result = (|| {
        let (offset, length) = range_params(query)?;
        let path = archive_path(app)?;
        let file_length = path.metadata().map_err(|error| error.to_string())?.len();
        let end = offset
            .checked_add(length as u64)
            .ok_or_else(|| "range overflow".to_string())?;
        if end > file_length {
            return Err(format!(
                "range {offset}..{end} exceeds archive length {file_length}"
            ));
        }

        let mut file = File::open(path).map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
        let mut data = vec![0; length];
        file.read_exact(&mut data)
            .map_err(|error| error.to_string())?;
        Ok(data)
    })();

    match result {
        Ok(data) => tauri::http::Response::builder()
            .header("Access-Control-Allow-Origin", "*")
            .header("Content-Type", "application/octet-stream")
            .body(data)
            .unwrap(),
        Err(error) => tauri::http::Response::builder()
            .status(416)
            .header("Access-Control-Allow-Origin", "*")
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(error.into_bytes())
            .unwrap(),
    }
}

#[cfg(test)]
mod tests {
    use super::range_params;

    #[test]
    fn parses_bounded_ranges() {
        assert_eq!(
            range_params("offset=127&length=16384").unwrap(),
            (127, 16384)
        );
        assert!(range_params("offset=0&length=0").is_err());
    }
}
