use crate::detect::Grid;
use crate::layout::{Layout, Role};
use crate::render::Rgb;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Metric {
    Rgb,
    /// YCbCr with luma down-weighted, so exposure drift matters less than hue.
    Ycc,
}

impl std::str::FromStr for Metric {
    type Err = String;
    fn from_str(s: &str) -> Result<Metric, String> {
        match s {
            "rgb" => Ok(Metric::Rgb),
            "ycc" => Ok(Metric::Ycc),
            _ => Err(format!("unknown metric `{s}` (rgb|ycc)")),
        }
    }
}

/// Mean colour around each cell centre (centre plus four points a fifth of
/// a cell away), for every cell of the grid.
pub fn cell_colors(img: &Rgb, grid: &Grid, w: usize, h: usize) -> Vec<[f64; 3]> {
    let q = (grid.module * 0.2).max(0.5);
    (0..w * h)
        .map(|i| {
            let (px, py) = grid.locate((i % w) as f64 + 0.5, (i / w) as f64 + 0.5);
            let mut acc = [0.0; 3];
            for (dx, dy) in [(0.0, 0.0), (q, 0.0), (-q, 0.0), (0.0, q), (0.0, -q)] {
                let c = img.sample(px + dx, py + dy);
                (0..3).for_each(|k| acc[k] += c[k] / 5.0);
            }
            acc
        })
        .collect()
}

/// Cells a colour needs among the data cells before `Classifier::refine`
/// trusts their mean over the palette strips.
const MIN_REFINE_CELLS: usize = 64;

/// Nearest-reference classifier whose references are measured from the
/// palette strips and interpolated row by row between top and bottom, so a
/// brightness or white-balance gradient across the screen is followed.
pub struct Classifier {
    top: Vec<[f64; 3]>,
    bottom: Vec<[f64; 3]>,
    rows: usize,
    metric: Metric,
}

impl Classifier {
    pub fn calibrate(colors: &[[f64; 3]], layout: &Layout, n_colors: usize, metric: Metric) -> Classifier {
        let mut sums = vec![([0.0; 3], 0usize); 2 * n_colors];
        for (i, role) in layout.roles.iter().enumerate() {
            if let Role::Palette(s) = *role {
                let slot = if i / layout.w == 0 { s as usize } else { n_colors + s as usize };
                (0..3).for_each(|k| sums[slot].0[k] += colors[i][k]);
                sums[slot].1 += 1;
            }
        }
        let means: Vec<[f64; 3]> =
            sums.iter().map(|(s, n)| transform(s.map(|v| v / (*n).max(1) as f64), metric)).collect();
        Classifier {
            top: means[..n_colors].to_vec(),
            bottom: means[n_colors..].to_vec(),
            rows: layout.h,
            metric,
        }
    }

    pub fn classify(&self, color: [f64; 3], row: usize) -> u8 {
        let t = row as f64 / (self.rows - 1) as f64;
        let c = transform(color, self.metric);
        let mut best = (0u8, f64::MAX);
        for (s, (a, b)) in self.top.iter().zip(&self.bottom).enumerate() {
            let d: f64 = (0..3).map(|k| (c[k] - (a[k] * (1.0 - t) + b[k] * t)).powi(2)).sum();
            if d < best.1 {
                best = (s as u8, d);
            }
        }
        best.0
    }
}

