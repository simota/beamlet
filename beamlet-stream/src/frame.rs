//! A whole BOS1 frame: header band plus tiles, to and from cell colours.

use crate::header::{self, Header};
use crate::layout::{Layout, Role};
use crate::prng;
use crate::render;
use crate::sample::Classifier;
use crate::tile::{self, TilePacket};

const BLACK: [u8; 3] = [0, 0, 0];
const WHITE: [u8; 3] = [255, 255, 255];

/// Index of white in `palette`; every BOS1 palette contains black at 0 and white.
pub fn white_index(palette: &[[u8; 3]]) -> usize {
    palette.iter().position(|&c| c == WHITE).expect("every palette contains white")
}

/// Cell colours of one frame. `tiles` are RS codewords, one per layout tile;
/// unused padding cells get palette colours from `filler` so the frame has
/// no flat areas that could look like markers.
pub fn encode(layout: &Layout, palette: &[[u8; 3]], bpc: u32, header: &Header, tiles: &[Vec<u8>], filler: u64) -> Vec<[u8; 3]> {
    assert_eq!(tiles.len(), layout.tiles, "one codeword per tile");
    let mut rng = prng::stream(filler, header.frame_no as u64, 0);
    let mut out: Vec<[u8; 3]> = layout
        .roles
        .iter()
        .map(|role| match *role {
            Role::Fixed { dark } => if dark { BLACK } else { WHITE },
            Role::Palette(s) => palette[s as usize],
            Role::Pad => palette[(rng.next_u64() % palette.len() as u64) as usize],
            Role::Header | Role::Data => BLACK,
        })
        .collect();

    let bits = header.encode();
    for copy in [&layout.header_top, &layout.header_bottom] {
        for (j, &cell) in copy.iter().enumerate() {
            out[cell] = if bits[j / 8] >> (7 - j % 8) & 1 == 1 { BLACK } else { WHITE };
        }
    }

    let cpt = layout.cells_per_tile;
    for (t, codeword) in tiles.iter().enumerate() {
        let symbols = render::bytes_to_symbols(codeword, bpc, cpt);
        for (&cell, &s) in layout.data[t * cpt..(t + 1) * cpt].iter().zip(&symbols) {
            out[cell] = palette[s as usize];
        }
    }
    out
}

/// The first header copy that decodes. Read before the tiles, so a frame
/// of another session or mode costs no tile decoding.
pub fn read_header(colors: &[[f64; 3]], layout: &Layout, classifier: &Classifier, white: usize) -> Option<Header> {
    let w = layout.w;
    [&layout.header_top, &layout.header_bottom].iter().find_map(|copy| {
        let mut bytes = vec![0u8; header::CODEWORD];
        for (j, &cell) in copy.iter().enumerate() {
            if classifier.nearer(colors[cell], cell / w, 0, white) {
                bytes[j / 8] |= 1 << (7 - j % 8);
            }
        }
        Header::decode(&mut bytes)
    })
}

/// Per layout tile: the packet, or None when RS or the CRC rejected it.
pub fn read_tiles(colors: &[[f64; 3]], layout: &Layout, classifier: &Classifier, bpc: u32, k: usize) -> Vec<Option<TilePacket>> {
    let (w, cpt) = (layout.w, layout.cells_per_tile);
    (0..layout.tiles)
        .map(|t| {
            let symbols: Vec<u8> =
                layout.data[t * cpt..(t + 1) * cpt].iter().map(|&c| classifier.classify(colors[c], c / w)).collect();
            let mut codeword = render::symbols_to_bytes(&symbols, bpc, layout.tile_bytes);
            tile::decode(&mut codeword, k)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detect;
    use crate::params::Params;
    use crate::sample::{self, Metric};

    #[test]
    fn a_rendered_frame_reads_back_header_and_every_tile() {
        for mode in ["stable", "compact", "standard", "fast", "fastest"] {
            let p = Params::mode(mode).unwrap();
            let layout = Layout::new(&p);
            let palette = p.palette().unwrap();
            let k = p.k();
            let header = Header {
                session_id: *b"01234567",
                pk_e: [9; 32],
                grid_w: p.w as u16,
                grid_h: p.h as u16,
                bpc: p.bpc as u8,
                rs_level: header::level_for_parity(p.parity).unwrap(),
                symbol_size: tile::symbol_capacity(k) as u16,
                object_count: 1,
                frame_no: 5,
            };
            let mut rng = prng::SplitMix64::new(11);
            let packets: Vec<TilePacket> = (0..layout.tiles)
                .map(|t| {
                    let mut symbol = vec![0u8; tile::symbol_capacity(k)];
                    rng.fill(&mut symbol);
                    TilePacket { oid: 1, sbn: 0, esi: t as u32, transfer_len: 1000, symbol }
                })
                .collect();
            let codewords: Vec<Vec<u8>> = packets.iter().map(|pk| tile::encode(pk, layout.tile_bytes, k)).collect();
            let cells = encode(&layout, &palette, p.bpc, &header, &codewords, 99);
            let img = render::rasterize(&cells, p.w, p.h, 6);

            let grid = detect::detect(&img, &layout).expect("frame detected");
            let colors = sample::cell_colors(&img, &grid, p.w, p.h);
            let classifier = Classifier::calibrate(&colors, &layout, palette.len(), Metric::Rgb);
            assert_eq!(read_header(&colors, &layout, &classifier, white_index(&palette)), Some(header.clone()), "{mode}");
            let tiles = read_tiles(&colors, &layout, &classifier, p.bpc, k);
            assert_eq!(tiles, packets.into_iter().map(Some).collect::<Vec<_>>(), "{mode}");
        }
    }
}
