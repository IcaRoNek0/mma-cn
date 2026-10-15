//! Provider-ID operations stay in the engine, avoiding per-location IPC.
use super::*;
use crate::selections::RowRef;
use chrono::{Datelike, NaiveDate, NaiveDateTime};
use std::collections::BTreeSet;

#[derive(serde::Deserialize, specta::Type, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AutoTagOptions {
    pub source: bool,
    pub vehicle: bool,
    pub year: bool,
    pub season: bool,
    pub month: bool,
}

#[derive(serde::Serialize, specta::Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct PanoDuplicateSummary {
    pub groups: u32,
    pub removed: u32,
}

fn capture_date(id: &str, source: &str) -> Option<NaiveDateTime> {
    let start = match source {
        "baidu_pano" => 10,
        "qq_pano" | "qq_trekker" => 8,
        _ => return None,
    };
    let stamp = id.get(start..start + 12)?;
    if !stamp.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let part = |a, b| stamp.get(a..b)?.parse::<u32>().ok();
    NaiveDate::from_ymd_opt(2000 + part(0, 2)? as i32, part(2, 4)?, part(4, 6)?)?.and_hms_opt(
        part(6, 8)?,
        part(8, 10)?,
        part(10, 12)?,
    )
}

fn valid_vehicle_id(id: &str, source: &str) -> bool {
    match source {
        "baidu_pano" => {
            id.len() == 27
                && id.as_bytes()[..26].iter().all(u8::is_ascii_digit)
                && id.as_bytes()[26].is_ascii_alphabetic()
        }
        "qq_pano" | "qq_trekker" => id.len() == 23 && id.bytes().all(|b| b.is_ascii_digit()),
        _ => false,
    }
}

fn vehicle(id: &str, source: &str) -> Option<String> {
    if !valid_vehicle_id(id, source) {
        return None;
    }
    if source == "baidu_pano" {
        Some(format!(
            "{}_{}_{}",
            id.get(..3)?,
            id.get(5..9)?,
            id.get(id.len().checked_sub(2)?..)?
        ))
    } else {
        Some(format!("{}-{}车", id.get(..4)?, id.get(5..8)?))
    }
}

fn names(row: &RowRef<'_, '_>, options: &AutoTagOptions) -> Vec<String> {
    let source = row.resolve_field("source");
    let source = source.as_ref().and_then(|v| v.as_str()).unwrap_or("");
    let mut names = Vec::with_capacity(5);
    if options.source && !source.is_empty() {
        names.push(source.to_owned());
    }
    let Some(id) = row.pano_id().filter(|id| !id.is_empty()) else {
        return names;
    };
    // Older imports can omit source while retaining a complete provider ID.
    let source = if source.is_empty() {
        if valid_vehicle_id(id, "baidu_pano") {
            "baidu_pano"
        } else if valid_vehicle_id(id, "qq_pano") {
            "qq_pano"
        } else {
            source
        }
    } else {
        source
    };
    if options.vehicle {
        names.extend(vehicle(id, source));
    }
    if options.year || options.month || options.season {
        if let Some(date) = capture_date(id, source) {
            let (year, month) = (date.year(), date.month());
            if options.year {
                names.push(format!("{year}年"));
            }
            if options.month {
                names.push(format!("{year}年{month}月"));
            }
            if options.season {
                let season = match month {
                    3..=5 => "春季",
                    6..=8 => "夏季",
                    9..=11 => "秋季",
                    _ => "冬季",
                };
                names.push(format!("{year}年{season}"));
            }
        }
    }
    names
}

impl Store {
    pub(crate) fn pano_duplicate_groups(&self) -> Vec<Vec<u32>> {
        // Store only IDs while scanning: materialize full rows only for actual duplicates.
        let mut groups: HashMap<compact_str::CompactString, (u32, Vec<u32>)> = HashMap::new();
        for row in self.all().rows() {
            if let Some(id) = row.pano_id().filter(|s| !s.trim().is_empty()) {
                match groups.entry(id.into()) {
                    std::collections::hash_map::Entry::Vacant(v) => {
                        v.insert((row.id(), Vec::new()));
                    }
                    std::collections::hash_map::Entry::Occupied(mut o) => {
                        o.get_mut().1.push(row.id());
                    }
                }
            }
        }
        let mut groups: Vec<_> = groups
            .into_values()
            .filter(|(_, rest)| !rest.is_empty())
            .map(|(first, mut rest)| {
                rest.push(first);
                rest.sort_unstable();
                rest
            })
            .collect();
        groups.sort_unstable_by_key(|g| g[0]);
        groups
    }