impl Classifier {
    /// References re-measured from the data cells as this classifier reads
    /// them. A blurred capture mixes each palette-strip cell with the quiet
    /// zone above it and the header band below, so the strips alone place
    /// the references off the colours data cells actually show — by an
    /// amount that depends on the session's header bits. Each colour's
    /// top and bottom references are refitted by least squares to the cells
    /// read as that colour, following the same row gradient; a colour too
    /// rare to fit keeps its strip references.
    pub fn refine(&self, colors: &[[f64; 3]], layout: &Layout) -> Classifier {
        let n = self.top.len();
        // Per colour: Σ(1-t)², Σ(1-t)t, Σt², Σ(1-t)c, Σtc, count.
        let mut acc = vec![(0.0, 0.0, 0.0, [0.0; 3], [0.0; 3], 0usize); n];
        for (i, role) in layout.roles.iter().enumerate() {
            if !matches!(role, Role::Data) {
                continue;
            }
            let row = i / layout.w;
            let t = row as f64 / (self.rows - 1) as f64;
            let c = transform(colors[i], self.metric);
            let a = &mut acc[self.classify(colors[i], row) as usize];
            a.0 += (1.0 - t) * (1.0 - t);
            a.1 += (1.0 - t) * t;
            a.2 += t * t;
            (0..3).for_each(|k| {
                a.3[k] += (1.0 - t) * c[k];
                a.4[k] += t * c[k];
            });
            a.5 += 1;
        }
        let mut refined = Classifier { top: self.top.clone(), bottom: self.bottom.clone(), rows: self.rows, metric: self.metric };
        for (s, &(s00, s01, s11, r0, r1, count)) in acc.iter().enumerate() {
            let det = s00 * s11 - s01 * s01;
            if count < MIN_REFINE_CELLS || det < 1e-6 * s00 * s11 {
                continue;
            }
            refined.top[s] = std::array::from_fn(|k| (s11 * r0[k] - s01 * r1[k]) / det);
            refined.bottom[s] = std::array::from_fn(|k| (s00 * r1[k] - s01 * r0[k]) / det);
        }
        refined
    }

    /// Whether `color` is nearer palette entry `a` than entry `b` — used for
    /// the one-bit header band, which only ever shows black or white.
    pub fn nearer(&self, color: [f64; 3], row: usize, a: usize, b: usize) -> bool {
        let t = row as f64 / (self.rows - 1) as f64;
        let c = transform(color, self.metric);
        let d = |s: usize| -> f64 {
            (0..3).map(|k| (c[k] - (self.top[s][k] * (1.0 - t) + self.bottom[s][k] * t)).powi(2)).sum()
        };
        d(a) < d(b)
    }
}

fn transform(c: [f64; 3], metric: Metric) -> [f64; 3] {
    match metric {
        Metric::Rgb => c,
        Metric::Ycc => [
            0.5 * (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]),
            -0.169 * c[0] - 0.331 * c[1] + 0.5 * c[2],
            0.5 * c[0] - 0.419 * c[1] - 0.081 * c[2],
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::Params;
    use crate::prng::SplitMix64;

    #[test]
    fn refining_follows_the_data_cells_when_the_palette_strips_read_off() {
        let p = Params::mode("compact").unwrap();
        let layout = Layout::new(&p);
        // What the data cells show (black, red, white, cyan), and the strips
        // pulled towards the white quiet zone as a blurred capture shows them.
        let shown = [[40.0, 40.0, 40.0], [200.0, 30.0, 30.0], [230.0, 230.0, 230.0], [30.0, 200.0, 200.0]];
        let strips = [[100.0, 100.0, 100.0], [230.0, 110.0, 110.0], [245.0, 245.0, 245.0], [110.0, 230.0, 230.0]];
        let mut rng = SplitMix64::new(4);
        let mut truth = vec![0u8; layout.roles.len()];
        let colors: Vec<[f64; 3]> = layout
            .roles
            .iter()
            .enumerate()
            .map(|(i, role)| match *role {
                Role::Palette(s) => strips[s as usize],
                _ => {
                    truth[i] = (rng.next_u64() % 4) as u8;
                    shown[truth[i] as usize].map(|c| c + (rng.next_f64() - 0.5) * 80.0)
                }
            })
            .collect();
        let errors = |c: &Classifier| {
            (0..colors.len())
                .filter(|&i| layout.roles[i] == Role::Data && c.classify(colors[i], i / layout.w) != truth[i])
                .count()
        };
        let strip = Classifier::calibrate(&colors, &layout, 4, Metric::Rgb);
        assert!(errors(&strip) > 100, "the strips alone misread {} cells", errors(&strip));
        assert_eq!(errors(&strip.refine(&colors, &layout)), 0);
    }
}
