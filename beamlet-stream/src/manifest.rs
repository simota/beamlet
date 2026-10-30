//! Object 0: the list of files in a session (STREAM_FORMAT.md §4.1).
//!
//! version (1) | count (1) | per entry:
//!   oid (1) | size (8) | sha256 (32) | name len (2) | name | mime len (1) | mime | thumb len (4) | thumb

pub const VERSION: u8 = 1;

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub oid: u8,
    pub size: u64,
    pub sha256: [u8; 32],
    pub name: String,
    pub mime: String,
    /// Small preview image (may be empty).
    pub thumbnail: Vec<u8>,
}

pub fn encode(entries: &[Entry]) -> Vec<u8> {
    assert!(entries.len() <= 255, "at most 255 objects per session");
    let mut out = vec![VERSION, entries.len() as u8];
    for e in entries {
        assert!(e.name.len() <= u16::MAX as usize && e.mime.len() <= u8::MAX as usize);
        out.push(e.oid);
        out.extend_from_slice(&e.size.to_be_bytes());
        out.extend_from_slice(&e.sha256);
        out.extend_from_slice(&(e.name.len() as u16).to_be_bytes());
        out.extend_from_slice(e.name.as_bytes());
        out.push(e.mime.len() as u8);
        out.extend_from_slice(e.mime.as_bytes());
        out.extend_from_slice(&(e.thumbnail.len() as u32).to_be_bytes());
        out.extend_from_slice(&e.thumbnail);
    }
    out
}

/// Parse a decrypted manifest. It passed AEAD, so it came from the peer we
/// exchanged keys with, but it is still checked rather than trusted blindly.
pub fn decode(bytes: &[u8]) -> Option<Vec<Entry>> {
    let mut r = Reader(bytes);
    if r.take(1)?[0] != VERSION {
        return None;
    }
    let count = r.take(1)?[0];
    let mut entries = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let oid = r.take(1)?[0];
        let size = u64::from_be_bytes(r.take(8)?.try_into().ok()?);
        let sha256 = r.take(32)?.try_into().ok()?;
        let name_len = u16::from_be_bytes(r.take(2)?.try_into().ok()?) as usize;
        let name = String::from_utf8(r.take(name_len)?.to_vec()).ok()?;
        let mime_len = r.take(1)?[0] as usize;
        let mime = String::from_utf8(r.take(mime_len)?.to_vec()).ok()?;
        let thumb_len = u32::from_be_bytes(r.take(4)?.try_into().ok()?) as usize;
        let thumbnail = r.take(thumb_len)?.to_vec();
        if oid == 0 {
            return None;
        }
        entries.push(Entry { oid, size, sha256, name, mime, thumbnail });
    }
    r.0.is_empty().then_some(entries)
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        (self.0.len() >= n).then(|| {
            let (head, tail) = self.0.split_at(n);
            self.0 = tail;
            head
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_rejects_truncation() {
        let entries = vec![
            Entry { oid: 1, size: 10, sha256: [1; 32], name: "写真.heic".into(), mime: "image/heic".into(), thumbnail: vec![9; 100] },
            Entry { oid: 2, size: 0, sha256: [2; 32], name: "empty.txt".into(), mime: "text/plain".into(), thumbnail: vec![] },
        ];
        let bytes = encode(&entries);
        assert_eq!(decode(&bytes), Some(entries));
        assert_eq!(decode(&bytes[..bytes.len() - 1]), None);
    }
}
