//! A transfer session: the sender turns files into an endless sequence of
//! frames, the receiver turns camera captures back into files
//! (STREAM_FORMAT.md §2, §4, §7).

use std::collections::{BTreeMap, HashSet, VecDeque};

use raptorq::{Decoder, EncodingPacket, ObjectTransmissionInformation, PayloadId, SourceBlockEncoder, SourceBlockEncodingPlan};
use sha2::{Digest, Sha256};
use x25519_dalek::StaticSecret;

use crate::container::{OpenError, Sealer};
use crate::detect;
use crate::frame;
use crate::handshake::{self, Caps, HandshakeError};
use crate::header::{self, Header};
use crate::layout::{Layout, QUIET};
use crate::manifest::{self, Entry};
use crate::params::{self, Params};
use crate::prng::SplitMix64;
use crate::render::Rgb;
use crate::sample::{self, Classifier, Metric};
use crate::tile::{self, TilePacket};

/// Largest object either side accepts (STREAM_FORMAT.md §3), plus container overhead.
pub const MAX_OBJECT: u64 = 100 * 1024 * 1024 + 1024 * 1024;
const MAX_MANIFEST: usize = 4 * 1024 * 1024;
/// One tile in this many carries the manifest during its first
/// MANIFEST_EARLY_PASSES passes, which a receiver watching from the start
/// reads the file list from (§4.2).
const MANIFEST_SHARE: usize = 10;
const MANIFEST_EARLY_PASSES: usize = 2;
/// After those passes the manifest keeps only what a receiver that starts
/// late needs to read it within PREVIEW_SECS: its source symbols times
/// PREVIEW_MARGIN, which covers a quarter of the frames lost and the few
/// symbols RaptorQ needs beyond the source count. The rest of its tenth
/// goes to the files.
const PREVIEW_SECS: f64 = 5.0;
const PREVIEW_MARGIN: f64 = 1.5;
/// One tile's worth of `Sender::manifest_credit`.
const MANIFEST_WHOLE: u64 = 1_000_000;
/// Symbols sent per object per pass, relative to its source symbol count (§4.2).
const PASS_OVERHEAD: f64 = 1.1;
/// Frames each object's pass spans at least. A small file's pass would
/// otherwise fit in one frame, and losing that frame would leave the file
/// waiting a whole pass of the large one.
const PASS_MIN_FRAMES: usize = 2;
/// Quarters of the frames drawn in the fallback mode in the first pass over
/// all objects, the second, and every pass after (§6.6). A camera that
/// reads the faster mode mostly finishes within the first two passes and
/// loses nothing to fallback frames in the first. One that cannot read it
/// gets nothing in the first pass, and the receiver advises the sender to
/// draw the fallback alone (`Receiver::fallback_advised`); left as it is,
/// it catches up on the passes after, three quarters fallback.
const FALLBACK_QUARTERS: [u64; 3] = [0, 1, 3];
/// Fallback frames come in runs of this many frames (400 ms at 15 fps)
/// rather than one at a time. A capture torn between two frames of a run
/// loses only the tile under the tear, as within any single mode, while
/// one torn between a fallback frame and a faster-mode frame loses the
/// tiles below the tear; runs make such captures rarer.
const FALLBACK_RUN: u32 = 6;
/// Captures that read, about a second at 30 fps, over which the receiver
/// judges whether it can read a mode that has a fallback.
const ADVICE_WINDOW: usize = 30;

/// Widest grid a phone-sized sender shows: a PC webcam sees a phone screen
/// at only about 2.5 pixels per cell of a 128-cell grid (§6.6).
pub const SMALL_SCREEN_CELLS: usize = 128;

/// Fastest built-in mode the receiver's camera can take: its bit depth is
/// in the receiver's mask, its grid fits, and the receiver captures at
/// least two frames per displayed frame (§6.5). A small-screen sender
/// also keeps to grids of at most SMALL_SCREEN_CELLS.
pub fn choose_mode(caps: Caps, small_screen: bool) -> Params {
    let max_w = if small_screen { SMALL_SCREEN_CELLS } else { usize::MAX };
    params::mode_names()
        .map(|n| Params::mode(n).expect("built-in mode"))
        .filter(|p| {
            caps.bpc_mask >> (p.bpc - 1) & 1 == 1
                && p.w <= (caps.max_cells as usize).min(max_w)
                && p.fps * 2 <= caps.fps as u32
        })
        .last()
        .unwrap_or_else(|| Params::mode("stable").expect("built-in mode"))
}

pub struct FileIn {
    pub name: String,
    pub mime: String,
    pub data: Vec<u8>,
    pub thumbnail: Vec<u8>,
    /// Deflate before encrypting; off for already-compressed media (§4.3).
    pub compress: bool,
}

/// The built-in mode drawn in place of `p` for a camera that cannot tell
/// its colours apart: the same grid with fewer bits per cell and the same
/// symbol size, so its frames carry the same symbols (compact → stable).
fn fallback_for(p: &Params) -> Option<Params> {
    params::mode_names()
        .map(|n| Params::mode(n).expect("built-in mode"))
        .find(|f| (f.w, f.h) == (p.w, p.h) && f.bpc < p.bpc && symbol_size(f) == symbol_size(p))
}

/// RaptorQ symbol size for a mode: the tile's symbol field rounded down to
/// raptorq's 8-byte alignment.
fn symbol_size(p: &Params) -> u16 {
    let capacity = tile::symbol_capacity(p.k());
    (capacity - capacity % 8) as u16
}

/// One object's never-ending packet sequence: every source packet once,
/// then repair packets round-robin over source blocks.
struct ObjectStream {
    oid: u8,
    transfer_len: u64,
    blocks: Vec<SourceBlockEncoder>,
    /// Source packets not yet sent; each is dropped as it goes out, so the
    /// copy of the object they hold shrinks during the first pass.
    source: VecDeque<EncodingPacket>,
    next_repair: Vec<u32>,
    turn: usize,
    per_pass: usize,
    /// Packets handed out so far, source and repair.
    sent: usize,
}

impl ObjectStream {
    fn new(oid: u8, container: &[u8], t: u16, min_per_pass: usize) -> ObjectStream {
        let oti = ObjectTransmissionInformation::with_defaults(container.len() as u64, t);
        // Built block by block, as raptorq::Encoder::new does, instead of
        // cloning an Encoder's blocks: the clone held two copies at once.
        let mut plan: Option<(usize, SourceBlockEncodingPlan)> = None;
        let blocks: Vec<SourceBlockEncoder> = raptorq::calculate_block_offsets(container, &oti)
            .into_iter()
            .enumerate()
            .map(|(i, (start, end))| {
                let mut block = container[start.min(container.len())..end.min(container.len())].to_vec();
                block.resize(end - start, 0);
                let symbols = block.len() / oti.symbol_size() as usize;
                if plan.as_ref().is_none_or(|(n, _)| *n != symbols) {
                    plan = Some((symbols, SourceBlockEncodingPlan::generate(symbols as u16)));
                }
                SourceBlockEncoder::with_encoding_plan(i as u8, &oti, &block, &plan.as_ref().expect("set above").1)
            })
            .collect();
        let source: VecDeque<EncodingPacket> = blocks.iter().flat_map(|b| b.source_packets()).collect();
        let per_pass = ((source.len() as f64 * PASS_OVERHEAD).ceil() as usize).max(min_per_pass);
        ObjectStream { oid, transfer_len: container.len() as u64, next_repair: vec![0; blocks.len()], blocks, source, turn: 0, per_pass, sent: 0 }
    }

