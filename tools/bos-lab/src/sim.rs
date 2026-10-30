use std::path::Path;
use std::time::Instant;

use beamlet_stream::geom::Homography;
use beamlet_stream::lab::Analyzer;
use beamlet_stream::layout::Layout;
use beamlet_stream::params::Params;
use beamlet_stream::prng::SplitMix64;
use beamlet_stream::render::{self, Rgb};
use beamlet_stream::sample::Metric;

use crate::pngio;

pub fn timed_push(analyzer: &mut Analyzer, img: &Rgb) {
    let start = Instant::now();
    analyzer.push(img);
    analyzer.record_time(start.elapsed().as_secs_f64() * 1e3);
}

/// A synthetic camera: what the analyzer must survive before it is worth
/// pointing at a real one.
#[derive(Clone, Debug)]
pub struct Degrade {
    pub canvas: (usize, usize),
    /// Fraction of the canvas the frame fills along its tighter axis.
    pub fill: f64,
    /// Random corner displacement, as a fraction of the frame's shorter side.
    pub tilt: f64,
    pub rotate180: bool,
    /// Radial distortion k1 over the half-diagonal; positive is barrel.
    pub barrel: f64,
    pub gains: [f64; 3],
    pub gamma: f64,
    pub blur: f64,
    pub noise: f64,
    /// Rows above this fraction of the height come from the next frame (rolling-shutter tear).
    pub tear: Option<f64>,
}

impl Default for Degrade {
    fn default() -> Degrade {
        Degrade {
            canvas: (1920, 1080),
            fill: 0.8,
            tilt: 0.0,
            rotate180: false,
            barrel: 0.0,
            gains: [1.0; 3],
            gamma: 1.0,
            blur: 0.0,
            noise: 0.0,
            tear: None,
        }
    }
}

pub fn scenarios() -> Vec<(&'static str, Degrade)> {
    let base = Degrade::default();
    vec![
        ("clean", base.clone()),
        ("tilt", Degrade { tilt: 0.06, ..base.clone() }),
        ("rotate180", Degrade { rotate180: true, tilt: 0.03, ..base.clone() }),
        ("blur", Degrade { blur: 0.8, ..base.clone() }),
        ("noise", Degrade { noise: 6.0, ..base.clone() }),
        ("color", Degrade { gains: [1.1, 1.0, 0.8], gamma: 1.2, ..base.clone() }),
        ("barrel", Degrade { barrel: 0.04, ..base.clone() }),
        ("tear", Degrade { tear: Some(0.5), ..base.clone() }),
        (
            "combined",
            Degrade {
                tilt: 0.04,
                blur: 0.7,
                noise: 4.0,
                gains: [1.05, 1.0, 0.9],
                gamma: 1.1,
                barrel: 0.03,
                tear: Some(0.4),
                ..base
            },
        ),
    ]
}

