//! Reverse geocoding for location previews. China coordinates use Baidu's
//! detailed administrative response when available; GeoNames remains the
//! offline fallback for failures and locations outside Baidu's coverage.

use reverse_geocoder::{ReverseGeocoder, SearchResult};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

static GEOCODER: OnceLock<ReverseGeocoder> = OnceLock::new();

/// Returns the lazily-initialized global geocoder instance.
/// First call loads the full GeoNames dataset into a k-d tree; subsequent calls
/// are a pointer dereference.
fn get_geocoder() -> &'static ReverseGeocoder {
    GEOCODER.get_or_init(ReverseGeocoder::new)
}

/// Reverse geocode result: nearest populated place to a coordinate.
#[derive(Serialize, specta::Type)]
pub struct GeoResult {
    pub city: String,
    /// First-level administrative division (state, province, region).
    pub admin: String,
    pub country: String,
    /// ISO 3166-1 alpha-2 (e.g. "US", "FR").
    pub country_code: String,
    pub province: String,
    pub district: String,
    pub town: String,
    pub adcode: String,
    pub formatted_address: String,
}

impl From<&SearchResult<'_>> for GeoResult {
    fn from(r: &SearchResult<'_>) -> Self {
        Self {
            city: r.record.name.to_string(),
            admin: r.record.admin1.to_string(),
            country: r.record.cc.to_string(),
            country_code: r.record.cc.to_string(),
            province: r.record.admin1.to_string(),
            district: String::new(),
            town: String::new(),
            adcode: String::new(),
            formatted_address: String::new(),
        }
    }
}

// Keep the Baidu web request on the Rust side; credentials never enter the
// frontend command payload or logs.
const BAIDU_REVERSE_API: &str = "https://api.map.baidu.com/reverse_geocoding/v3/";
const BAIDU_AK: &str = "8z3RxyDq3sseF20zMZcBxkzhfTdAeSq7";
const BAIDU_COOKIE: &str = "BAIDUID=CD58DDB9E6DCAD38796DCE2F8016C43C:FG=1; ab_sr=1.0.1_ZTI4ZDhlYmNhNzFiNDE0ZmY3OTc1NmVkMGE3ODdiY2M5M2MyZTkyMzE5YjI5NzkwZDEzNjViZGYwZmEzMjI1ZjVkYTFiY2EwYzdmOGRhMDZhMWQzNTE3YjJhNzNiMmExYjA2MDIyNjAyNjdjMmZlZjc2OTkzNmRmZmE4ZTQyNmI5NjI2YWZmZGJmMDE3N2UyZDY0N2RiNGU1YmE0OTFhYQ==; DEFAULT_CITY=1; MCITY=-%3A; showLoginPopup=1";

#[derive(Default, Deserialize)]
struct BaiduAddressComponent {
    #[serde(default)]
    province: String,
    #[serde(default)]
    city: String,
    #[serde(default)]
    district: String,
    #[serde(default)]
    town: String,
    #[serde(default)]
    adcode: String,
}

#[derive(Deserialize)]
struct BaiduReverseResult {
    #[serde(rename = "addressComponent", alias = "address_component", default)]
    address_component: BaiduAddressComponent,
    #[serde(default)]
    formatted_address: String,
}

#[derive(Deserialize)]
struct BaiduReverseResponse {
    status: i32,
    result: Option<BaiduReverseResult>,
}

fn baidu_reverse_geocode(lat: f64, lng: f64) -> Option<GeoResult> {
    if !(72.0..=138.0).contains(&lng) || !(0.0..=56.0).contains(&lat) {
        return None;
    }
    let url = format!(
        "{BAIDU_REVERSE_API}?ak={BAIDU_AK}&location={lat},{lng}&coordtype=gcj02ll&output=json&radius=100&page_size=10&extensions_poi=0&res=webmap&pcevaname=pc4.1&newfrom=zhuzhan_webmap"
    );
    let response = crate::proxy_client()
        .get(url)
        .header("Referer", "https://map.baidu.com/")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36")
        .header("Cookie", BAIDU_COOKIE)
        .header("Accept", "application/json")
        .send()
        .ok()?
        .error_for_status()
        .ok()?;
    let data: BaiduReverseResponse = response.json().ok()?;
    if data.status != 0 {
        log::warn!(
            "[geocode] Baidu reverse geocode returned status {}",
            data.status
        );
        return None;
    }
    let result = data.result?;
    let c = result.address_component;
    let city = c.city.clone();
    let admin = if !c.province.is_empty() {
        c.province.clone()
    } else {
        city.clone()
    };
    Some(GeoResult {
        city,
        admin,
        country: "中国".into(),
        country_code: "CN".into(),
        province: c.province,
        district: c.district,
        town: c.town,
        adcode: c.adcode,
        formatted_address: result.formatted_address,
    })
}

/// Resolves a coordinate with Baidu for explicit China pano sources, then
/// falls back to the nearest GeoNames place. Always returns `Some`.
#[tauri::command]
#[specta::specta]
pub fn reverse_geocode(lat: f64, lng: f64, source: Option<String>) -> Option<GeoResult> {
    // Baidu's endpoint expects GCJ-02. Plain OSM locations stay WGS-84 and
    // therefore use the offline fallback instead of receiving a shifted query.
    let is_china_pano = matches!(source.as_deref(), Some("baidu_pano" | "qq_pano" | "qq_trekker"));
    if is_china_pano {
        if let Some(result) = baidu_reverse_geocode(lat, lng) {
            return Some(result);
        }
    }
    let gc = get_geocoder();
    let result = gc.search((lat, lng));
    Some(GeoResult::from(&result))
}
