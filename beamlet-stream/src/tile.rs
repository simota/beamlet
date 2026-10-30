//! Tile: one RaptorQ packet as an RS(n, k) codeword, n ≤ 255 (STREAM_FORMAT.md §6.3).
//!
//! message = OID (1) | SBN (1) | ESI (3) | F (5) | symbol (k − 14) | CRC-32 (4)

use crate::crc::crc32;
use crate::params::TILE_HEADER;
use crate::rs;

#[derive(Clone, Debug, PartialEq)]
pub struct TilePacket {
    pub oid: u8,
    pub sbn: u8,
    /// 24-bit encoding symbol id.
    pub esi: u32,
    /// 40-bit transfer length of the object (RaptorQ F).
    pub transfer_len: u64,
    /// Exactly `k − 14` bytes; RaptorQ symbols shorter than that are zero-padded.
    pub symbol: Vec<u8>,
}

pub fn symbol_capacity(k: usize) -> usize {
    k - TILE_HEADER
}

/// The n-byte codeword of `p`, k of them message.
pub fn encode(p: &TilePacket, n: usize, k: usize) -> Vec<u8> {
    assert_eq!(p.symbol.len(), symbol_capacity(k), "tile symbol must fill the tile");
    assert!(p.esi < 1 << 24 && p.transfer_len < 1 << 40, "ESI or F out of range");
    let mut msg = Vec::with_capacity(k);
    msg.push(p.oid);
    msg.push(p.sbn);
    msg.extend_from_slice(&p.esi.to_be_bytes()[1..]);
    msg.extend_from_slice(&p.transfer_len.to_be_bytes()[3..]);
    msg.extend_from_slice(&p.symbol);
    let crc = crc32(&msg);
    msg.extend_from_slice(&crc.to_be_bytes());
    rs::encode(&msg, n - k)
}

/// RS-correct and parse a received codeword; None if it is beyond repair or
/// the CRC disagrees (a miscorrection).
pub fn decode(codeword: &mut [u8], k: usize) -> Option<TilePacket> {
    rs::decode(codeword, codeword.len() - k)?;
    let (body, crc) = codeword[..k].split_at(k - 4);
    if crc32(body) != u32::from_be_bytes(crc.try_into().ok()?) {
        return None;
    }
    let be = |bytes: &[u8]| bytes.iter().fold(0u64, |acc, &b| acc << 8 | b as u64);
    Some(TilePacket {
        oid: body[0],
        sbn: body[1],
        esi: be(&body[2..5]) as u32,
        transfer_len: be(&body[5..10]),
        symbol: body[10..].to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::{self, Params};
    use crate::prng::SplitMix64;

    #[test]
    fn round_trips_through_correctable_damage() {
        let mut rng = SplitMix64::new(3);
        // A full-length codeword and a compact-mode shortened one.
        for (n, k) in [(255, 191), (171, 128)] {
            let mut symbol = vec![0u8; symbol_capacity(k)];
            rng.fill(&mut symbol);
            let p = TilePacket { oid: 2, sbn: 0, esi: 0x00AB_CDEF, transfer_len: 0x12_3456_789A, symbol };
            let mut cw = encode(&p, n, k);
            assert_eq!(cw.len(), n);
            for i in (0..cw.len()).step_by(n / ((n - k) / 2)).take((n - k) / 2) {
                cw[i] ^= 0x5A;
            }
            assert_eq!(decode(&mut cw, k), Some(p), "RS({n}, {k})");
        }
    }

    /// XOR a nonzero byte into `count` distinct positions of `cw`.
    fn corrupt(cw: &mut [u8], count: usize, rng: &mut SplitMix64) {
        let mut hit = std::collections::HashSet::new();
        while hit.len() < count {
            hit.insert((rng.next_u64() % cw.len() as u64) as usize);
        }
        for &i in &hit {
            cw[i] ^= 1 + (rng.next_u64() % 255) as u8;
        }
    }

    fn packet(k: usize, rng: &mut SplitMix64) -> TilePacket {
        let mut symbol = vec![0u8; symbol_capacity(k)];
        rng.fill(&mut symbol);
        TilePacket { oid: 1, sbn: 0, esi: (rng.next_u64() % (1 << 24)) as u32, transfer_len: 300_000, symbol }
    }

    #[test]
    fn every_mode_keeps_the_parity_share_of_a_full_length_codeword() {
        for mode in params::mode_names() {
            let p = Params::mode(mode).unwrap();
            let (n, k) = (p.tile_bytes(), p.k());
            // RS(255, k) at the same parity: what the tile was before codewords were shortened.
            let full_k = (255.0 * (1.0 - p.parity)).round() as usize;
            let (share, full_share) = (p.correctable() as f64 / n as f64, ((255 - full_k) / 2) as f64 / 255.0);
            assert!(share >= full_share - 0.5 / n as f64, "{mode}: RS({n}, {k}) fixes {share:.4} of a tile, RS(255, {full_k}) {full_share:.4}");
        }
    }

    #[test]
    fn every_mode_corrects_up_to_its_bound_and_never_delivers_a_wrong_packet() {
        let mut rng = SplitMix64::new(11);
        for mode in params::mode_names() {
            let p = Params::mode(mode).unwrap();
            let (n, k, t) = (p.tile_bytes(), p.k(), p.correctable());
            for trial in 0..50 {
                let pk = packet(k, &mut rng);
                let sent = encode(&pk, n, k);

                let mut cw = sent.clone();
                corrupt(&mut cw, t, &mut rng);
                assert_eq!(decode(&mut cw, k).as_ref(), Some(&pk), "{mode} RS({n}, {k}): {t} errors, trial {trial}");

                // Past the bound, from one byte over up to half the tile.
                for errors in [t + 1, t + 8, n / 2] {
                    let mut cw = sent.clone();
                    corrupt(&mut cw, errors, &mut rng);
                    assert_eq!(decode(&mut cw, k), None, "{mode} RS({n}, {k}): {errors} errors, trial {trial}");
                }
            }
        }
    }

    #[test]
    fn every_mode_rejects_a_miscorrection_by_its_crc() {
        let mut rng = SplitMix64::new(12);
        for mode in params::mode_names() {
            let p = Params::mode(mode).unwrap();
            let (n, k, t) = (p.tile_bytes(), p.k(), p.correctable());
            let sent = encode(&packet(k, &mut rng), n, k);
            // A valid RS codeword whose message differs from the sent one in
            // a symbol byte, with the CRC left as it was: what a received
            // word lands on when RS corrects it towards the wrong codeword.
            let mut msg = sent[..k].to_vec();
            msg[TILE_HEADER] ^= 0xFF;
            let neighbour = rs::encode(&msg, n - k);
            let mut cw = neighbour.clone();
            corrupt(&mut cw, t, &mut rng);
            let mut corrected = cw.clone();
            assert_eq!(rs::decode(&mut corrected, n - k), Some(t), "{mode}: RS takes the neighbour");
            assert_eq!(corrected, neighbour);
            assert_eq!(decode(&mut cw, k), None, "{mode}: the CRC catches it");
        }
    }
}
