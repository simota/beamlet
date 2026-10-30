use std::collections::HashMap;

use crate::geom::Homography;
use crate::layout::{align_dark, corner_dark, finder_dark, Layout};
use crate::render::Rgb;

pub struct Gray {
    w: usize,
    h: usize,
    px: Vec<u8>,
}

impl Gray {
    pub fn from_rgb(img: &Rgb) -> Gray {
        let px = img
            .px
            .as_chunks::<3>()
            .0
            .iter()
            .map(|p| ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u8)
            .collect();
        Gray { w: img.w, h: img.h, px }
    }

    fn sample(&self, x: f64, y: f64) -> f64 {
        let (x, y) = (x - 0.5, y - 0.5);
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let at = |xi: f64, yi: f64| {
            let xi = (xi as i64).clamp(0, self.w as i64 - 1) as usize;
            let yi = (yi as i64).clamp(0, self.h as i64 - 1) as usize;
            self.px[yi * self.w + xi] as f64
        };
        let top = at(x0, y0) * (1.0 - fx) + at(x0 + 1.0, y0) * fx;
        let bot = at(x0, y0 + 1.0) * (1.0 - fx) + at(x0 + 1.0, y0 + 1.0) * fx;
        top * (1.0 - fy) + bot * fy
    }
}

/// Cell-space → image-space mapping: a global homography from the four
/// corner markers plus a bilinear field of local offsets measured at the
/// alignment markers, which absorbs lens distortion.
pub struct Grid {
    h: Homography,
    lx: Vec<f64>,
    ly: Vec<f64>,
    offsets: Vec<(f64, f64)>,
    pub module: f64,
}

impl Grid {
    /// `x`, `y` in continuous cell units: cell (i, j) spans [i, i+1) × [j, j+1).
    pub fn locate(&self, x: f64, y: f64) -> (f64, f64) {
        let (bx, by) = self.h.apply(x, y);
        let (i, tx) = segment(&self.lx, x);
        let (j, ty) = segment(&self.ly, y);
        let n = self.lx.len();
        let o = |jj: usize, ii: usize| self.offsets[jj * n + ii];
        let (a, b, c, d) = (o(j, i), o(j, i + 1), o(j + 1, i), o(j + 1, i + 1));
        let wa = (1.0 - tx) * (1.0 - ty);
        let wb = tx * (1.0 - ty);
        let wc = (1.0 - tx) * ty;
        let wd = tx * ty;
        (
            bx + a.0 * wa + b.0 * wb + c.0 * wc + d.0 * wd,
            by + a.1 * wa + b.1 * wb + c.1 * wc + d.1 * wd,
        )
    }
}

fn segment(v: &[f64], x: f64) -> (usize, f64) {
    let i = (0..v.len() - 1).find(|&i| x <= v[i + 1]).unwrap_or(v.len() - 2);
    (i, ((x - v[i]) / (v[i + 1] - v[i])).clamp(0.0, 1.0))
}

pub fn detect(img: &Rgb, layout: &Layout) -> Option<Grid> {
    fit(&find_markers(img), layout)
}

/// Marker candidates in a capture. Finding them does not depend on the
/// layout, so a receiver trying several layouts scans each capture once.
pub struct Markers {
    gray: Gray,
    clusters: Vec<Cluster>,
}

pub fn find_markers(img: &Rgb) -> Markers {
    let gray = Gray::from_rgb(img);
    let dark = binarize(&gray);
    let clusters = scan(&dark, gray.w, gray.h);
    Markers { gray, clusters }
}

const PATTERNS: [fn(i32, i32) -> bool; 4] = [finder_dark, finder_dark, finder_dark, corner_dark];

fn corner_cells(layout: &Layout) -> [Point; 4] {
    Layout::corner_centers(layout.w, layout.h).map(|(x, y)| (x as f64 + 0.5, y as f64 + 0.5))
}