    fn next(&mut self) -> EncodingPacket {
        self.sent += 1;
        if let Some(packet) = self.source.pop_front() {
            return packet;
        }
        let b = self.turn % self.blocks.len();
        self.turn += 1;
        self.next_repair[b] += 1;
        self.blocks[b].repair_packets(self.next_repair[b] - 1, 1).pop().expect("one repair packet requested")
    }
}

pub struct Sender {
    params: Params,
    layout: Layout,
    /// A built-in mode on the same grid with fewer bits per cell and the
    /// same symbol size, whose frames carry the same symbols, for a camera
    /// that cannot tell this mode's colours apart (compact → stable).
    fallback: Option<(Params, Layout, Vec<[u8; 3]>)>,
    palette: Vec<[u8; 3]>,
    /// Every frame is drawn in the fallback mode (`set_fallback_only`).
    fallback_only: bool,
    header: Header,
    manifest: ObjectStream,
    /// Manifest tiles per frame once its early passes are out (§4.2).
    manifest_late: f64,
    /// Each tile adds the manifest's share to this, and the tile that
    /// brings it to MANIFEST_WHOLE carries the manifest, so its tiles are
    /// spread evenly over successive frames however small the share.
    manifest_credit: u64,
    objects: Vec<ObjectStream>,
    current: usize,
    sent_in_pass: usize,
    /// Completed passes over all objects.
    passes: usize,
    fingerprint: String,
    filler: u64,
}

impl Sender {
    /// `secret` must be 32 fresh random bytes; `filler` seeds the padding cells.
    pub fn new(key_qr: &str, secret: [u8; 32], files: Vec<FileIn>, params: Params, filler: u64) -> Result<Sender, HandshakeError> {
        let (pk_r, _caps) = handshake::parse_key_qr(key_qr)?;
        let sk_e = StaticSecret::from(secret);
        let pk_e = handshake::public_key(&sk_e);
        let key = handshake::derive_key(&sk_e, &pk_r, &pk_e, &pk_r)?;
        let session_id = handshake::session_id(&pk_r);
        let sealer = Sealer { key: &key, session_id: &session_id, pk_e: &pk_e };
        let t = symbol_size(&params);

        let entries: Vec<Entry> = files
            .iter()
            .enumerate()
            .map(|(i, f)| Entry {
                oid: i as u8 + 1,
                size: f.data.len() as u64,
                sha256: sha256(&f.data),
                name: f.name.clone(),
                mime: f.mime.clone(),
                thumbnail: f.thumbnail.clone(),
            })
            .collect();
        let layout = Layout::new(&params);
        let min_per_pass = PASS_MIN_FRAMES * layout.tiles;
        let manifest = ObjectStream::new(0, &sealer.seal(0, &manifest::encode(&entries), true), t, min_per_pass);
        let manifest_late = manifest.source.len() as f64 * PREVIEW_MARGIN / (PREVIEW_SECS * params.fps as f64);
        let objects = files
            .iter()
            .zip(&entries)
            .map(|(f, e)| ObjectStream::new(e.oid, &sealer.seal(e.oid, &f.data, f.compress), t, min_per_pass))
            .collect();

        let fallback = fallback_for(&params).map(|f| {
            let layout = Layout::new(&f);
            let palette = f.palette().expect("modes use a defined palette");
            (f, layout, palette)
        });
        let header = Header {
            session_id,
            pk_e,
            grid_w: params.w as u16,
            grid_h: params.h as u16,
            bpc: params.bpc as u8,
            rs_level: header::level_for_parity(params.parity).expect("modes use a defined RS level"),
            symbol_size: t,
            object_count: entries.len() as u8,
            frame_no: 0,
        };
        Ok(Sender {
            palette: params.palette().expect("modes use a defined palette"),
            params,
            layout,
            fallback,
            fallback_only: false,
            header,
            manifest,
            manifest_late,
            // The very first tile carries the manifest.
            manifest_credit: MANIFEST_WHOLE - MANIFEST_WHOLE / MANIFEST_SHARE as u64,
            objects,
            current: 0,
            sent_in_pass: 0,
            passes: 0,
            fingerprint: handshake::fingerprint(&pk_r),
            filler,
        })
    }

    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    pub fn params(&self) -> &Params {
        &self.params
    }

    /// Draw every frame from the next one on in the fallback mode, or go
    /// back to mixing it in, for a camera that cannot read this mode's
    /// colours (§6.6). The session goes on as it is — same key, same
    /// symbols — so the receiver keeps everything it already has, which a
    /// new session in another mode would throw away. False if this mode has
    /// no fallback, in which case nothing changes.
    pub fn set_fallback_only(&mut self, on: bool) -> bool {
        self.fallback_only = on;
        self.fallback.is_some()
    }

    /// Whether the next frame is drawn in the fallback mode: every frame
    /// under `set_fallback_only`, otherwise runs of FALLBACK_RUN frames, as
    /// many quarters of them as FALLBACK_QUARTERS gives this pass. Runs are
    /// picked by a hash of their number rather than in turn, so a camera
    /// that drops every second or fourth frame loses no more of the
    /// fallback frames than of the rest.
    fn draws_fallback(&self) -> bool {
        let quarters = FALLBACK_QUARTERS[self.passes.min(FALLBACK_QUARTERS.len() - 1)];
        let run = u64::from(self.header.frame_no / FALLBACK_RUN);
        self.fallback.is_some() && (self.fallback_only || SplitMix64::new(run).next_u64() % 4 < quarters)
    }

    /// The manifest's share of each tile of a frame of `tiles` tiles, in
    /// millionths: one in MANIFEST_SHARE during its early passes, then what
    /// keeps `manifest_late` tiles per frame whichever mode the frame is
    /// drawn in, but never more than the early share.
    fn manifest_share(&self, tiles: usize) -> u64 {
        let early = MANIFEST_WHOLE / MANIFEST_SHARE as u64;
        if self.manifest.sent < MANIFEST_EARLY_PASSES * self.manifest.per_pass {
            return early;
        }
        ((self.manifest_late / tiles as f64 * MANIFEST_WHOLE as f64).round() as u64).min(early)
    }