    pub(crate) fn pano_duplicate_summary(&self) -> PanoDuplicateSummary {
        let mut counts: HashMap<compact_str::CompactString, u32> = HashMap::new();
        let mut summary = PanoDuplicateSummary::default();
        for row in self.all().rows() {
            if let Some(id) = row.pano_id().filter(|s| !s.trim().is_empty()) {
                let count = counts.entry(id.into()).or_default();
                if *count == 1 {
                    summary.groups += 1;
                }
                if *count > 0 {
                    summary.removed += 1;
                }
                *count += 1;
            }
        }
        summary
    }

    pub(crate) fn merge_pano_duplicates(
        &mut self,
        score: Option<&str>,
    ) -> AppResult<MutationResult> {
        let score = selections::parse_duplicate_score(score)?;
        let groups = self.pano_duplicate_groups();
        let mut remove = Vec::new();
        let mut create = Vec::with_capacity(groups.len());
        for group in groups {
            let members: Vec<_> = group
                .into_iter()
                .filter_map(|id| self.get_loc_by_id(id))
                .collect();
            create.push(merge_group(&members, &score));
            remove.extend(members);
        }
        Ok(self.apply_undoable(remove, create))
    }

    pub(crate) fn auto_tag(&mut self, options: &AutoTagOptions) -> AppResult<MutationResult> {
        // Two narrow scans keep only the distinct names in memory, rather than an
        // N-row tag plan. Interning once avoids repeated metadata writes/lookups.
        let unique: BTreeSet<String> = self.all().rows().flat_map(|r| names(&r, options)).collect();
        let seeds: Vec<ValueRecord> = unique
            .iter()
            .map(|name| {
                let mut seed = ValueRecord::new();
                seed.insert("name".into(), name.clone().into());
                seed.insert("color".into(), util::color_for_name(name).into());
                seed
            })
            .collect();
        let ids = self.intern("tags", &seeds)?;
        let lookup: HashMap<_, _> = unique.into_iter().zip(ids).collect();
        let mut remove = Vec::new();
        let mut create = Vec::new();
        for row in self.all().rows() {
            let existing = row.tags();
            let additions: Vec<_> = names(&row, options)
                .iter()
                .filter_map(|n| lookup.get(n).copied())
                .filter(|id| !existing.contains(id))
                .collect();
            if additions.is_empty() {
                continue;
            }
            let old = row.to_location();
            let mut new = old.clone();
            new.tags.extend(additions);
            new.modified_at = Some(util::now_unix());
            remove.push(old);
            create.push(new);
        }
        self.persist_value_meta("tags");
        Ok(self.apply_undoable(remove, create))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Timelike;
    #[test]
    fn time_tags_use_calendar_seasons_and_handle_old_imports() {
        let options = AutoTagOptions {
            year: true,
            season: true,
            month: true,
            ..Default::default()
        };
        for (month, season) in [
            (1, "冬季"),
            (2, "冬季"),
            (3, "春季"),
            (5, "春季"),
            (6, "夏季"),
            (8, "夏季"),
            (9, "秋季"),
            (11, "秋季"),
            (12, "冬季"),
        ] {
            let mut row = crate::test_util::loc(1, 30.0, 120.0);
            row.pano_id = Some(format!("1409113414{month:02}01113614900").into());
            assert_eq!(
                names(&RowRef::from_loc(&row), &options),
                vec![
                    "2014年".to_owned(),
                    format!("2014年{month}月"),
                    format!("2014年{season}")
                ]
            );
        }
        let mut row = crate::test_util::loc(1, 30.0, 120.0);
        row.pano_id = Some("invalid".into());
        assert!(names(&RowRef::from_loc(&row), &options).is_empty());
    }

    #[test]
    fn encoded_capture_and_vehicle() {
        let cases = [
            (
                "14091134140630113614900",
                "qq_pano",
                (2014, 6, 30, 11, 36, 14),
                "1409-134车",
            ),
            (
                "09002000001407311630507506T",
                "baidu_pano",
                (2014, 7, 31, 16, 30, 50),
                "090_0000_6T",
            ),
        ];
        for (id, source, expected, car) in cases {
            let d = capture_date(id, source).unwrap();
            assert_eq!(
                (
                    d.year(),
                    d.month(),
                    d.day(),
                    d.hour(),
                    d.minute(),
                    d.second()
                ),
                expected
            );
            assert_eq!(vehicle(id, source).as_deref(), Some(car));
        }
        assert!(capture_date("14091134140230113614900", "qq_pano").is_none());
        assert!(capture_date("invalid", "qq_pano").is_none());
        assert_eq!(
            vehicle("14091134140230113614900", "qq_pano").as_deref(),
            Some("1409-134车")
        );
        assert_eq!(
            vehicle("09002000001402311630507506T", "baidu_pano").as_deref(),
            Some("090_0000_6T")
        );
        assert!(vehicle("invalid", "qq_pano").is_none());
    }
}
