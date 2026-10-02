use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use tokio::sync::Semaphore;

/// Panos asked of the app at once. The app paces the tile requests behind them.
const CONCURRENCY: usize = 16;
const FETCH_ZOOM: u32 = 2;

static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

fn runtime() -> &'static tokio::runtime::Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("failed to build tokio runtime")
    })
}

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .pool_max_idle_per_host(CONCURRENCY)
            .build()
            .unwrap()
    })
}

/// Where the app serves its schemes to this process.
fn app_base() -> Result<&'static str, String> {
    static BASE: OnceLock<Option<String>> = OnceLock::new();
    BASE.get_or_init(|| std::env::var("MMA_SCHEMES").ok())
        .as_deref()
        .ok_or_else(|| "this sidecar needs a newer MMA to fetch imagery".to_string())
}

/// The whole pano at [`FETCH_ZOOM`], stitched and cropped by the app. The app fails a pano
/// with any missing tile, so a partly black one is never embedded.
async fn fetch_pano(cl: &reqwest::Client, pano_id: &str) -> Result<image::RgbImage, String> {
    let url = format!("{}/pano/{pano_id}/{FETCH_ZOOM}", app_base()?);
    let resp = cl.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let jpeg = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(image::load_from_memory(&jpeg)
        .map_err(|e| format!("pano decode failed: {e}"))?
        .to_rgb8())
}

/// Fetch panos concurrently, keyed by pano id.
pub fn fetch_panos_concurrent(pano_ids: &[&str]) -> HashMap<String, Result<image::RgbImage, String>> {
    let rt = runtime();
    let cl = client();
    let sem = Arc::new(Semaphore::new(CONCURRENCY));

    rt.block_on(async {
        let mut handles = Vec::with_capacity(pano_ids.len());
        for &pid in pano_ids {
            let sem = sem.clone();
            let pid = pid.to_string();
            handles.push(tokio::spawn(async move {
                let result = match sem.acquire().await {
                    Ok(_permit) => fetch_pano(cl, &pid).await,
                    Err(e) => Err(e.to_string()),
                };
                (pid, result)
            }));
        }

        let mut results = HashMap::with_capacity(pano_ids.len());
        for handle in handles {
            if let Ok((pid, result)) = handle.await {
                results.insert(pid, result);
            }
        }
        results
    })
}