    /// Cell colours of the next frame. Tiles spread evenly over successive
    /// frames carry the manifest, `manifest_share` of them, so late joiners
    /// see the file list first and frames with few tiles still give it its
    /// share; the rest walk through the objects one pass at a time (§4.2). Some
    /// frames are drawn in the fallback mode (`draws_fallback`), so a camera
    /// that cannot read this mode still completes without anyone changing a
    /// setting.
    pub fn next_frame(&mut self) -> Vec<[u8; 3]> {
        let (params, layout, palette) = match &self.fallback {
            Some((p, l, c)) if self.draws_fallback() => (p, l, c),
            _ => (&self.params, &self.layout, &self.palette),
        };
        self.header.bpc = params.bpc as u8;
        self.header.rs_level = header::level_for_parity(params.parity).expect("modes use a defined RS level");
        let (n, k) = (layout.tile_bytes, params.k());
        let capacity = tile::symbol_capacity(k);
        let share = self.manifest_share(layout.tiles);
        let codewords: Vec<Vec<u8>> = (0..layout.tiles)
            .map(|_| {
                self.manifest_credit += share;
                let use_manifest = self.objects.is_empty() || self.manifest_credit >= MANIFEST_WHOLE;
                let stream = if use_manifest {
                    self.manifest_credit = self.manifest_credit.saturating_sub(MANIFEST_WHOLE);
                    &mut self.manifest
                } else {
                    if self.sent_in_pass >= self.objects[self.current].per_pass {
                        self.sent_in_pass = 0;
                        self.current = (self.current + 1) % self.objects.len();
                        if self.current == 0 {
                            self.passes += 1;
                        }
                    }
                    self.sent_in_pass += 1;
                    &mut self.objects[self.current]
                };
                let packet = stream.next();
                let mut symbol = packet.data().to_vec();
                symbol.resize(capacity, 0);
                let p = TilePacket {
                    oid: stream.oid,
                    sbn: packet.payload_id().source_block_number(),
                    esi: packet.payload_id().encoding_symbol_id(),
                    transfer_len: stream.transfer_len,
                    symbol,
                };
                tile::encode(&p, n, k)
            })
            .collect();
        let cells = frame::encode(layout, palette, params.bpc, &self.header, &codewords, self.filler);
        self.header.frame_no = self.header.frame_no.wrapping_add(1);
        cells
    }
}

#[derive(Debug, PartialEq)]
pub enum ObjectState {
    Receiving { received: usize, needed: usize },
    Done,
    /// Decoded but failed authentication or its manifest checks.
    Failed,
}

#[derive(Debug, Default)]
pub struct Progress {
    pub detected: bool,
    /// A header of this session was read.
    pub synced: bool,
    pub tiles_ok: usize,
    pub tiles_total: usize,
    /// Symbols this capture added that were not already held: the measure
    /// of how fast a transfer advances, unlike tiles read.
    pub symbols_new: usize,
    /// Located by following the previous capture rather than a full search.
    pub tracked: bool,
}

/// One object's progress. The decoder exists only while symbols are still
/// needed, and a decrypted file is hashed exactly once, against the
/// manifest, so status queries cost nothing per byte received.
enum Incoming {
    Receiving { decoder: Decoder, oti: ObjectTransmissionInformation, seen: HashSet<(u8, u32)>, needed: usize },
    /// Decrypted before the manifest arrived; verified when it does.
    Unverified(Vec<u8>),
    Verified(Vec<u8>),
    Failed,
}

fn sha256(data: &[u8]) -> [u8; 32] {
    #[cfg(test)]
    tests::HASHED.with(|h| h.set(h.get() + data.len()));
    Sha256::digest(data).into()
}

pub struct Receiver {
    secret: StaticSecret,
    pk_r: [u8; 32],
    session_id: [u8; 8],
    candidates: Vec<(Params, Layout, Vec<[u8; 3]>)>,
    active: usize,
    /// Layout index and geometry of the last capture that read, for tracking.
    tracked: Option<(usize, detect::Grid)>,
    key: Option<([u8; 32], [u8; 32])>,
    object_count: Option<u8>,
    incoming: BTreeMap<u8, Incoming>,
    manifest: Option<Vec<Entry>>,
    /// The last ADVICE_WINDOW captures that read: tiles read and tiles
    /// shown for one drawn in a mode that has a fallback, None otherwise.
    recent: VecDeque<Option<(usize, usize)>>,
}

impl Receiver {
    /// `secret` must be 32 fresh random bytes.
    pub fn new(secret: [u8; 32]) -> Receiver {
        let secret = StaticSecret::from(secret);
        let pk_r = handshake::public_key(&secret);
        // The grid size is only known once a header is read, and the header's
        // cells depend on the grid, so every mode's layout is tried.
        let candidates = params::mode_names()
            .map(|name| {
                let p = Params::mode(name).expect("built-in mode");
                let layout = Layout::new(&p);
                let palette = p.palette().expect("built-in palette");
                (p, layout, palette)
            })
            .collect();
        Receiver {
            session_id: handshake::session_id(&pk_r),
            secret,
            pk_r,
            candidates,
            active: params::mode_names().position(|n| n == "standard").expect("built-in mode"),
            tracked: None,
            key: None,
            object_count: None,
            incoming: BTreeMap::new(),
            manifest: None,
            recent: VecDeque::with_capacity(ADVICE_WINDOW + 1),
        }
    }

    pub fn key_qr(&self, caps: Caps) -> String {
        handshake::key_qr(&self.pk_r, caps)
    }

    pub fn fingerprint(&self) -> String {
        handshake::fingerprint(&self.pk_r)
    }

    pub fn push(&mut self, img: &Rgb) -> Progress {
        let mut progress = Progress::default();
        if let Some((i, prev)) = self.tracked.take() {
            if let Some(grid) = detect::track(img, &self.candidates[i].1, &prev) {
                progress.detected = true;
                progress.tracked = true;
                if self.read(i, img, grid, &mut progress) {
                    return progress;
                }
                progress.tracked = false;
            }
        }
        let markers = detect::find_markers(img);
        let order: Vec<usize> = std::iter::once(self.active).chain((0..self.candidates.len()).filter(|&i| i != self.active)).collect();
        // `read` tries every mode on a grid, so each grid is fitted once.
        let mut grids = Vec::new();
        for i in order {
            let (w, h) = (self.candidates[i].0.w, self.candidates[i].0.h);
            if grids.contains(&(w, h)) {
                continue;
            }
            grids.push((w, h));
            let Some(grid) = detect::fit(&markers, &self.candidates[i].1) else { continue };
            progress.detected = true;
            if self.read(i, img, grid, &mut progress) {
                return progress;
            }
        }
        progress
    }

