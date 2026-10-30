//! Ground-truth scoring for lab streams, whose tiles are regenerated from
//! the seed instead of being decoded: cell error rate, tile loss and
//! effective throughput.

use std::collections::HashSet;

use crate::detect;
use crate::layout::Layout;
use crate::params::Params;
use crate::render::{self, Rgb};
use crate::sample::{self, Classifier, Metric};

/// Per-capture-frame record, written to the optional CSV.
pub struct FrameLog {
    pub detected: bool,
    pub tiles_ok: usize,
    pub cell_errors: usize,
    pub cells: usize,
    /// Displayed frame (absolute, i.e. counting player loops) most decoded tiles came from.
    pub frame: Option<i64>,
    pub millis: f64,
}

#[derive(Default)]
pub struct Stats {
    pub captures: usize,
    pub detected: usize,
    pub tiles_seen: usize,
    pub tiles_ok: usize,
    pub cells: usize,
    pub cell_errors: usize,
    /// Captures whose decodable tiles came from two or more displayed frames (rolling-shutter tearing).
    pub mixed: usize,
    /// Distinct (displayed frame, tile) pairs that decoded — what a real stream would have received.
    pub unique_ok: HashSet<(i64, usize)>,
    pub seconds: f64,
}

pub struct Analyzer {
    params: Params,
    layout: Layout,
    metric: Metric,
    /// Displayed frame the last capture decoded, so the next capture only
    /// has to try its neighbours.
    sync: Option<i64>,
    last_frame: i64,
    pub stats: Stats,
    pub log: Vec<FrameLog>,
}

impl Analyzer {
    pub fn new(params: Params, metric: Metric) -> Result<Analyzer, String> {
        params.validate()?;
        let layout = Layout::new(&params);
        Ok(Analyzer { params, layout, metric, sync: None, last_frame: 0, stats: Stats::default(), log: Vec::new() })
    }

    /// Score one capture. Returns the decodable tile count, or None when
    /// the frame was not found.
    pub fn push(&mut self, img: &Rgb) -> Option<usize> {
        self.stats.captures += 1;
        let entry = self.decode(img);
        let result = entry.detected.then_some(entry.tiles_ok);
        self.log.push(entry);
        result
    }

    /// Wall time the caller spent in `push` for the latest capture; timing
    /// stays with the caller because WebAssembly has no monotonic clock.
    pub fn record_time(&mut self, millis: f64) {
        self.stats.seconds += millis / 1e3;
        if let Some(last) = self.log.last_mut() {
            last.millis = millis;
        }
    }

    pub fn tiles_per_frame(&self) -> usize {
        self.layout.tiles
    }

