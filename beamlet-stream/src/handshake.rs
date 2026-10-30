//! Key exchange (STREAM_FORMAT.md §5): the receiver shows its public key as
//! a QR code, the sender derives the session key from it. Callers supply
//! the 32 random bytes for each secret, so the crate needs no OS randomness
//! (and the wasm build no `getrandom`).

use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub const KEY_QR_PREFIX: &str = "BOS1:";
const KEY_QR_VERSION: u8 = 1;

/// What the receiver's camera can take; the sender picks a mode from it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Caps {
    pub fps: u8,
    /// bit0 = 1 bit per cell, bit1 = 2, bit2 = 3.
    pub bpc_mask: u8,
    /// Longest grid side, in cells, the receiver can resolve.
    pub max_cells: u16,
}

#[derive(Debug, PartialEq)]
pub enum HandshakeError {
    /// Not a BOS1 key code, or a version this build does not speak.
    InvalidKeyQr,
    /// The peer's public key yields a non-contributory (all-zero) secret.
    WeakKey,
}

pub fn session_id(pk_r: &[u8; 32]) -> [u8; 8] {
    Sha256::digest(pk_r)[..8].try_into().expect("8 of 32 bytes")
}

/// Six digits both screens show, for the user to compare against a swapped key code.
pub fn fingerprint(pk_r: &[u8; 32]) -> String {
    let mut h = Sha256::new();
    h.update(b"BOS1-fp");
    h.update(pk_r);
    let d = h.finalize();
    format!("{:06}", u32::from_be_bytes([d[0], d[1], d[2], d[3]]) % 1_000_000)
}

pub fn key_qr(pk_r: &[u8; 32], caps: Caps) -> String {
    let mut bytes = vec![KEY_QR_VERSION];
    bytes.extend_from_slice(pk_r);
    bytes.extend_from_slice(&[caps.fps, caps.bpc_mask]);
    bytes.extend_from_slice(&caps.max_cells.to_be_bytes());
    format!("{KEY_QR_PREFIX}{}", base45_encode(&bytes))
}

pub fn parse_key_qr(text: &str) -> Result<([u8; 32], Caps), HandshakeError> {
    let bytes = text.strip_prefix(KEY_QR_PREFIX).and_then(base45_decode).ok_or(HandshakeError::InvalidKeyQr)?;
    if bytes.len() != 37 || bytes[0] != KEY_QR_VERSION {
        return Err(HandshakeError::InvalidKeyQr);
    }
    let pk = bytes[1..33].try_into().expect("checked length");
    Ok((pk, Caps { fps: bytes[33], bpc_mask: bytes[34], max_cells: u16::from_be_bytes([bytes[35], bytes[36]]) }))
}

/// Session key, identical on both sides:
/// HKDF-SHA256(ikm = X25519, salt = "", info = "BOS1" || pkE || pkR).
pub fn derive_key(own: &StaticSecret, peer: &[u8; 32], pk_e: &[u8; 32], pk_r: &[u8; 32]) -> Result<[u8; 32], HandshakeError> {
    let shared = own.diffie_hellman(&PublicKey::from(*peer));
    if !shared.was_contributory() {
        return Err(HandshakeError::WeakKey);
    }
    let mut info = b"BOS1".to_vec();
    info.extend_from_slice(pk_e);
    info.extend_from_slice(pk_r);
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&[]), shared.as_bytes()).expand(&info, &mut key).expect("32 bytes is a valid HKDF length");
    Ok(key)
}

pub fn public_key(secret: &StaticSecret) -> [u8; 32] {
    PublicKey::from(secret).to_bytes()
}

const BASE45: &[u8; 45] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/// RFC 9285 Base45, which fits QR alphanumeric mode.
pub fn base45_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len() * 3 / 2 + 1);
    for pair in data.chunks(2) {
        let (mut n, digits) = match pair {
            [a, b] => (*a as u32 * 256 + *b as u32, 3),
            [a] => (*a as u32, 2),
            _ => unreachable!("chunks(2)"),
        };
        for _ in 0..digits {
            out.push(BASE45[(n % 45) as usize] as char);
            n /= 45;
        }
    }
    out
}

pub fn base45_decode(text: &str) -> Option<Vec<u8>> {
    let values: Vec<u32> = text.bytes().map(|c| BASE45.iter().position(|&b| b == c).map(|v| v as u32)).collect::<Option<_>>()?;
    let mut out = Vec::with_capacity(values.len() * 2 / 3);
    for group in values.chunks(3) {
        match *group {
            [c, d, e] => {
                let n = c + d * 45 + e * 45 * 45;
                if n > 0xFFFF {
                    return None;
                }
                out.extend_from_slice(&[(n >> 8) as u8, n as u8]);
            }
            [c, d] => {
                let n = c + d * 45;
                if n > 0xFF {
                    return None;
                }
                out.push(n as u8);
            }
            _ => return None,
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base45_matches_rfc_9285_examples() {
        assert_eq!(base45_encode(b"AB"), "BB8");
        assert_eq!(base45_encode(b"Hello!!"), "%69 VD92EX0");
        assert_eq!(base45_encode(b"base-45"), "UJCLQE7W581");
        assert_eq!(base45_decode("QED8WEX0").as_deref(), Some(&b"ietf!"[..]));
        assert_eq!(base45_decode("GGW"), None, "65535 + 1 overflows");
    }

    #[test]
    fn both_sides_derive_the_same_key_from_the_key_code() {
        let receiver = StaticSecret::from([1u8; 32]);
        let pk_r = public_key(&receiver);
        let caps = Caps { fps: 60, bpc_mask: 0b011, max_cells: 256 };
        let qr = key_qr(&pk_r, caps);
        let (scanned, got_caps) = parse_key_qr(&qr).unwrap();
        assert_eq!((scanned, got_caps), (pk_r, caps));

        let sender = StaticSecret::from([2u8; 32]);
        let pk_e = public_key(&sender);
        let k_send = derive_key(&sender, &scanned, &pk_e, &scanned).unwrap();
        let k_recv = derive_key(&receiver, &pk_e, &pk_e, &pk_r).unwrap();
        assert_eq!(k_send, k_recv);
        assert_eq!(fingerprint(&pk_r).len(), 6);
    }

    #[test]
    fn rejects_malformed_codes_and_weak_keys() {
        assert_eq!(parse_key_qr("BOS1:not base45 lowercase"), Err(HandshakeError::InvalidKeyQr));
        assert_eq!(parse_key_qr("QR:whatever"), Err(HandshakeError::InvalidKeyQr));
        let s = StaticSecret::from([3u8; 32]);
        assert_eq!(derive_key(&s, &[0u8; 32], &[0; 32], &[0; 32]), Err(HandshakeError::WeakKey));
    }
}
