# Large-map operations (2026-10-15)

The existing base Arrow snapshots remain uncompressed and memory mapped. New
uncommitted delta files and undo-history blobs use standard Arrow IPC LZ4 frames.
The updated app reads both plain and compressed data. Older app builds without
Arrow LZ4 support cannot read newly saved compressed deltas/history; keep a backup
before opening a working library with an older build.

Panoid duplicate previews scan IDs in Rust and return only counts to the UI.
Merging materializes only duplicate rows, unions their tags, and creates one undo
entry. Automatic tagging scans in Rust, interns distinct tag names once, skips
unchanged locations, and applies a single undoable mutation. Bulk edits still
require memory for changed rows and undo data.

## Synthetic measurements

Apple Silicon Mac, test profile (not a release benchmark), one million rows:

| Operation | Result |
| --- | --- |
| Panoid duplicate preview | 810 ms |
| Plain delta encoding | 193,253,690 bytes; 85 ms encode, 14 ms decode |
| LZ4 delta encoding | 57,924,794 bytes; 73 ms encode, 57 ms decode |

The fixture has repeated metadata, tags, and randomized coordinates/IDs. The
approximately 70% disk reduction concerns this delta fixture, not the complete
library. Compression adds read CPU cost; actual maps and hardware will differ.
No improvement to base-map opening/rendering speed is claimed from compression.

Reproduce with the ignored Rust tests `million_pano_duplicate_scan_benchmark`
and `benchmark_capture_delta_compression`, passing `--ignored --nocapture`.
The latter accepts `MMA_STORAGE_BENCH_ROWS` (default 1,000,000).
