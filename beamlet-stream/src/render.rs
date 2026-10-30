use crate::layout::{Layout, Role, QUIET};
use crate::prng;

#[derive(Clone)]
pub struct Rgb {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

impl Rgb {
    /// Bilinear sample; pixel i covers [i, i+1), so its centre is i + 0.5.
    pub fn sample(&self, x: f64, y: f64) -> [f64; 3] {
        let (x, y) = (x - 0.5, y - 0.5);
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let at = |xi: f64, yi: f64, c: usize| {
            let xi = (xi as i64).clamp(0, self.w as i64 - 1) as usize;
            let yi = (yi as i64).clamp(0, self.h as i64 - 1) as usize;
            self.px[(yi * self.w + xi) * 3 + c] as f64
        };
        let mut out = [0.0; 3];
        for (c, o) in out.iter_mut().enumerate() {
            let top = at(x0, y0, c) * (1.0 - fx) + at(x0 + 1.0, y0, c) * fx;
            let bot = at(x0, y0 + 1.0, c) * (1.0 - fx) + at(x0 + 1.0, y0 + 1.0, c) * fx;
            *o = top * (1.0 - fy) + bot * fy;
        }
        out
    }
}

/// Ground truth of tile `tile` in frame `frame`, `n` bytes long. A real tile
/// is an RS codeword over a RaptorQ symbol; uniform random bytes stand in for it.
pub fn tile_bytes(seed: u64, frame: u64, tile: usize, n: usize) -> Vec<u8> {
    let mut out = vec![0u8; n];
    prng::stream(seed, frame, tile as u64 + 1).fill(&mut out);
    out
}

/// MSB-first bit stream cut into `bpc`-bit symbols, zero-padded to `n_cells`.
pub fn bytes_to_symbols(bytes: &[u8], bpc: u32, n_cells: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(n_cells);
    let (mut acc, mut nbits) = (0u32, 0u32);
    let mut it = bytes.iter();
    for _ in 0..n_cells {
        while nbits < bpc {
            acc = (acc << 8) | *it.next().unwrap_or(&0) as u32;
            nbits += 8;
        }
        nbits -= bpc;
        out.push(((acc >> nbits) & ((1 << bpc) - 1)) as u8);
        acc &= (1 << nbits) - 1;
    }
    out
}

pub fn symbols_to_bytes(symbols: &[u8], bpc: u32, n_bytes: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(n_bytes);
    let (mut acc, mut nbits) = (0u32, 0u32);
    for &s in symbols {
        acc = (acc << bpc) | s as u32;
        nbits += bpc;
        if nbits >= 8 {
            nbits -= 8;
            out.push((acc >> nbits) as u8);
            acc &= (1 << nbits) - 1;
            if out.len() == n_bytes {
                break;
            }
        }
    }
    out.resize(n_bytes, 0);
    out
}

pub fn frame_cells(layout: &Layout, palette: &[[u8; 3]], bpc: u32, seed: u64, frame: u64) -> Vec<[u8; 3]> {
    const K: [u8; 3] = [0, 0, 0];
    const W: [u8; 3] = [255, 255, 255];
    let mut filler = prng::stream(seed, frame, 0);
    let mut out: Vec<[u8; 3]> = layout
        .roles
        .iter()
        .map(|role| match *role {
            Role::Fixed { dark } => if dark { K } else { W },
            Role::Palette(s) => palette[s as usize],
            Role::Header => if filler.next_u64() & 1 == 1 { K } else { W },
            Role::Pad => palette[(filler.next_u64() % palette.len() as u64) as usize],
            Role::Data => K,
        })
        .collect();
    let cpt = layout.cells_per_tile;
    for t in 0..layout.tiles {
        let symbols = bytes_to_symbols(&tile_bytes(seed, frame, t, layout.tile_bytes), bpc, cpt);
        for (&cell, &s) in layout.data[t * cpt..(t + 1) * cpt].iter().zip(&symbols) {
            out[cell] = palette[s as usize];
        }
    }
    out
}

/// Draw cells at `cell_px` pixels each, inside a QUIET-cell white border.
pub fn rasterize(cells: &[[u8; 3]], w: usize, h: usize, cell_px: usize) -> Rgb {
    let (iw, ih) = ((w + 2 * QUIET) * cell_px, (h + 2 * QUIET) * cell_px);
    let mut px = vec![255u8; iw * ih * 3];
    for cy in 0..h {
        for cx in 0..w {
            let c = cells[cy * w + cx];
            for py in 0..cell_px {
                let row = (cy + QUIET) * cell_px + py;
                let start = (row * iw + (cx + QUIET) * cell_px) * 3;
                for k in 0..cell_px {
                    px[start + k * 3..start + k * 3 + 3].copy_from_slice(&c);
                }
            }
        }
    }
    Rgb { w: iw, h: ih, px }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symbol_packing_round_trips_for_every_bpc() {
        let n = 255;
        let bytes = tile_bytes(7, 3, 2, n);
        for bpc in 1..=3 {
            let cells = (n * 8).div_ceil(bpc as usize);
            let symbols = bytes_to_symbols(&bytes, bpc, cells);
            assert!(symbols.iter().all(|&s| s < 1 << bpc));
            assert_eq!(symbols_to_bytes(&symbols, bpc, n), bytes);
        }
    }
}