    /// Read a located frame with layout `i`, or with another mode on the
    /// same grid: a compact stream interleaves stable frames (§6.6). Such
    /// modes share every cell's place, so one sampling serves both; each is
    /// calibrated against its own palette strips, and the header, which
    /// carries the bpc, names the mode. True if it belonged to this session.
    fn read(&mut self, i: usize, img: &Rgb, grid: detect::Grid, progress: &mut Progress) -> bool {
        let (w, h) = (self.candidates[i].0.w, self.candidates[i].0.h);
        let colors = sample::cell_colors(img, &grid, w, h);
        let same_grid: Vec<usize> = std::iter::once(i)
            .chain((0..self.candidates.len()).filter(|&j| j != i && (self.candidates[j].0.w, self.candidates[j].0.h) == (w, h)))
            .collect();
        let Some((i, h, classifier)) = same_grid.into_iter().find_map(|j| {
            let (p, layout, palette) = &self.candidates[j];
            let classifier = Classifier::calibrate(&colors, layout, palette.len(), Metric::Rgb);
            let h = frame::read_header(&colors, layout, &classifier, frame::white_index(palette))?;
            self.accepts(&h, p).then_some((j, h, classifier))
        }) else {
            return false;
        };
        let (p, layout, _) = &self.candidates[i];
        let tiles = frame::read_tiles(&colors, layout, &classifier.refine(&colors, layout), p.bpc, p.k());
        let read = tiles.iter().flatten().count();
        self.recent.push_back(fallback_for(p).map(|_| (read, tiles.len())));
        if self.recent.len() > ADVICE_WINDOW {
            self.recent.pop_front();
        }
        self.active = i;
        self.tracked = Some((i, grid));
        progress.synced = true;
        progress.tiles_total = tiles.len();
        if self.key.is_none() {
            let Ok(key) = handshake::derive_key(&self.secret, &h.pk_e, &h.pk_e, &self.pk_r) else { return true };
            self.key = Some((key, h.pk_e));
            self.object_count = Some(h.object_count);
        }
        for packet in tiles.into_iter().flatten() {
            progress.tiles_ok += 1;
            progress.symbols_new += self.absorb(packet, h.symbol_size) as usize;
        }
        true
    }

    /// Headers come from the camera: only this session's, with parameters
    /// matching the layout it was read with, are used.
    fn accepts(&self, h: &Header, p: &Params) -> bool {
        h.session_id == self.session_id
            && h.grid_w as usize == p.w
            && h.grid_h as usize == p.h
            && h.bpc as u32 == p.bpc
            && header::parity_for_level(h.rs_level) == Some(p.parity)
            && h.symbol_size >= 8
            && h.symbol_size.is_multiple_of(8)
            && h.symbol_size as usize <= tile::symbol_capacity(p.k())
            && self.key.as_ref().is_none_or(|(_, pk_e)| *pk_e == h.pk_e)
    }

    /// True if the packet carried a symbol not already held.
    fn absorb(&mut self, p: TilePacket, t: u16) -> bool {
        let count = self.object_count.unwrap_or(0);
        if (p.oid > count) || p.transfer_len == 0 || p.transfer_len > MAX_OBJECT {
            return false;
        }
        let container = {
            let entry = self.incoming.entry(p.oid).or_insert_with(|| {
                let oti = ObjectTransmissionInformation::with_defaults(p.transfer_len, t);
                Incoming::Receiving {
                    decoder: Decoder::new(oti),
                    oti,
                    seen: HashSet::new(),
                    needed: p.transfer_len.div_ceil(oti.symbol_size() as u64) as usize,
                }
            });
            let Incoming::Receiving { decoder, oti, seen, .. } = entry else { return false };
            if p.transfer_len != oti.transfer_length() || p.sbn >= oti.source_blocks() || !seen.insert((p.sbn, p.esi)) {
                return false;
            }
            let symbol = p.symbol[..t as usize].to_vec();
            let Some(container) = decoder.decode(EncodingPacket::new(PayloadId::new(p.sbn, p.esi), symbol)) else { return true };
            container
        };
        let (key, pk_e) = self.key.as_ref().expect("tiles are only absorbed after the key is derived");
        let sealer = Sealer { key, session_id: &self.session_id, pk_e };
        let limit = if p.oid == 0 { MAX_MANIFEST } else { MAX_OBJECT as usize };
        let opened = sealer.open(p.oid, &container, limit);
        // Replacing the entry drops the decoder and its decoded blocks.
        if p.oid == 0 {
            self.manifest = opened.ok().and_then(|bytes| manifest::decode(&bytes));
            let state = if self.manifest.is_some() { Incoming::Verified(Vec::new()) } else { Incoming::Failed };
            self.incoming.insert(0, state);
            let waiting: Vec<u8> =
                self.incoming.iter().filter(|(_, s)| matches!(s, Incoming::Unverified(_))).map(|(&oid, _)| oid).collect();
            for oid in waiting {
                if let Some(Incoming::Unverified(data)) = self.incoming.remove(&oid) {
                    let state = self.verify(oid, data);
                    self.incoming.insert(oid, state);
                }
            }
        } else {
            let state = match opened {
                Ok(data) if self.manifest.is_some() => self.verify(p.oid, data),
                Ok(data) => Incoming::Unverified(data),
                Err(OpenError::AuthFailed | OpenError::TooLarge) => Incoming::Failed,
            };
            self.incoming.insert(p.oid, state);
        }
        true
    }

    /// The only place a received file is hashed: once, against its manifest entry.
    fn verify(&self, oid: u8, data: Vec<u8>) -> Incoming {
        let matches = self
            .manifest
            .as_ref()
            .and_then(|m| m.iter().find(|e| e.oid == oid))
            .is_some_and(|e| data.len() as u64 == e.size && sha256(&data) == e.sha256);
        if matches { Incoming::Verified(data) } else { Incoming::Failed }
    }

    pub fn manifest(&self) -> Option<&[Entry]> {
        self.manifest.as_deref()
    }

    pub fn state(&self, oid: u8) -> ObjectState {
        match self.incoming.get(&oid) {
            None | Some(Incoming::Unverified(_)) => ObjectState::Receiving { received: 0, needed: 0 },
            Some(Incoming::Receiving { seen, needed, .. }) => ObjectState::Receiving { received: seen.len(), needed: *needed },
            Some(Incoming::Verified(_)) => ObjectState::Done,
            Some(Incoming::Failed) => ObjectState::Failed,
        }
    }

    /// A finished file whose size and SHA-256 matched its manifest entry.
    pub fn verified(&self, oid: u8) -> Option<(&Entry, &[u8])> {
        let entry = self.manifest.as_ref()?.iter().find(|e| e.oid == oid)?;
        match self.incoming.get(&oid) {
            Some(Incoming::Verified(data)) => Some((entry, data.as_slice())),
            _ => None,
        }
    }

    /// Corners of the frame the last capture read, quiet zone included, in
    /// capture pixels: its grid's top left, top right, bottom right and
    /// bottom left. None when the last capture did not read. The receive
    /// page draws around the sender's frame with them.
    pub fn frame_corners(&self) -> Option<[(f64, f64); 4]> {
        let (i, grid) = self.tracked.as_ref()?;
        let (w, h, q) = (self.candidates[*i].0.w as f64, self.candidates[*i].0.h as f64, QUIET as f64);
        Some([(-q, -q), (w + q, -q), (w + q, h + q), (-q, h + q)].map(|(x, y)| grid.project(x, y)))
    }