/// Photograph frame `a` (and `b` below the tear line) through `d`.
pub fn capture(a: &Rgb, b: &Rgb, d: &Degrade, rng: &mut SplitMix64) -> Rgb {
    let (cw, ch) = d.canvas;
    let (sw, sh) = (a.w as f64, a.h as f64);
    let s = d.fill * (cw as f64 / sw).min(ch as f64 / sh);
    let (dw, dh) = (sw * s, sh * s);
    let (ox, oy) = ((cw as f64 - dw) / 2.0, (ch as f64 - dh) / 2.0);
    let mut quad = [(ox, oy), (ox + dw, oy), (ox, oy + dh), (ox + dw, oy + dh)];
    let jitter = d.tilt * dw.min(dh);
    for p in quad.iter_mut() {
        p.0 += jitter * (rng.next_f64() * 2.0 - 1.0);
        p.1 += jitter * (rng.next_f64() * 2.0 - 1.0);
    }
    if d.rotate180 {
        quad = [quad[3], quad[2], quad[1], quad[0]];
    }
    let src = [(0.0, 0.0), (sw, 0.0), (0.0, sh), (sw, sh)];
    let inverse = Homography::from_points(src, quad)
        .and_then(|g| g.inverse())
        .expect("a jittered rectangle is a valid quad");
    let tear_row = d.tear.map_or(ch, |t| (t * ch as f64) as usize);
    let (cx, cy) = (cw as f64 / 2.0, ch as f64 / 2.0);
    let half_diag2 = cx * cx + cy * cy;

    let mut buf = vec![0.0f64; cw * ch * 3];
    for y in 0..ch {
        let img = if y < tear_row { a } else { b };
        for x in 0..cw {
            let (dx, dy) = (x as f64 + 0.5 - cx, y as f64 + 0.5 - cy);
            let f = 1.0 + d.barrel * (dx * dx + dy * dy) / half_diag2;
            let (sx, sy) = inverse.apply(cx + dx * f, cy + dy * f);
            let c = if (0.0..sw).contains(&sx) && (0.0..sh).contains(&sy) { img.sample(sx, sy) } else { [96.0; 3] };
            buf[(y * cw + x) * 3..(y * cw + x) * 3 + 3].copy_from_slice(&c);
        }
    }
    for px in buf.as_chunks_mut::<3>().0 {
        for (v, gain) in px.iter_mut().zip(d.gains) {
            *v = 255.0 * (*v / 255.0).powf(d.gamma) * gain;
        }
    }
    if d.blur > 0.0 {
        gaussian_blur(&mut buf, cw, ch, d.blur);
    }
    let px = buf
        .iter()
        .map(|&v| (v + d.noise * rng.gaussian()).round().clamp(0.0, 255.0) as u8)
        .collect();
    Rgb { w: cw, h: ch, px }
}

fn gaussian_blur(buf: &mut [f64], w: usize, h: usize, sigma: f64) {
    let r = (3.0 * sigma).ceil() as i64;
    let kernel: Vec<f64> = (-r..=r).map(|i| (-(i * i) as f64 / (2.0 * sigma * sigma)).exp()).collect();
    let total: f64 = kernel.iter().sum();
    let kernel: Vec<f64> = kernel.iter().map(|k| k / total).collect();
    let pass = |src: &[f64], horizontal: bool| -> Vec<f64> {
        let mut out = vec![0.0; src.len()];
        for y in 0..h as i64 {
            for x in 0..w as i64 {
                let mut acc = [0.0; 3];
                for (i, k) in kernel.iter().enumerate() {
                    let o = i as i64 - r;
                    let (sx, sy) = if horizontal { ((x + o).clamp(0, w as i64 - 1), y) } else { (x, (y + o).clamp(0, h as i64 - 1)) };
                    let base = (sy as usize * w + sx as usize) * 3;
                    (0..3).for_each(|c| acc[c] += k * src[base + c]);
                }
                out[(y as usize * w + x as usize) * 3..][..3].copy_from_slice(&acc);
            }
        }
        out
    };
    let once = pass(buf, true);
    buf.copy_from_slice(&pass(&once, false));
}

