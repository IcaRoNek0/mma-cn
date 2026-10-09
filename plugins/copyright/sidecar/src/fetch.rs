use std::sync::{Arc, OnceLock};
use tokio::sync::Semaphore;

/// Tiles asked of the app at once. The app paces the requests that reach Google.
const CONCURRENCY: usize = 64;

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

async fn fetch_tile(cl: &reqwest::Client, job: &TileJob) -> Result<Vec<u8>, String> {
    let url = format!("{}/pano/{}/{}/{}/{}", app_base()?, job.pano_id, job.zoom, job.x, job.y);
    let resp = cl.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
}

/// One tile request; workers route the result by zoom (5 = fixed-spot rung, 4 = band cell).
pub struct TileJob {
    pub pano_id: String,
    pub zoom: u32,
    pub x: u32,
    pub y: u32,
}

pub type TileResult = (TileJob, Result<Vec<u8>, String>);

/// Handle for enqueueing tile fetches; dropping every clone (after the queue drains)
/// closes the result channel.
#[derive(Clone)]
pub struct JobSender(tokio::sync::mpsc::UnboundedSender<TileJob>);

impl JobSender {
    pub fn send(&self, job: TileJob) {
        let _ = self.0.send(job);
    }
}

/// Streaming fetch pump: jobs go in at any time, each result comes out the moment its
/// fetch completes. Lets escalation fetches overlap classification with no phase barrier.
pub fn start_fetcher() -> (JobSender, std::sync::mpsc::Receiver<TileResult>) {
    let rt = runtime();
    let cl = client();
    let sem = Arc::new(Semaphore::new(CONCURRENCY));
    let (job_tx, mut job_rx) = tokio::sync::mpsc::unbounded_channel::<TileJob>();
    let (res_tx, res_rx) = std::sync::mpsc::channel::<TileResult>();

    rt.spawn(async move {
        let mut set = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                job = job_rx.recv() => match job {
                    Some(job) => {
                        let sem = sem.clone();
                        let res_tx = res_tx.clone();
                        set.spawn(async move {
                            let result = match sem.acquire().await {
                                Ok(_permit) => fetch_tile(cl, &job).await,
                                Err(e) => Err(e.to_string()),
                            };
                            let _ = res_tx.send((job, result));
                        });
                    }
                    None => break,
                },
                Some(_) = set.join_next(), if !set.is_empty() => {}
            }
        }
        while set.join_next().await.is_some() {}
    });
    (JobSender(job_tx), res_rx)
}