    /// Bits per cell of the frame the last capture read, or None when it
    /// did not read. The receive page measures from it whether this camera
    /// reads 3-bit colours (§5 caps).
    pub fn frame_bpc(&self) -> Option<u32> {
        self.tracked.as_ref().map(|(i, _)| self.candidates[*i].0.bpc)
    }

    /// Whether the sender should draw its fallback alone
    /// (`Sender::set_fallback_only`): at least a quarter of the last
    /// ADVICE_WINDOW captures that read were drawn in a mode that has a
    /// fallback, and those gave under a tenth of their tiles — a camera
    /// that cannot tell that mode's colours apart (§6.6). It clears once
    /// such frames stop arriving.
    pub fn fallback_advised(&self) -> bool {
        let (mut frames, mut read, mut shown) = (0, 0, 0);
        for &(r, s) in self.recent.iter().flatten() {
            frames += 1;
            read += r;
            shown += s;
        }
        frames * 4 >= ADVICE_WINDOW && read * 10 < shown
    }

    pub fn complete(&self) -> bool {
        self.manifest.as_ref().is_some_and(|m| m.iter().all(|e| matches!(self.incoming.get(&e.oid), Some(Incoming::Verified(_)))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    thread_local! {
        /// Bytes passed through SHA-256 on this test's thread.
        pub(super) static HASHED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    }
    use crate::render;

    fn caps() -> Caps {
        Caps { fps: 30, bpc_mask: 0b111, max_cells: 320 }
    }

    fn files(rng: &mut SplitMix64) -> Vec<FileIn> {
        let mut photo = vec![0u8; 40_000];
        rng.fill(&mut photo);
        vec![
            FileIn { name: "notes.txt".into(), mime: "text/plain".into(), data: "beamlet ".repeat(3000).into_bytes(), thumbnail: vec![], compress: true },
            FileIn { name: "photo.jpg".into(), mime: "image/jpeg".into(), data: photo, thumbnail: vec![1, 2, 3], compress: false },
        ]
    }

    /// Stream frames through rasterisation into the receiver, dropping
    /// `drop_pct` % of them, until complete. Returns frames shown.
    fn transfer(sender: &mut Sender, receiver: &mut Receiver, drop_pct: u64, limit: usize) -> usize {
        let mut rng = SplitMix64::new(5);
        let p = sender.params().clone();
        for shown in 1..=limit {
            let cells = sender.next_frame();
            if rng.next_u64() % 100 < drop_pct {
                continue;
            }
            receiver.push(&render::rasterize(&cells, p.w, p.h, 5));
            if receiver.complete() {
                return shown;
            }
        }
        panic!("transfer did not complete within {limit} frames");
    }

    #[test]
    fn files_arrive_intact_despite_dropped_frames() {
        let mut rng = SplitMix64::new(1);
        let mut receiver = Receiver::new([7; 32]);
        let qr = receiver.key_qr(caps());
        let originals = files(&mut rng);
        let expected: Vec<(String, Vec<u8>)> = originals.iter().map(|f| (f.name.clone(), f.data.clone())).collect();
        let mut sender = Sender::new(&qr, [8; 32], originals, Params::mode("standard").unwrap(), 3).unwrap();
        assert_eq!(sender.fingerprint(), receiver.fingerprint());

        let shown = transfer(&mut sender, &mut receiver, 30, 200);
        let manifest = receiver.manifest().unwrap();
        assert_eq!(manifest.len(), 2);
        for (entry, (name, data)) in manifest.iter().zip(&expected) {
            let (e, got) = receiver.verified(entry.oid).unwrap();
            assert_eq!((&e.name, got), (name, data.as_slice()));
            assert_eq!(receiver.state(entry.oid), ObjectState::Done);
        }
        assert!(shown < 120, "took {shown} frames");
    }

    #[test]
    fn finished_files_are_hashed_once_and_drop_their_decoder() {
        let mut rng = SplitMix64::new(6);
        let mut receiver = Receiver::new([7; 32]);
        let mut sender = Sender::new(&receiver.key_qr(caps()), [8; 32], files(&mut rng), Params::mode("standard").unwrap(), 3).unwrap();
        transfer(&mut sender, &mut receiver, 0, 200);
        assert!(receiver.incoming.values().all(|s| matches!(s, Incoming::Verified(_))), "no decoder survives completion");
        let before = HASHED.with(|h| h.get());
        for _ in 0..50 {
            assert!(receiver.complete());
            for e in receiver.manifest().unwrap() {
                assert_eq!(receiver.state(e.oid), ObjectState::Done);
                assert!(receiver.verified(e.oid).is_some());
            }
        }
        assert_eq!(HASHED.with(|h| h.get()), before, "status queries hash nothing");
    }

    #[test]
    fn frames_for_another_receiver_are_ignored() {
        let mut rng = SplitMix64::new(2);
        let other = Receiver::new([1; 32]);
        let mut sender = Sender::new(&other.key_qr(caps()), [8; 32], files(&mut rng), Params::mode("standard").unwrap(), 3).unwrap();
        let mut receiver = Receiver::new([7; 32]);
        let p = sender.params().clone();
        for _ in 0..5 {
            let progress = receiver.push(&render::rasterize(&sender.next_frame(), p.w, p.h, 5));
            assert!(progress.detected && !progress.synced);
        }
        assert!(receiver.manifest().is_none());
    }

    /// A standard-mode frame at 6 px per cell pasted into a 1920x1080 grey
    /// capture at (dx, dy), as a hand-held camera would see it move.
    fn capture_at(sender: &mut Sender, dx: usize, dy: usize) -> Rgb {
        let p = sender.params().clone();
        let frame = render::rasterize(&sender.next_frame(), p.w, p.h, 6);
        let mut px = vec![96u8; 1920 * 1080 * 3];
        for y in 0..frame.h {
            let o = ((y + dy) * 1920 + dx) * 3;
            px[o..o + frame.w * 3].copy_from_slice(&frame.px[y * frame.w * 3..(y + 1) * frame.w * 3]);
        }
        Rgb { w: 1920, h: 1080, px }
    }

    #[test]
    fn a_repeated_capture_adds_no_new_symbols() {
        let mut rng = SplitMix64::new(6);
        let mut receiver = Receiver::new([7; 32]);
        let mut sender = Sender::new(&receiver.key_qr(caps()), [8; 32], files(&mut rng), Params::mode("standard").unwrap(), 3).unwrap();
        let capture = capture_at(&mut sender, 200, 100);
        let first = receiver.push(&capture);
        assert!(first.synced && first.symbols_new > 0 && first.symbols_new <= first.tiles_ok);
        let again = receiver.push(&capture);
        assert!(again.synced && again.tiles_ok == first.tiles_ok);
        assert_eq!(again.symbols_new, 0);
    }

    #[test]
    fn frame_corners_follow_the_sender_frame_in_the_capture() {
        let mut rng = SplitMix64::new(4);
        let mut receiver = Receiver::new([7; 32]);
        let mut sender = Sender::new(&receiver.key_qr(caps()), [8; 32], files(&mut rng), Params::mode("standard").unwrap(), 3).unwrap();
        // capture_at pastes the frame, quiet zone included, at 6 px per cell.
        let (fw, fh) = (6.0 * (192 + 2 * QUIET) as f64, 6.0 * (108 + 2 * QUIET) as f64);
        for (dx, dy) in [(200, 100), (203, 102), (500, 300)] {
            assert!(receiver.push(&capture_at(&mut sender, dx, dy)).synced);
            let corners = receiver.frame_corners().expect("the capture read");
            let (x, y) = (dx as f64, dy as f64);
            for (got, want) in corners.iter().zip([(x, y), (x + fw, y), (x + fw, y + fh), (x, y + fh)]) {
                assert!((got.0 - want.0).abs() < 2.0 && (got.1 - want.1).abs() < 2.0, "corner {got:?}, want {want:?}");
            }
        }
        receiver.push(&Rgb { w: 640, h: 360, px: vec![96; 640 * 360 * 3] });
        assert_eq!(receiver.frame_corners(), None, "a capture that does not read has no frame");
    }

    #[test]
    fn tracking_follows_small_motion_and_falls_back_after_a_jump() {
        let mut rng = SplitMix64::new(4);
        let mut receiver = Receiver::new([7; 32]);
        let mut sender = Sender::new(&receiver.key_qr(caps()), [8; 32], files(&mut rng), Params::mode("standard").unwrap(), 3).unwrap();
        let first = receiver.push(&capture_at(&mut sender, 200, 100));
        assert!(first.synced && !first.tracked);
        for (dx, dy) in [(203, 102), (207, 99), (204, 104)] {
            let p = receiver.push(&capture_at(&mut sender, dx, dy));
            assert!(p.synced && p.tracked, "lost track at ({dx},{dy})");
            assert_eq!(p.tiles_ok, p.tiles_total, "tiles lost while tracking at ({dx},{dy})");
        }
        let jumped = receiver.push(&capture_at(&mut sender, 500, 300));
        assert!(jumped.synced && !jumped.tracked, "a jump needs a full search");
        assert_eq!(jumped.tiles_ok, jumped.tiles_total);
    }

    #[test]
    fn picks_the_fastest_mode_the_receiver_can_take() {
        let mode = |fps, bpc_mask, max_cells| choose_mode(Caps { fps, bpc_mask, max_cells }, false).mode;
        assert_eq!(mode(30, 0b011, 192), "standard");
        assert_eq!(mode(60, 0b111, 256), "fast");
        assert_eq!(mode(120, 0b011, 320), "fastest");
        assert_eq!(mode(30, 0b011, 128), "compact");
        assert_eq!(mode(120, 0b001, 320), "stable");
        assert_eq!(mode(20, 0b111, 320), "stable");
        assert_eq!(mode(10, 0b111, 320), "stable", "nothing fits: fall back to the most robust mode");
    }

    #[test]
    fn a_small_screen_gets_compact_only_from_a_receiver_that_takes_it() {
        let small = |fps, bpc_mask, max_cells| choose_mode(Caps { fps, bpc_mask, max_cells }, true).mode;
        assert_eq!(small(30, 0b011, 192), "compact", "a browser receiver");
        assert_eq!(small(120, 0b111, 320), "compact", "never a grid too fine for a phone screen");
        assert_eq!(small(20, 0b011, 192), "stable", "a camera too slow for 15 fps");
        assert_eq!(small(30, 0b001, 192), "stable", "a receiver that reads only black and white");
    }

    #[test]
    fn every_mode_completes_a_transfer() {
        for mode in params::mode_names() {
            let mut rng = SplitMix64::new(3);
            let mut receiver = Receiver::new([9; 32]);
            let mut sender = Sender::new(&receiver.key_qr(caps()), [4; 32], files(&mut rng), Params::mode(mode).unwrap(), 1).unwrap();
            transfer(&mut sender, &mut receiver, 0, 600);
        }
    }

    #[test]
    fn the_manifest_gets_a_tenth_of_the_tiles_however_few_a_frame_has() {
        for mode in params::mode_names() {
            let mut rng = SplitMix64::new(3);
            let receiver = Receiver::new([9; 32]);
            let mut sender = Sender::new(&receiver.key_qr(caps()), [4; 32], files(&mut rng), Params::mode(mode).unwrap(), 1).unwrap();
            // Ten frames of the mode itself, whose tiles all have one size.
            sender.fallback = None;
            let source = sender.manifest.source.len();
            for _ in 0..MANIFEST_SHARE {
                sender.next_frame();
            }
            let drawn = source - sender.manifest.source.len() + sender.manifest.turn;
            assert_eq!(drawn, sender.layout.tiles, "{mode}: {drawn} manifest tiles in {MANIFEST_SHARE} frames of {}", sender.layout.tiles);
        }
    }

    /// A photo whose manifest entry carries a thumbnail the size the send
    /// page makes (80 px, about 1.8 KB).
    fn photo_with_thumbnail(rng: &mut SplitMix64) -> Vec<FileIn> {
        let mut photo = vec![0u8; 300_000];
        rng.fill(&mut photo);
        let mut thumbnail = vec![0u8; 1800];
        rng.fill(&mut thumbnail);
        vec![FileIn { name: "photo.webp".into(), mime: "image/webp".into(), data: photo, thumbnail, compress: false }]
    }

    #[test]
    fn after_its_early_passes_the_manifest_keeps_what_a_late_receiver_needs() {
        for mode in ["compact", "standard"] {
            // A session whose manifest has just gone out its early passes.
            let start = || {
                let receiver = Receiver::new([9; 32]);
                let files = photo_with_thumbnail(&mut SplitMix64::new(3));
                let mut sender = Sender::new(&receiver.key_qr(caps()), [4; 32], files, Params::mode(mode).unwrap(), 1).unwrap();
                while sender.manifest.sent < MANIFEST_EARLY_PASSES * sender.manifest.per_pass {
                    sender.next_frame();
                }
                (receiver, sender)
            };
            let (_, mut sender) = start();
            let (sent, frames) = (sender.manifest.sent, 300);
            for _ in 0..frames {
                sender.next_frame();
            }
            let per_frame = (sender.manifest.sent - sent) as f64 / frames as f64;
            let tenth = sender.layout.tiles as f64 / MANIFEST_SHARE as f64;
            assert!(per_frame < tenth / 2.0, "{mode}: {per_frame:.2} manifest tiles a frame against a tenth's {tenth:.2}");

            // A receiver that starts only now, or a few frames later, and
            // misses every fourth frame reads the file list within PREVIEW_SECS.
            for late in [0, 7, 19] {
                let (mut receiver, mut sender) = start();
                let p = sender.params().clone();
                for _ in 0..late {
                    sender.next_frame();
                }
                let limit = (PREVIEW_SECS * p.fps as f64) as usize;
                let shown = (1..=limit).find(|shown| {
                    let cells = sender.next_frame();
                    if shown % 4 != 0 {
                        receiver.push(&render::rasterize(&cells, p.w, p.h, 5));
                    }
                    receiver.manifest().is_some()
                });
                assert!(shown.is_some(), "{mode}, {late} frames later: no file list within {limit} frames");
            }
        }
    }

    #[test]
    fn the_fallback_only_switch_keeps_the_session_and_its_symbols() {
        let mut rng = SplitMix64::new(8);
        let mut receiver = Receiver::new([9; 32]);
        let qr = receiver.key_qr(caps());
        assert!(!Sender::new(&qr, [4; 32], vec![], Params::mode("standard").unwrap(), 1).unwrap().set_fallback_only(true), "standard has no fallback");
        let mut sender = Sender::new(&qr, [4; 32], files(&mut rng), Params::mode("compact").unwrap(), 1).unwrap();
        let mut held = 0;
        for _ in 0..20 {
            let p = receiver.push(&next_compact_frame(&mut sender).0);
            assert!(p.synced);
            held += p.symbols_new;
        }
        assert!(held > 0);
        assert!(sender.set_fallback_only(true));
        for _ in 0..600 {
            let (img, fallback) = next_compact_frame(&mut sender);
            assert!(fallback, "every frame is drawn in stable after the switch");
            let p = receiver.push(&img);
            assert!(p.synced, "the receiver takes the same session on");
            if receiver.complete() {
                return;
            }
        }
        panic!("transfer did not complete after the switch");
    }

    #[test]
    fn a_camera_that_cannot_read_compact_completes_sooner_on_stable_frames_alone() {
        let start = || {
            let mut rng = SplitMix64::new(8);
            let receiver = Receiver::new([9; 32]);
            let sender = Sender::new(&receiver.key_qr(caps()), [4; 32], files(&mut rng), Params::mode("compact").unwrap(), 1).unwrap();
            (sender, receiver)
        };
        let (mut sender, mut receiver) = start();
        let mixed = shown_to_a_monochrome_camera(&mut sender, &mut receiver, 2000).expect("the mixed stream completes");
        let (mut sender, mut receiver) = start();
        sender.set_fallback_only(true);
        let alone = shown_to_a_monochrome_camera(&mut sender, &mut receiver, 2000).expect("stable frames alone complete");
        assert!(alone < mixed, "{alone} frames of stable alone against {mixed} mixed");
    }

    /// Next compact-stream frame and whether it was drawn in the fallback mode.
    fn next_compact_frame(sender: &mut Sender) -> (Rgb, bool) {
        let fallback = sender.draws_fallback();
        (render::rasterize(&sender.next_frame(), 128, 72, 5), fallback)
    }

    #[test]
    fn a_compact_stream_falls_back_to_stable_frames_carrying_the_same_symbols() {
        let mut rng = SplitMix64::new(8);
        let receiver = Receiver::new([9; 32]);
        let sender = Sender::new(&receiver.key_qr(caps()), [4; 32], files(&mut rng), Params::mode("compact").unwrap(), 1).unwrap();
        let (p, _, _) = sender.fallback.as_ref().expect("compact has a fallback");
        assert_eq!(p.mode, "stable");
        assert_eq!(symbol_size(p), symbol_size(sender.params()));
        for mode in ["stable", "standard", "fast", "fastest"] {
            let s = Sender::new(&receiver.key_qr(caps()), [4; 32], vec![], Params::mode(mode).unwrap(), 1).unwrap();
            assert!(s.fallback.is_none(), "{mode} is drawn as it is");
        }
    }

    /// What a weak camera makes of a frame of `w` × `h` cells: resampled
    /// bilinearly at `px` pixels per cell, then blurred by a 3 × 3 kernel
    /// with centre weight 4, as a 720p-class webcam sees a phone screen.
    fn weak_camera(cells: &[[u8; 3]], w: usize, h: usize, px: f64) -> Rgb {
        let sharp = render::rasterize(cells, w, h, 1);
        let (iw, ih) = ((sharp.w as f64 * px).round() as usize, (sharp.h as f64 * px).round() as usize);
        let mut scaled = vec![0.0; iw * ih * 3];
        for y in 0..ih {
            for x in 0..iw {
                let c = sharp.sample((x as f64 + 0.5) / px, (y as f64 + 0.5) / px);
                scaled[(y * iw + x) * 3..][..3].copy_from_slice(&c);
            }
        }
        let mut out = vec![0u8; iw * ih * 3];
        for y in 0..ih {
            for x in 0..iw {
                for c in 0..3 {
                    let (mut sum, mut weight) = (0.0, 0.0);
                    for (dx, dy) in (-1..=1).flat_map(|dy| (-1..=1).map(move |dx| (dx, dy))) {
                        let (xx, yy) = (x as i64 + dx, y as i64 + dy);
                        if xx < 0 || yy < 0 || xx >= iw as i64 || yy >= ih as i64 {
                            continue;
                        }
                        let k = if (dx, dy) == (0, 0) { 4.0 } else { 1.0 };
                        sum += k * scaled[(yy as usize * iw + xx as usize) * 3 + c];
                        weight += k;
                    }
                    out[(y * iw + x) * 3 + c] = (sum / weight).round() as u8;
                }
            }
        }
        Rgb { w: iw, h: ih, px: out }
    }

    /// A 128 × 72 frame as the weak camera sees it at 2.565 pixels per cell,
    /// averaged to grey.
    fn monochrome(cells: &[[u8; 3]]) -> Rgb {
        let mut img = weak_camera(cells, 128, 72, 2.565);
        for px in img.px.chunks_mut(3) {
            let luma = ((px[0] as u32 + px[1] as u32 + px[2] as u32) / 3) as u8;
            px.fill(luma);
        }
        img
    }

    /// Frames shown until a monochrome webcam that sees the phone at 2.565
    /// pixels per cell, and misses every fourth frame, completes a compact
    /// stream; None if it has not after `limit` frames.
    fn shown_to_a_monochrome_camera(sender: &mut Sender, receiver: &mut Receiver, limit: usize) -> Option<usize> {
        for shown in 1..=limit {
            let cells = sender.next_frame();
            if shown % 4 == 0 {
                continue;
            }
            receiver.push(&monochrome(&cells));
            if receiver.complete() {
                return Some(shown);
            }
        }
        None
    }

    #[test]
    fn a_camera_that_cannot_read_compact_completes_from_the_stable_frames() {
        // Averaged to grey, compact's four colours become levels 85 apart,
        // too close for this camera to read; stable's black and white stay
        // 255 apart.
        let start = || {
            let mut rng = SplitMix64::new(8);
            let receiver = Receiver::new([9; 32]);
            let sender = Sender::new(&receiver.key_qr(caps()), [4; 32], files(&mut rng), Params::mode("compact").unwrap(), 1).unwrap();
            (sender, receiver)
        };
        let (mut sender, mut receiver) = start();
        sender.fallback = None;
        assert_eq!(shown_to_a_monochrome_camera(&mut sender, &mut receiver, 200), None, "this camera reads no compact frame");
        assert!(receiver.manifest().is_none());

        let (mut sender, mut receiver) = start();
        let shown = shown_to_a_monochrome_camera(&mut sender, &mut receiver, 2000).expect("the stable frames complete the transfer");
        let stable_alone = {
            let (_, mut receiver) = start();
            let mut rng = SplitMix64::new(8);
            let mut stable = Sender::new(&receiver.key_qr(caps()), [4; 32], files(&mut rng), Params::mode("stable").unwrap(), 1).unwrap();
            let mut shown = 0;
            while !receiver.complete() {
                shown += 1;
                let cells = stable.next_frame();
                if shown % 4 != 0 {
                    receiver.push(&weak_camera(&cells, 128, 72, 2.565));
                }
            }
            shown
        };
        // Compact shows 15 frames a second, stable 10.
        assert!(shown * 10 <= stable_alone * 15 * 2, "{shown} compact-stream frames against {stable_alone} of stable alone");
    }

    #[test]
    fn stable_frames_are_mixed_in_from_the_second_pass_and_more_after_it() {
        let receiver = Receiver::new([9; 32]);
        let files = photo_with_thumbnail(&mut SplitMix64::new(8));
        let mut sender = Sender::new(&receiver.key_qr(caps()), [4; 32], files, Params::mode("compact").unwrap(), 1).unwrap();
        // Share of the next `runs` runs of frames drawn in the fallback
        // mode, each run drawn in one mode, all within pass `pass`.
        let share = |runs: usize, pass: usize, sender: &mut Sender| {
            while sender.passes < pass || !sender.header.frame_no.is_multiple_of(FALLBACK_RUN) {
                sender.next_frame();
            }
            let drawn: Vec<bool> = (0..runs * FALLBACK_RUN as usize)
                .map(|_| {
                    let fallback = sender.draws_fallback();
                    sender.next_frame();
                    fallback
                })
                .collect();
            assert_eq!(sender.passes, pass, "{runs} runs lie within pass {pass}");
            for run in drawn.chunks(FALLBACK_RUN as usize) {
                assert!(run.iter().all(|&f| f == run[0]), "a run is drawn in one mode: {run:?}");
            }
            drawn.iter().filter(|&&f| f).count() as f64 / drawn.len() as f64
        };
        assert_eq!(share(40, 0, &mut sender), 0.0, "first pass");
        let second = share(40, 1, &mut sender);
        assert!((0.1..0.4).contains(&second), "second pass: {second}");
        let later = share(100, 2, &mut sender);
        assert!((0.65..0.85).contains(&later), "third pass: {later}");
    }

    #[test]
    fn a_camera_that_cannot_read_compact_is_advised_to_take_stable_frames_alone() {
        let start = || {
            let mut rng = SplitMix64::new(8);
            let receiver = Receiver::new([9; 32]);
            let sender = Sender::new(&receiver.key_qr(caps()), [4; 32], files(&mut rng), Params::mode("compact").unwrap(), 1).unwrap();
            (sender, receiver)
        };
        // A camera that reads compact is never advised to switch.
        let (mut sender, mut receiver) = start();
        for _ in 0..200 {
            receiver.push(&render::rasterize(&sender.next_frame(), 128, 72, 5));
            assert!(!receiver.fallback_advised());
        }

        // A monochrome one is, within a second of compact frames, and the
        // advice clears once the sender draws stable frames alone.
        let (mut sender, mut receiver) = start();
        let advised = (1..=ADVICE_WINDOW).find(|_| {
            assert!(receiver.push(&monochrome(&sender.next_frame())).synced, "it reads the headers");
            receiver.fallback_advised()
        });
        assert!(advised.is_some(), "no advice within {ADVICE_WINDOW} captures");
        sender.set_fallback_only(true);
        let cleared = (1..=ADVICE_WINDOW).find(|_| {
            receiver.push(&monochrome(&sender.next_frame()));
            !receiver.fallback_advised()
        });
        assert!(cleared.is_some(), "the advice stays after the switch");
        assert!(shown_to_a_monochrome_camera(&mut sender, &mut receiver, 2000).is_some());
    }

    /// A capture whose rows from the middle down show the next frame, as a
    /// rolling shutter catches the switch between two frames.
    fn torn(upper: &Rgb, lower: &Rgb) -> Rgb {
        let mut px = upper.px.clone();
        let half = upper.px.len() / 2;
        px[half..].copy_from_slice(&lower.px[half..]);
        Rgb { w: upper.w, h: upper.h, px }
    }

    #[test]
    fn a_capture_torn_within_a_run_loses_only_the_tile_under_the_tear() {
        let mut rng = SplitMix64::new(8);
        let mut receiver = Receiver::new([9; 32]);
        let mut sender = Sender::new(&receiver.key_qr(caps()), [4; 32], files(&mut rng), Params::mode("compact").unwrap(), 1).unwrap();
        let frames: Vec<(Rgb, bool)> = (0..40 * FALLBACK_RUN).map(|_| next_compact_frame(&mut sender)).collect();
        let (mut within, mut across) = (0, 0);
        for (i, pair) in frames.windows(2).enumerate() {
            let [(upper, up_fallback), (lower, low_fallback)] = pair else { unreachable!() };
            let p = receiver.push(&torn(upper, lower));
            assert!(p.synced);
            if !up_fallback {
                continue;
            }
            if *low_fallback {
                assert!(p.tiles_ok + 1 >= p.tiles_total, "frame {i}: {}/{} tiles within a run", p.tiles_ok, p.tiles_total);
                within += 1;
            } else {
                assert!(p.tiles_ok * 2 <= p.tiles_total, "frame {i}: {}/{} tiles across modes", p.tiles_ok, p.tiles_total);
                across += 1;
            }
        }
        assert!(within > 0 && across > 0, "both kinds of tear were caught: {within} within, {across} across");
    }

    #[test]
    fn a_receiver_tracks_across_interleaved_modes() {
        let mut rng = SplitMix64::new(8);
        let mut receiver = Receiver::new([9; 32]);
        let mut sender = Sender::new(&receiver.key_qr(caps()), [4; 32], files(&mut rng), Params::mode("compact").unwrap(), 1).unwrap();
        while sender.passes == 0 {
            sender.next_frame();
        }
        let first = receiver.push(&next_compact_frame(&mut sender).0);
        assert!(first.synced);
        let mut seen = HashSet::new();
        for _ in 0..8 * FALLBACK_RUN {
            let (img, fallback) = next_compact_frame(&mut sender);
            let p = receiver.push(&img);
            assert!(p.synced && p.tracked, "lost track on a {} frame", if fallback { "stable" } else { "compact" });
            assert_eq!(p.tiles_ok, p.tiles_total);
            seen.insert(fallback);
        }
        assert_eq!(seen.len(), 2, "both modes were drawn");
    }
}