/// Render `frames` frames at `cell_px`, photograph each through `d`, and
/// feed the captures to an analyzer. With `dump`, every capture is also
/// written to `<dump>-NN.png`.
pub fn run(params: &Params, d: &Degrade, frames: usize, cell_px: usize, metric: Metric, dump: Option<&Path>) -> Result<Analyzer, String> {
    if frames + 1 >= params.frames {
        return Err(format!("sim frames ({frames}) must be below the stream length ({})", params.frames));
    }
    let layout = Layout::new(params);
    let palette = params.palette()?;
    let draw = |f: usize| {
        render::rasterize(&render::frame_cells(&layout, &palette, params.bpc, params.seed, f as u64), params.w, params.h, cell_px)
    };
    let mut analyzer = Analyzer::new(params.clone(), metric)?;
    let mut rng = SplitMix64::new(0xC0FF_EE00 ^ params.seed);
    for f in 0..frames {
        let a = draw(f);
        let b = if d.tear.is_some() { draw(f + 1) } else { a.clone() };
        let shot = capture(&a, &b, d, &mut rng);
        if let Some(prefix) = dump {
            pngio::write_png(&prefix.with_file_name(format!("{}-{f:02}.png", prefix.file_name().unwrap_or_default().to_string_lossy())), &shot)?;
        }
        timed_push(&mut analyzer, &shot);
    }
    Ok(analyzer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use beamlet_stream::params;

    fn scenario(name: &str) -> Degrade {
        scenarios().into_iter().find(|(n, _)| *n == name).unwrap().1
    }

    #[test]
    fn clean_capture_decodes_every_tile_in_every_mode() {
        for mode in params::mode_names() {
            let p = Params::mode(mode).unwrap();
            let s = run(&p, &scenario("clean"), 2, 5, Metric::Rgb, None).unwrap().stats;
            assert_eq!(s.detected, 2, "{mode}: frame not detected");
            assert_eq!(s.cell_errors, 0, "{mode}: {} cell errors", s.cell_errors);
            assert_eq!(s.tiles_ok, s.tiles_seen, "{mode}");
        }
    }

    #[test]
    fn moderate_distortions_keep_almost_every_tile() {
        let p = Params::mode("standard").unwrap();
        for name in ["tilt", "rotate180", "blur", "noise", "color", "barrel"] {
            let s = run(&p, &scenario(name), 2, 5, Metric::Rgb, None).unwrap().stats;
            let ok = s.tiles_ok as f64 / s.tiles_seen.max(1) as f64;
            assert!(ok >= 0.95, "{name}: only {:.1}% of tiles decodable", 100.0 * ok);
        }
    }

    #[test]
    fn combined_distortion_loses_only_the_tile_under_the_tear() {
        // A tile straddling the tear holds cells of two frames and is
        // discarded by design (§6.3); everything else must survive.
        let p = Params::mode("standard").unwrap();
        let s = run(&p, &scenario("combined"), 4, 5, Metric::Rgb, None).unwrap().stats;
        assert!(s.tiles_ok + s.captures >= s.tiles_seen, "{} of {} tiles", s.tiles_ok, s.tiles_seen);
    }

    #[test]
    fn pixel_perfect_frames_decode_without_marker_confusion() {
        // Unblurred, pixel-aligned frames, where random data reproduces
        // finder centre lines exactly (standard frame 25, fastest frames 83
        // and 85 fooled a detector that ranked markers by ratio hits).
        for (mode, frames) in [("standard", 0..30u64), ("fastest", 80..90)] {
            let p = Params::mode(mode).unwrap();
            let layout = Layout::new(&p);
            let palette = p.palette().unwrap();
            let mut analyzer = Analyzer::new(p.clone(), Metric::Rgb).unwrap();
            for f in frames {
                let cells = render::frame_cells(&layout, &palette, p.bpc, p.seed, f);
                analyzer.push(&render::rasterize(&cells, p.w, p.h, 8));
            }
            let s = &analyzer.stats;
            assert_eq!(s.tiles_ok, s.tiles_seen, "{mode}: {} of {} tiles", s.tiles_ok, s.tiles_seen);
        }
    }

    #[test]
    fn torn_capture_yields_tiles_from_both_frames() {
        let p = Params::mode("standard").unwrap();
        let s = run(&p, &scenario("tear"), 2, 5, Metric::Rgb, None).unwrap().stats;
        assert_eq!(s.mixed, 2);
        let frames: std::collections::HashSet<i64> = s.unique_ok.iter().map(|&(f, _)| f).collect();
        assert_eq!(frames.len(), 3, "frames 0,1 from the first capture and 1,2 from the second");
    }
}