    fn decode(&mut self, img: &Rgb) -> FrameLog {
        let mut entry = FrameLog { detected: false, tiles_ok: 0, cell_errors: 0, cells: 0, frame: None, millis: 0.0 };
        let Some(grid) = detect::detect(img, &self.layout) else { return entry };
        entry.detected = true;
        self.stats.detected += 1;

        let (w, bpc) = (self.layout.w, self.params.bpc);
        let colors = sample::cell_colors(img, &grid, w, self.layout.h);
        let classifier = Classifier::calibrate(&colors, &self.layout, 1 << bpc, self.metric).refine(&colors, &self.layout);
        let n = self.params.frames as i64;
        let candidates: Vec<i64> = match self.sync {
            Some(a) => (a - 3..=a + 4).collect(),
            // Unsynchronised: every displayed frame, lifted to the loop that
            // keeps absolute frame numbers moving forward.
            None => (0..n).map(|f| f + n * ((self.last_frame - 2 - f).max(0) + n - 1).div_euclid(n)).collect(),
        };

        let cpt = self.layout.cells_per_tile;
        let mut ok_frames = Vec::new();
        for t in 0..self.layout.tiles {
            let cells = &self.layout.data[t * cpt..(t + 1) * cpt];
            let symbols: Vec<u8> = cells.iter().map(|&c| classifier.classify(colors[c], c / w)).collect();
            let bytes = render::symbols_to_bytes(&symbols, bpc, self.layout.tile_bytes);
            let truth_of = |a: i64| render::tile_bytes(self.params.seed, a.rem_euclid(n) as u64, t, self.layout.tile_bytes);
            let (frame, byte_errors) = candidates
                .iter()
                .map(|&a| (a, bytes.iter().zip(truth_of(a).iter()).filter(|(x, y)| x != y).count()))
                .min_by_key(|&(_, e)| e)
                .expect("candidate list is never empty");
            let truth = render::bytes_to_symbols(&truth_of(frame), bpc, cpt);
            let cell_errors = symbols.iter().zip(&truth).filter(|(a, b)| a != b).count();

            entry.cells += cpt;
            entry.cell_errors += cell_errors;
            if byte_errors <= self.params.correctable() {
                entry.tiles_ok += 1;
                self.stats.unique_ok.insert((frame, t));
                ok_frames.push(frame);
            }
        }
        self.stats.tiles_seen += self.layout.tiles;
        self.stats.tiles_ok += entry.tiles_ok;
        self.stats.cells += entry.cells;
        self.stats.cell_errors += entry.cell_errors;

        ok_frames.sort_unstable();
        // A capture with nothing decodable may mean the player jumped while
        // the camera looked away; search everything again next time.
        self.sync = ok_frames.get(ok_frames.len() / 2).copied();
        if let Some(f) = self.sync {
            self.last_frame = f;
            entry.frame = Some(f);
        }
        if ok_frames.first() != ok_frames.last() {
            self.stats.mixed += 1;
        }
        entry
    }

    pub fn report(&self, capture_fps: f64) -> String {
        let s = &self.stats;
        let p = &self.params;
        let pct = |a: usize, b: usize| if b == 0 { 0.0 } else { 100.0 * a as f64 / b as f64 };
        let duration = s.captures as f64 / capture_fps;
        let effective = s.unique_ok.len() as f64 * p.payload() as f64 / duration;
        let ideal = (self.layout.tiles * p.payload()) as f64 * p.fps as f64;
        format!(
            "grid {}x{} bpc={} parity={} display_fps={} palette={} metric={:?}\n\
             captures            {} ({:.1} s at {:.2} fps)\n\
             detected            {} ({:.1}%)\n\
             tiles decodable     {} / {} ({:.1}%)\n\
             cell error rate     {:.4}%\n\
             torn captures       {}\n\
             unique tiles        {}\n\
             effective payload   {:.1} KB/s\n\
             ideal payload       {:.1} KB/s (efficiency {:.1}%)\n\
             analysis time       {:.1} ms/frame (this machine)\n",
            p.w,
            p.h,
            p.bpc,
            p.parity,
            p.fps,
            p.palette,
            self.metric,
            s.captures,
            duration,
            capture_fps,
            s.detected,
            pct(s.detected, s.captures),
            s.tiles_ok,
            s.tiles_seen,
            pct(s.tiles_ok, s.tiles_seen),
            pct(s.cell_errors, s.cells),
            s.mixed,
            s.unique_ok.len(),
            effective / 1024.0,
            ideal / 1024.0,
            if ideal > 0.0 { 100.0 * effective / ideal } else { 0.0 },
            1e3 * s.seconds / s.captures.max(1) as f64,
        )
    }

    pub fn csv(&self) -> String {
        let mut out = String::from("capture,detected,frame,tiles_ok,tiles,cell_errors,cells,millis\n");
        for (i, e) in self.log.iter().enumerate() {
            out += &format!(
                "{i},{},{},{},{},{},{},{:.2}\n",
                e.detected as u8,
                e.frame.map_or(String::new(), |f| f.to_string()),
                e.tiles_ok,
                if e.detected { self.layout.tiles } else { 0 },
                e.cell_errors,
                e.cells,
                e.millis
            );
        }
        out
    }
}
