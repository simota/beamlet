use crate::params::Params;

/// White border around the grid, in cells (STREAM_FORMAT.md §6.1).
pub const QUIET: usize = 4;
/// One header copy: 64 B under RS(128, 64), one bit per cell (STREAM_FORMAT.md §6.2).
pub const HEADER_CELLS: usize = 1024;
const ALIGN_SPACING: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Role {
    Fixed { dark: bool },
    Palette(u8),
    Header,
    Data,
    Pad,
}

/// Finder (TL, TR, BL): dark ring, light ring, dark 3×3 centre — 1:1:3:1:1.
pub fn finder_dark(dx: i32, dy: i32) -> bool {
    let r = dx.abs().max(dy.abs());
    r == 3 || r <= 1
}

/// Orientation marker (BR): alternating rings — 1:1:1:1:1:1:1.
pub fn corner_dark(dx: i32, dy: i32) -> bool {
    let r = dx.abs().max(dy.abs());
    r == 3 || r == 1
}

pub fn align_dark(dx: i32, dy: i32) -> bool {
    let r = dx.abs().max(dy.abs());
    r == 2 || r == 0
}

pub struct Layout {
    pub w: usize,
    pub h: usize,
    pub roles: Vec<Role>,
    /// Data cells of all tiles, tile after tile, each in serpentine row order.
    pub data: Vec<usize>,
    pub cells_per_tile: usize,
    /// RS codeword length of a tile (Params::tile_bytes).
    pub tile_bytes: usize,
    pub tiles: usize,
    /// Header copies, each in its serpentine order (top from the first row down, bottom from the last row up).
    pub header_top: Vec<usize>,
    pub header_bottom: Vec<usize>,
    /// Marker centre columns / rows; the four corners are finders, the rest alignment.
    pub lattice_x: Vec<usize>,
    pub lattice_y: Vec<usize>,
}

impl Layout {
    pub fn new(p: &Params) -> Layout {
        let (w, h) = (p.w, p.h);
        let n_colors = 1usize << p.bpc;
        let mut roles: Vec<Option<Role>> = vec![None; w * h];

        let corners = Layout::corner_centers(w, h);
        for (i, &(cx, cy)) in corners.iter().enumerate() {
            let pattern = if i == 3 { corner_dark } else { finder_dark };
            for dy in -4i32..=4 {
                for dx in -4i32..=4 {
                    let (x, y) = (cx as i32 + dx, cy as i32 + dy);
                    if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
                        continue;
                    }
                    let separator = dx.abs().max(dy.abs()) == 4;
                    roles[y as usize * w + x as usize] =
                        Some(Role::Fixed { dark: !separator && pattern(dx, dy) });
                }
            }
        }

        let lattice_x = spaced(3, w - 4);
        let lattice_y = spaced(3, h - 4);
        for &cy in &lattice_y {
            for &cx in &lattice_x {
                if corners.contains(&(cx, cy)) {
                    continue;
                }
                for dy in -2i32..=2 {
                    for dx in -2i32..=2 {
                        let i = (cy as i32 + dy) as usize * w + (cx as i32 + dx) as usize;
                        roles[i] = Some(Role::Fixed { dark: align_dark(dx, dy) });
                    }
                }
            }
        }

        for y in [0, h - 1] {
            let mut n = 0;
            for x in 0..w {
                if roles[y * w + x].is_none() {
                    roles[y * w + x] = Some(Role::Palette(((n / 4) % n_colors) as u8));
                    n += 1;
                }
            }
        }

        let top: Vec<usize> = serpentine(w, 0..h).filter(|&i| roles[i].is_none()).take(HEADER_CELLS).collect();
        top.iter().for_each(|&i| roles[i] = Some(Role::Header));
        let bottom: Vec<usize> =
            serpentine(w, (0..h).rev()).filter(|&i| roles[i].is_none()).take(HEADER_CELLS).collect();
        bottom.iter().for_each(|&i| roles[i] = Some(Role::Header));

        let free: Vec<usize> = serpentine(w, 0..h).filter(|&i| roles[i].is_none()).collect();
        let tile_bytes = p.tile_bytes();
        let cells_per_tile = (tile_bytes * 8).div_ceil(p.bpc as usize);
        let tiles = free.len() / cells_per_tile;
        let data = free[..tiles * cells_per_tile].to_vec();
        data.iter().for_each(|&i| roles[i] = Some(Role::Data));
        free[tiles * cells_per_tile..].iter().for_each(|&i| roles[i] = Some(Role::Pad));

        Layout {
            w,
            h,
            roles: roles.into_iter().map(|r| r.expect("every cell is assigned a role")).collect(),
            data,
            cells_per_tile,
            tile_bytes,
            tiles,
            header_top: top,
            header_bottom: bottom,
            lattice_x,
            lattice_y,
        }
    }

    /// TL, TR, BL finders and the BR orientation marker.
    pub fn corner_centers(w: usize, h: usize) -> [(usize, usize); 4] {
        [(3, 3), (w - 4, 3), (3, h - 4), (w - 4, h - 4)]
    }

    pub fn count(&self, role: fn(&Role) -> bool) -> usize {
        self.roles.iter().filter(|r| role(r)).count()
    }
}

/// Evenly spaced points from a to b inclusive, no gap wider than ALIGN_SPACING.
fn spaced(a: usize, b: usize) -> Vec<usize> {
    let n = (b - a).div_ceil(ALIGN_SPACING).max(1);
    (0..=n).map(|k| a + ((b - a) * k + n / 2) / n).collect()
}

/// Cell indices row by row, alternating direction, so a tile occupies a
/// horizontal band — the shape rolling-shutter tearing damages least.
fn serpentine(w: usize, rows: impl Iterator<Item = usize>) -> impl Iterator<Item = usize> {
    rows.flat_map(move |y| {
        let xs: Box<dyn Iterator<Item = usize>> =
            if y % 2 == 0 { Box::new(0..w) } else { Box::new((0..w).rev()) };
        xs.map(move |x| y * w + x)
    })
}
