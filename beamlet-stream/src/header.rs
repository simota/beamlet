//! Header band: 64 bytes as an RS(128, 64) codeword, one bit per cell, in
//! two copies (STREAM_FORMAT.md §6.2).

use crate::crc::crc32;
use crate::rs;

pub const MAGIC: &[u8; 2] = b"BL";
pub const VERSION: u8 = 1;
const MESSAGE: usize = 64;
pub const CODEWORD: usize = 128;

#[derive(Clone, Debug, PartialEq)]
pub struct Header {
    pub session_id: [u8; 8],
    pub pk_e: [u8; 32],
    /// Grid size in cells.
    pub grid_w: u16,
    pub grid_h: u16,
    pub bpc: u8,
    /// Tile RS parity: 0 = 12.5 %, 1 = 25 %, 2 = 50 %.
    pub rs_level: u8,
    pub symbol_size: u16,
    pub object_count: u8,
    pub frame_no: u32,
}

impl Header {
    pub fn encode(&self) -> Vec<u8> {
        let mut m = Vec::with_capacity(MESSAGE);
        m.extend_from_slice(MAGIC);
        m.push(VERSION);
        m.extend_from_slice(&self.session_id);
        m.extend_from_slice(&self.pk_e);
        m.extend_from_slice(&self.grid_w.to_be_bytes());
        m.extend_from_slice(&self.grid_h.to_be_bytes());
        m.push(self.bpc);
        m.push(self.rs_level);
        m.extend_from_slice(&self.symbol_size.to_be_bytes());
        m.push(self.object_count);
        m.extend_from_slice(&self.frame_no.to_be_bytes());
        m.resize(MESSAGE - 4, 0);
        let crc = crc32(&m);
        m.extend_from_slice(&crc.to_be_bytes());
        rs::encode(&m, CODEWORD - MESSAGE)
    }

    pub fn decode(codeword: &mut [u8]) -> Option<Header> {
        rs::decode(codeword, CODEWORD - MESSAGE)?;
        let m = &codeword[..MESSAGE];
        if crc32(&m[..MESSAGE - 4]) != u32::from_be_bytes(m[MESSAGE - 4..].try_into().ok()?)
            || &m[..2] != MAGIC
            || m[2] != VERSION
        {
            return None;
        }
        Some(Header {
            session_id: m[3..11].try_into().ok()?,
            pk_e: m[11..43].try_into().ok()?,
            grid_w: u16::from_be_bytes([m[43], m[44]]),
            grid_h: u16::from_be_bytes([m[45], m[46]]),
            bpc: m[47],
            rs_level: m[48],
            symbol_size: u16::from_be_bytes([m[49], m[50]]),
            object_count: m[51],
            frame_no: u32::from_be_bytes(m[52..56].try_into().ok()?),
        })
    }
}

pub fn parity_for_level(level: u8) -> Option<f64> {
    [0.125, 0.25, 0.5].get(level as usize).copied()
}

pub fn level_for_parity(parity: f64) -> Option<u8> {
    (0..3u8).find(|&l| parity_for_level(l) == Some(parity))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_damage() {
        let h = Header {
            session_id: *b"sessionX",
            pk_e: [7; 32],
            grid_w: 192,
            grid_h: 108,
            bpc: 2,
            rs_level: 1,
            symbol_size: 176,
            object_count: 3,
            frame_no: 123_456,
        };
        let mut cw = h.encode();
        assert_eq!(cw.len(), CODEWORD);
        for i in (0..CODEWORD).step_by(5).take(25) {
            cw[i] ^= 0xFF;
        }
        assert_eq!(Header::decode(&mut cw), Some(h));
    }
}