/// Full search: pick the corner assignment, then refine everything.
pub fn fit(m: &Markers, layout: &Layout) -> Option<Grid> {
    let (gray, clusters) = (&m.gray, &m.clusters);
    let cells = corner_cells(layout);
    // Random data can reproduce a marker's centre lines exactly, so ratio
    // hits alone cannot tell real markers from fakes. Every plausible
    // assignment is instead judged by how well all four full marker
    // templates fit the image under the homography it implies.
    let (_, initial, module) = finder_trios(clusters)
        .into_iter()
        .flat_map(|(tl, tr, bl, module)| {
            let mut options = corner_candidates(clusters, tl, tr, bl);
            options.push((tr.0 + bl.0 - tl.0, tr.1 + bl.1 - tl.1));
            options.into_iter().map(move |br| ([tl, tr, bl, br], module))
        })
        .filter_map(|(points, module)| Homography::from_points(cells, points).map(|hg| (hg, module)))
        .map(|(hg, module)| {
            let fit: f64 = (0..4).map(|k| template_contrast(gray, &hg, cells[k], 3, PATTERNS[k], (0.0, 0.0))).sum();
            (fit, hg, module)
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))?;
    let refined: [Point; 4] = std::array::from_fn(|k| {
        let p = initial.apply(cells[k].0, cells[k].1);
        let (d, contrast) = refine(gray, &initial, cells[k], 3, PATTERNS[k], (0.0, 0.0), module);
        if contrast > MIN_CONTRAST { (p.0 + d.0, p.1 + d.1) } else { p }
    });
    let homography = Homography::from_points(cells, refined)?;
    Some(align(gray, layout, homography, None))
}

/// Follow a frame found in the previous capture: re-fit the four corner
/// markers near where they were and the alignment markers near their last
/// offsets, skipping binarisation and the marker scan. None when a corner
/// is lost, so the caller falls back to `detect`.
pub fn track(img: &Rgb, layout: &Layout, prev: &Grid) -> Option<Grid> {
    let gray = Gray::from_rgb(img);
    let cells = corner_cells(layout);
    let mut corners = [(0.0, 0.0); 4];
    for k in 0..4 {
        let p = prev.h.apply(cells[k].0, cells[k].1);
        let (d, contrast) = refine(&gray, &prev.h, cells[k], 3, PATTERNS[k], (0.0, 0.0), 1.5 * prev.module);
        if contrast <= MIN_CONTRAST {
            return None;
        }
        corners[k] = (p.0 + d.0, p.1 + d.1);
    }
    let homography = Homography::from_points(cells, corners)?;
    Some(align(&gray, layout, homography, Some(&prev.offsets)))
}

/// Measure the alignment-marker offsets under `homography`. With `prev`,
/// each search starts at the previous offset and spans less than a cell.
fn align(gray: &Gray, layout: &Layout, homography: Homography, prev: Option<&[Point]>) -> Grid {
    let (w, h) = (layout.w as f64, layout.h as f64);
    let cells = corner_cells(layout);
    let lx: Vec<f64> = layout.lattice_x.iter().map(|&x| x as f64 + 0.5).collect();
    let ly: Vec<f64> = layout.lattice_y.iter().map(|&y| y as f64 + 0.5).collect();
    let mut offsets = Vec::with_capacity(lx.len() * ly.len());
    for &y in &ly {
        for &x in &lx {
            let i = offsets.len();
            if cells.contains(&(x, y)) {
                offsets.push((0.0, 0.0));
                continue;
            }
            let local = dist(homography.apply(x, y), homography.apply(x + 1.0, y));
            let (start, search) = match prev {
                Some(prev) => (prev[i], 0.6 * local),
                None => ((0.0, 0.0), 1.5 * local),
            };
            let (d, contrast) = refine(gray, &homography, (x, y), 2, align_dark, start, search);
            offsets.push(if contrast > MIN_CONTRAST { d } else { start });
        }
    }
    let span = dist(homography.apply(0.0, 0.0), homography.apply(w, 0.0)) / w
        + dist(homography.apply(0.0, 0.0), homography.apply(0.0, h)) / h;
    Grid { h: homography, lx, ly, offsets, module: span / 2.0 }
}

