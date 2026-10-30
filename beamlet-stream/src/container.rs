//! Encrypted object container (STREAM_FORMAT.md §8).
//!
//! plaintext = flag (1: deflated, 0: stored) || body
//! chunk_i   = ChaCha20-Poly1305(key, oid || i (10 B) || last, plaintext[i·64 KiB ..], aad)
//! aad       = "BOS1" || session_id || pkE || oid

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};

pub const CHUNK: usize = 64 * 1024;
const TAG: usize = 16;

#[derive(Debug, PartialEq)]
pub enum OpenError {
    /// Wrong key, tampering, truncation, reordering or another object's chunks — not distinguished.
    AuthFailed,
    /// Decompressed beyond the size the caller allows.
    TooLarge,
}

pub struct Sealer<'a> {
    pub key: &'a [u8; 32],
    pub session_id: &'a [u8; 8],
    pub pk_e: &'a [u8; 32],
}

impl Sealer<'_> {
    fn aad(&self, oid: u8) -> Vec<u8> {
        let mut aad = b"BOS1".to_vec();
        aad.extend_from_slice(self.session_id);
        aad.extend_from_slice(self.pk_e);
        aad.push(oid);
        aad
    }

    fn nonce(oid: u8, index: usize, last: bool) -> [u8; 12] {
        let mut n = [0u8; 12];
        n[0] = oid;
        n[1..11].copy_from_slice(&(index as u128).to_be_bytes()[6..]);
        n[11] = last as u8;
        n
    }

    pub fn seal(&self, oid: u8, payload: &[u8], compress: bool) -> Vec<u8> {
        let mut plain = vec![compress as u8];
        if compress {
            plain.extend(miniz_oxide::deflate::compress_to_vec(payload, 6));
        } else {
            plain.extend_from_slice(payload);
        }
        let cipher = ChaCha20Poly1305::new(Key::from_slice(self.key));
        let aad = self.aad(oid);
        let chunks: Vec<&[u8]> = plain.chunks(CHUNK).collect();
        let mut out = Vec::with_capacity(plain.len() + chunks.len() * TAG);
        for (i, chunk) in chunks.iter().enumerate() {
            let nonce = Self::nonce(oid, i, i + 1 == chunks.len());
            let sealed = cipher
                .encrypt(Nonce::from_slice(&nonce), Payload { msg: chunk, aad: &aad })
                .expect("ChaCha20-Poly1305 encryption cannot fail for in-range lengths");
            out.extend(sealed);
        }
        out
    }

    /// Decrypt and, if flagged, inflate — never past `max_len` bytes.
    pub fn open(&self, oid: u8, container: &[u8], max_len: usize) -> Result<Vec<u8>, OpenError> {
        let cipher = ChaCha20Poly1305::new(Key::from_slice(self.key));
        let aad = self.aad(oid);
        let chunks: Vec<&[u8]> = container.chunks(CHUNK + TAG).collect();
        let mut plain = Vec::with_capacity(container.len());
        for (i, chunk) in chunks.iter().enumerate() {
            let nonce = Self::nonce(oid, i, i + 1 == chunks.len());
            let opened = cipher.decrypt(Nonce::from_slice(&nonce), Payload { msg: chunk, aad: &aad }).map_err(|_| OpenError::AuthFailed)?;
            plain.extend(opened);
            if plain.len() > max_len + 1 {
                return Err(OpenError::TooLarge);
            }
        }
        let (&flag, body) = plain.split_first().ok_or(OpenError::AuthFailed)?;
        match flag {
            0 => Ok(body.to_vec()),
            1 => miniz_oxide::inflate::decompress_to_vec_with_limit(body, max_len).map_err(|_| OpenError::TooLarge),
            _ => Err(OpenError::AuthFailed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sealer<'a>(key: &'a [u8; 32]) -> Sealer<'a> {
        Sealer { key, session_id: b"session1", pk_e: &[5; 32] }
    }

    #[test]
    fn round_trips_stored_and_deflated_payloads_across_chunks() {
        let key = [1u8; 32];
        let s = sealer(&key);
        let payload: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        for compress in [false, true] {
            let c = s.seal(3, &payload, compress);
            assert_eq!(s.open(3, &c, payload.len()).unwrap(), payload);
        }
    }

    #[test]
    fn rejects_tampering_wrong_key_truncation_and_object_swaps() {
        let key = [1u8; 32];
        let s = sealer(&key);
        let payload = vec![7u8; 150_000];
        let c = s.seal(2, &payload, false);

        let mut tampered = c.clone();
        tampered[1000] ^= 1;
        assert_eq!(s.open(2, &tampered, payload.len()), Err(OpenError::AuthFailed));

        let other = [2u8; 32];
        assert_eq!(sealer(&other).open(2, &c, payload.len()), Err(OpenError::AuthFailed));

        // Dropping the final chunk leaves a chunk sealed as non-final at the end.
        assert_eq!(s.open(2, &c[..2 * (CHUNK + TAG)], payload.len()), Err(OpenError::AuthFailed));

        assert_eq!(s.open(1, &c, payload.len()), Err(OpenError::AuthFailed));
    }

    #[test]
    fn refuses_to_inflate_past_the_declared_size() {
        let key = [1u8; 32];
        let s = sealer(&key);
        let c = s.seal(1, &vec![0u8; 1_000_000], true);
        assert_eq!(s.open(1, &c, 1000), Err(OpenError::TooLarge));
    }
}
