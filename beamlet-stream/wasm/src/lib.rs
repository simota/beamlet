//! Raw C-ABI exports over linear memory, consumed by the pages in `web/`
//! with no generated bindings. The browser is single-threaded here, so
//! module state lives in thread-locals. `lab_*` serve `lab.html`; the
//! send/receive exports live in `app`.

mod app;

use std::cell::RefCell;

use beamlet_stream::lab::Analyzer;
use beamlet_stream::layout::Layout;
use beamlet_stream::params::{self, Params};
use beamlet_stream::render::{self, Rgb};
use beamlet_stream::sample::Metric;

struct Lab {
    params: Params,
    layout: Layout,
    palette: Vec<[u8; 3]>,
    analyzer: Analyzer,
    frame: Rgba,
    input: Vec<u8>,
    report: String,
}

#[derive(Default)]
struct Rgba {
    w: u32,
    h: u32,
    px: Vec<u8>,
}

thread_local! {
    static LAB: RefCell<Option<Lab>> = const { RefCell::new(None) };
}

fn with_lab<T>(f: impl FnOnce(&mut Lab) -> T) -> T {
    LAB.with_borrow_mut(|lab| f(lab.as_mut().expect("lab_init must be called first")))
}

/// Start a lab session for mode `mode` (index into stable, compact, standard,
/// fast, fastest). Returns tiles per frame, or -1 for an invalid configuration.
#[no_mangle]
pub extern "C" fn lab_init(mode: u32, seed: u32, frames: u32) -> i32 {
    let Some(name) = params::mode_names().nth(mode as usize) else { return -1 };
    let Ok(mut p) = Params::mode(name) else { return -1 };
    p.seed = seed as u64;
    p.frames = frames as usize;
    let (Ok(palette), Ok(analyzer)) = (p.palette(), Analyzer::new(p.clone(), Metric::Rgb)) else { return -1 };
    let tiles = analyzer.tiles_per_frame() as i32;
    let layout = Layout::new(&p);
    LAB.with_borrow_mut(|lab| {
        *lab = Some(Lab { params: p, layout, palette, analyzer, frame: Rgba::default(), input: Vec::new(), report: String::new() })
    });
    tiles
}

/// Render frame `frame` at `cell_px` pixels per cell as RGBA; size via
/// `lab_frame_width` / `lab_frame_height`.
#[no_mangle]
pub extern "C" fn lab_render(frame: u32, cell_px: u32) -> *const u8 {
    with_lab(|lab| {
        let p = &lab.params;
        let cells = render::frame_cells(&lab.layout, &lab.palette, p.bpc, p.seed, frame as u64);
        let rgb = render::rasterize(&cells, p.w, p.h, cell_px as usize);
        lab.frame = Rgba {
            w: rgb.w as u32,
            h: rgb.h as u32,
            px: rgb.px.as_chunks::<3>().0.iter().flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        };
        lab.frame.px.as_ptr()
    })
}

#[no_mangle]
pub extern "C" fn lab_frame_width() -> u32 {
    with_lab(|lab| lab.frame.w)
}

#[no_mangle]
pub extern "C" fn lab_frame_height() -> u32 {
    with_lab(|lab| lab.frame.h)
}

/// Buffer of `len` bytes for the caller to write an RGBA capture into
/// before `lab_push`. Valid until the next call that may grow memory.
#[no_mangle]
pub extern "C" fn lab_input(len: u32) -> *mut u8 {
    with_lab(|lab| {
        lab.input.resize(len as usize, 0);
        lab.input.as_mut_ptr()
    })
}

/// Score the w×h RGBA capture in the input buffer. Returns decodable
/// tiles, or -1 when no frame was found.
#[no_mangle]
pub extern "C" fn lab_push(w: u32, h: u32) -> i32 {
    with_lab(|lab| {
        let px: Vec<u8> = lab.input.as_chunks::<4>().0.iter().flat_map(|c| [c[0], c[1], c[2]]).collect();
        let img = Rgb { w: w as usize, h: h as usize, px };
        lab.analyzer.push(&img).map_or(-1, |ok| ok as i32)
    })
}

#[no_mangle]
pub extern "C" fn lab_record_time(millis: f64) {
    with_lab(|lab| lab.analyzer.record_time(millis))
}

/// Text report as UTF-8; length via `lab_report_len`.
#[no_mangle]
pub extern "C" fn lab_report(capture_fps: f64) -> *const u8 {
    with_lab(|lab| {
        lab.report = lab.analyzer.report(capture_fps);
        lab.report.as_ptr()
    })
}

#[no_mangle]
pub extern "C" fn lab_report_len() -> u32 {
    with_lab(|lab| lab.report.len() as u32)
}