/// Dark where luma is clearly below the local mean; the window is wide
/// enough to straddle a whole finder at typical capture scales.
fn binarize(g: &Gray) -> Vec<bool> {
    let (w, h) = (g.w, g.h);
    let stride = w + 1;
    let mut integral = vec![0u64; stride * (h + 1)];
    for y in 0..h {
        let mut row = 0u64;
        for x in 0..w {
            row += g.px[y * w + x] as u64;
            integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
        }
    }
    let r = (w.min(h) / 30).max(4);
    let mut out = vec![false; w * h];
    for y in 0..h {
        let (y0, y1) = (y.saturating_sub(r), (y + r + 1).min(h));
        for x in 0..w {
            let (x0, x1) = (x.saturating_sub(r), (x + r + 1).min(w));
            let sum = integral[y1 * stride + x1] + integral[y0 * stride + x0]
                - integral[y0 * stride + x1]
                - integral[y1 * stride + x0];
            let n = ((y1 - y0) * (x1 - x0)) as u64;
            out[y * w + x] = (g.px[y * w + x] as u64 + 4) * n < sum;
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Finder,
    Corner,
}

struct Cluster {
    x: f64,
    y: f64,
    m: f64,
    n: usize,
    kind: Kind,
}

const FINDER: [f64; 5] = [1.0, 1.0, 3.0, 1.0, 1.0];
const CORNER: [f64; 7] = [1.0; 7];

/// (start, length, dark) runs of a binary line.
fn runs(bits: impl Iterator<Item = bool>) -> Vec<(usize, usize, bool)> {
    let mut out: Vec<(usize, usize, bool)> = Vec::new();
    for (i, b) in bits.enumerate() {
        match out.last_mut() {
            Some(last) if last.2 == b => last.1 += 1,
            _ => out.push((i, 1, b)),
        }
    }
    out
}

fn ratio(lens: &[usize], pattern: &[f64]) -> Option<f64> {
    let m = lens.iter().sum::<usize>() as f64 / pattern.iter().sum::<f64>();
    if m < 1.5 {
        return None;
    }
    // The wide finder centre gets a tighter relative tolerance: with the
    // looser one, the BR marker's 1:1:1 centre passes as 1:1:3:1:1.
    let ok = lens.iter().zip(pattern).all(|(&len, &p)| {
        let tolerance = if p > 1.0 { 0.35 * p * m } else { 0.6 * m };
        (len as f64 - p * m).abs() <= tolerance
    });
    ok.then_some(m)
}

/// QR-style ratio scan: a horizontal hit is kept only if the column through
/// its centre shows the same pattern.
fn scan(dark: &[bool], w: usize, h: usize) -> Vec<Cluster> {
    let mut clusters = Vec::new();
    let mut columns: HashMap<usize, Vec<(usize, usize, bool)>> = HashMap::new();
    for y in 0..h {
        let row = runs(dark[y * w..(y + 1) * w].iter().copied());
        for (kind, pattern) in [(Kind::Finder, &FINDER[..]), (Kind::Corner, &CORNER[..])] {
            let k = pattern.len();
            for i in 0..row.len().saturating_sub(k - 1) {
                if !row[i].2 {
                    continue;
                }
                let lens: Vec<usize> = row[i..i + k].iter().map(|r| r.1).collect();
                let Some(mh) = ratio(&lens, pattern) else { continue };
                let centre = row[i + k / 2];
                let cx = centre.0 as f64 + centre.1 as f64 / 2.0;
                let col = columns
                    .entry(cx as usize)
                    .or_insert_with(|| runs((0..h).map(|yy| dark[yy * w + cx as usize])));
                let Some(j) = col.iter().position(|r| r.0 <= y && y < r.0 + r.1) else { continue };
                if j < k / 2 || j + k / 2 >= col.len() || !col[j - k / 2].2 {
                    continue;
                }
                let lens: Vec<usize> = col[j - k / 2..=j + k / 2].iter().map(|r| r.1).collect();
                let Some(mv) = ratio(&lens, pattern) else { continue };
                if mh / mv > 2.0 || mv / mh > 2.0 {
                    continue;
                }
                let cy = col[j].0 as f64 + col[j].1 as f64 / 2.0;
                merge(&mut clusters, kind, cx, cy, (mh + mv) / 2.0);
            }
        }
    }
    clusters
}

fn merge(clusters: &mut Vec<Cluster>, kind: Kind, x: f64, y: f64, m: f64) {
    if let Some(c) = clusters
        .iter_mut()
        .find(|c| c.kind == kind && (c.x - x).abs() < 2.0 * c.m && (c.y - y).abs() < 2.0 * c.m)
    {
        let n = c.n as f64;
        c.x = (c.x * n + x) / (n + 1.0);
        c.y = (c.y * n + y) / (n + 1.0);
        c.m = (c.m * n + m) / (n + 1.0);
        c.n += 1;
    } else {
        clusters.push(Cluster { x, y, m, n: 1, kind });
    }
}

type Point = (f64, f64);

/// BR marker clusters near the parallelogram's fourth corner.
fn corner_candidates(clusters: &[Cluster], tl: Point, tr: Point, bl: Point) -> Vec<Point> {
    let predicted = (tr.0 + bl.0 - tl.0, tr.1 + bl.1 - tl.1);
    let reach = 0.12 * dist(tl, tr).max(dist(tl, bl));
    clusters
        .iter()
        .filter(|c| c.kind == Kind::Corner && dist((c.x, c.y), predicted) < reach)
        .map(|c| (c.x, c.y))
        .collect()
}

/// Every trio of strong finder clusters that forms a plausible right
/// angle; the cross product fixes which arm is TR and which BL, so any
/// rotation works.
fn finder_trios(clusters: &[Cluster]) -> Vec<(Point, Point, Point, f64)> {
    let mut finders: Vec<&Cluster> = clusters.iter().filter(|c| c.kind == Kind::Finder && c.n >= 2).collect();
    finders.sort_by_key(|c| std::cmp::Reverse(c.n));
    finders.truncate(16);
    let mut trios = Vec::new();
    for a in 0..finders.len() {
        for b in a + 1..finders.len() {
            for c in b + 1..finders.len() {
                let trio = [finders[a], finders[b], finders[c]];
                let (mmin, mmax) = trio.iter().fold((f64::MAX, 0.0f64), |(lo, hi), f| (lo.min(f.m), hi.max(f.m)));
                if mmax / mmin > 1.7 {
                    continue;
                }
                for corner in 0..3 {
                    let p = trio[corner];
                    let (q, r) = (trio[(corner + 1) % 3], trio[(corner + 2) % 3]);
                    let v1 = (q.x - p.x, q.y - p.y);
                    let v2 = (r.x - p.x, r.y - p.y);
                    let (n1, n2) = ((v1.0 * v1.0 + v1.1 * v1.1).sqrt(), (v2.0 * v2.0 + v2.1 * v2.1).sqrt());
                    if n1 < 10.0 * p.m || n2 < 10.0 * p.m {
                        continue;
                    }
                    if ((v1.0 * v2.0 + v1.1 * v2.1) / (n1 * n2)).abs() > 0.3 {
                        continue;
                    }
                    let (tr, bl) = if v1.0 * v2.1 - v1.1 * v2.0 > 0.0 { (q, r) } else { (r, q) };
                    let (tl, tr, bl) = ((p.x, p.y), (tr.x, tr.y), (bl.x, bl.y));
                    trios.push((tl, tr, bl, (mmin + mmax) / 2.0));
                }
            }
        }
    }
    trios
}

/// Mean luma of the template's light cells minus that of its dark cells,
/// with the template shifted by `offset` image pixels. Five samples per
/// cell, spread over its middle: a shift is penalised as soon as samples
/// cross a cell edge, which keeps the peak narrow.
fn template_contrast(g: &Gray, h: &Homography, centre: Point, half: i32, dark: fn(i32, i32) -> bool, offset: Point) -> f64 {
    const SPREAD: [(f64, f64); 5] = [(0.0, 0.0), (0.3, 0.0), (-0.3, 0.0), (0.0, 0.3), (0.0, -0.3)];
    let (mut light, mut darks, mut nl, mut nd) = (0.0, 0.0, 0, 0);
    for dy in -half..=half {
        for dx in -half..=half {
            for (sx, sy) in SPREAD {
                let (x, y) = h.apply(centre.0 + dx as f64 + sx, centre.1 + dy as f64 + sy);
                let v = g.sample(x + offset.0, y + offset.1);
                if dark(dx, dy) {
                    darks += v;
                    nd += 1;
                } else {
                    light += v;
                    nl += 1;
                }
            }
        }
    }
    light / nl as f64 - darks / nd as f64
}

/// Light-minus-dark mean luma below which a template fit is noise.
const MIN_CONTRAST: f64 = 25.0;

/// Shift (in image pixels, searched within `search` of `start`) that best
/// aligns a marker template with the image around its predicted position,
/// and the contrast it achieves there.
fn refine(
    g: &Gray,
    h: &Homography,
    centre: Point,
    half: i32,
    dark: fn(i32, i32) -> bool,
    start: Point,
    search: f64,
) -> (Point, f64) {
    let contrast = |ox: f64, oy: f64| template_contrast(g, h, centre, half, dark, (ox, oy));
    // On a sharp, pixel-aligned image the contrast is flat over a range of
    // shifts; taking the first maximum biases toward the search origin's
    // corner, so the centroid of the top plateau is used instead.
    let plateau = |offsets: Vec<Point>| -> (Point, f64) {
        let scored: Vec<(Point, f64)> = offsets.into_iter().map(|o| (o, contrast(o.0, o.1))).collect();
        let top = scored.iter().map(|s| s.1).fold(f64::MIN, f64::max);
        let near: Vec<Point> = scored.iter().filter(|s| s.1 >= top - 0.5).map(|s| s.0).collect();
        let n = near.len() as f64;
        ((near.iter().map(|p| p.0).sum::<f64>() / n, near.iter().map(|p| p.1).sum::<f64>() / n), top)
    };
    let steps = search.ceil() as i32;
    let grid = |c: Point, n: i32, step: f64| -> Vec<Point> {
        (-n..=n).flat_map(|oy| (-n..=n).map(move |ox| (c.0 + ox as f64 * step, c.1 + oy as f64 * step))).collect()
    };
    let (coarse, _) = plateau(grid(start, steps, 1.0));
    let (fine, _) = plateau(grid(coarse, 4, 0.25));
    (fine, contrast(fine.0, fine.1))
}

fn dist(a: Point, b: Point) -> f64 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::Params;
    use crate::render;

    #[test]
    fn locates_cells_to_subpixel_accuracy_on_a_pixel_aligned_frame() {
        // A sharp, integer-scaled frame gives the template a flat contrast
        // plateau; picking its first maximum instead of its centre shifted
        // every corner by several pixels.
        let p = Params::mode("standard").unwrap();
        let layout = Layout::new(&p);
        let cells = render::frame_cells(&layout, &p.palette().unwrap(), p.bpc, p.seed, 0);
        let px = 8.0;
        let grid = detect(&render::rasterize(&cells, p.w, p.h, px as usize), &layout).expect("frame is detected");
        for (x, y) in Layout::corner_centers(p.w, p.h).into_iter().chain([(p.w / 2, p.h / 2)]) {
            let (cx, cy) = (x as f64 + 0.5, y as f64 + 0.5);
            let (u, v) = grid.locate(cx, cy);
            let (eu, ev) = ((cx + crate::layout::QUIET as f64) * px, (cy + crate::layout::QUIET as f64) * px);
            assert!((u - eu).abs() < 0.5 && (v - ev).abs() < 0.5, "cell ({x},{y}) at ({u:.2},{v:.2}), expected ({eu},{ev})");
        }
    }
}
