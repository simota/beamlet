//! Exports for the send and receive pages (`web/send.js`, `web/receive.js`).
//!
//! Inputs go through one shared buffer (`app_input`), outputs through
//! another whose length `app_out_len` reports. Randomness comes from the
//! page (`crypto.getRandomValues`).

use std::cell::RefCell;

use beamlet_stream::handshake::{self, Caps};
use beamlet_stream::layout::QUIET;
use beamlet_stream::params::{self, Params};
use beamlet_stream::render::{self, Rgb};
use beamlet_stream::session::{self, FileIn, ObjectState, Receiver, Sender};

#[derive(Default)]
struct App {
    input: Vec<u8>,
    /// RGB copy of the latest capture, reused so a frame allocates nothing.
    rgb: Vec<u8>,
    out: Vec<u8>,
    receiver: Option<Receiver>,
    /// New symbols from the last `rx_push`; the packed result has no room.
    symbols_new: u32,
    key_qr: Option<String>,
    /// The scanned receiver's camera, which `tx_mode` fits to this screen.
    caps: Option<Caps>,
    pending: PendingFile,
    files: Vec<FileIn>,
    sender: Option<Sender>,
}

/// Metadata of the file being added, set before its contents arrive.
#[derive(Default)]
struct PendingFile {
    name: String,
    mime: String,
    thumbnail: Vec<u8>,
}

thread_local! {
    static APP: RefCell<App> = RefCell::new(App::default());
}

fn with<T>(f: impl FnOnce(&mut App) -> T) -> T {
    APP.with_borrow_mut(f)
}

fn emit(app: &mut App, bytes: Vec<u8>) -> *const u8 {
    app.out = bytes;
    app.out.as_ptr()
}

fn secret(app: &App) -> [u8; 32] {
    app.input[..32].try_into().expect("the page writes 32 random bytes before this call")
}

/// The RGBA input as RGB, written into the reused buffer; hand the buffer
/// back with `app.rgb = img.px` when done.
fn input_rgb(app: &mut App, w: u32, h: u32) -> Rgb {
    let mut px = std::mem::take(&mut app.rgb);
    px.clear();
    px.extend(app.input.as_chunks::<4>().0.iter().flat_map(|c| [c[0], c[1], c[2]]));
    Rgb { w: w as usize, h: h as usize, px }
}

fn mode_index(p: &Params) -> i32 {
    params::mode_names().position(|n| n == p.mode).map_or(-1, |i| i as i32)
}

/// Buffer of `len` bytes for the page to fill before the next call.
#[no_mangle]
pub extern "C" fn app_input(len: u32) -> *mut u8 {
    with(|app| {
        app.input.resize(len as usize, 0);
        app.input.as_mut_ptr()
    })
}

#[no_mangle]
pub extern "C" fn app_out_len() -> u32 {
    with(|app| app.out.len() as u32)
}

// ---- receiver ----

/// New receiver from the 32 random bytes in the input buffer.
#[no_mangle]
pub extern "C" fn rx_new() {
    with(|app| app.receiver = Some(Receiver::new(secret(app))));
}

/// Key code as a QR module matrix (1 = dark), side² bytes.
#[no_mangle]
pub extern "C" fn rx_key_qr(fps: u32, bpc_mask: u32, max_cells: u32) -> *const u8 {
    with(|app| {
        let caps = Caps { fps: fps.min(255) as u8, bpc_mask: bpc_mask as u8, max_cells: max_cells.min(u16::MAX as u32) as u16 };
        let text = app.receiver.as_ref().expect("rx_new first").key_qr(caps);
        let code = qrcode::QrCode::with_error_correction_level(text.as_bytes(), qrcode::EcLevel::M)
            .expect("a 61-character key code always fits a QR code");
        let modules = code.to_colors().iter().map(|c| (*c == qrcode::Color::Dark) as u8).collect();
        emit(app, modules)
    })
}

#[no_mangle]
pub extern "C" fn rx_fingerprint() -> *const u8 {
    with(|app| {
        let fp = app.receiver.as_ref().expect("rx_new first").fingerprint().into_bytes();
        emit(app, fp)
    })
}

/// Feed the w×h RGBA capture in the input buffer. Returns
/// tiles_ok | tiles_total << 12 | detected << 24 | synced << 25 | tracked << 26.
#[no_mangle]
pub extern "C" fn rx_push(w: u32, h: u32) -> u32 {
    with(|app| {
        let img = input_rgb(app, w, h);
        let p = app.receiver.as_mut().expect("rx_new first").push(&img);
        app.rgb = img.px;
        app.symbols_new = p.symbols_new as u32;
        p.tiles_ok as u32
            | (p.tiles_total as u32) << 12
            | (p.detected as u32) << 24
            | (p.synced as u32) << 25
            | (p.tracked as u32) << 26
    })
}

/// Symbols the last `rx_push` added that were not already held.
#[no_mangle]
pub extern "C" fn rx_symbols_new() -> u32 {
    with(|app| app.symbols_new)
}

/// Session state as JSON: {"complete":bool,"files":[{oid,name,mime,size,state,received,needed}]|null}.
#[no_mangle]
pub extern "C" fn rx_status() -> *const u8 {
    with(|app| {
        let rx = app.receiver.as_ref().expect("rx_new first");
        let files = rx.manifest().map(|entries| {
            let items: Vec<String> = entries
                .iter()
                .map(|e| {
                    let (state, received, needed) = match rx.state(e.oid) {
                        ObjectState::Receiving { received, needed } => ("receiving", received, needed),
                        ObjectState::Done => ("done", 0, 0),
                        ObjectState::Failed => ("failed", 0, 0),
                    };
                    format!(
                        r#"{{"oid":{},"name":{},"mime":{},"size":{},"state":"{state}","received":{received},"needed":{needed}}}"#,
                        e.oid,
                        json_string(&e.name),
                        json_string(&e.mime),
                        e.size
                    )
                })
                .collect();
            format!("[{}]", items.join(","))
        });
        let json = format!(r#"{{"complete":{},"files":{}}}"#, rx.complete(), files.as_deref().unwrap_or("null"));
        emit(app, json.into_bytes())
    })
}

/// A verified file's bytes, or null while it is incomplete.
#[no_mangle]
pub extern "C" fn rx_file(oid: u32) -> *const u8 {
    with(|app| {
        let data = app.receiver.as_ref().expect("rx_new first").verified(oid as u8).map(|(_, d)| d.to_vec());
        match data {
            Some(d) => emit(app, d),
            None => std::ptr::null(),
        }
    })
}

/// A file's preview image from the manifest, or null if it has none or
/// the manifest has not arrived.
#[no_mangle]
pub extern "C" fn rx_thumbnail(oid: u32) -> *const u8 {
    with(|app| {
        let rx = app.receiver.as_ref().expect("rx_new first");
        let thumb = rx.manifest().and_then(|m| m.iter().find(|e| e.oid == oid as u8)).map(|e| e.thumbnail.clone());
        match thumb {
            Some(t) if !t.is_empty() => emit(app, t),
            _ => std::ptr::null(),
        }
    })
}

fn json_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// ---- sender ----

/// Look for the receiver's key code in the w×h RGBA capture. Returns the
/// index of the fastest mode that receiver takes, or -1 if no key code was
/// read; `tx_mode` then fits it to the sender's screen.
#[no_mangle]
pub extern "C" fn tx_scan(w: u32, h: u32) -> i32 {
    with(|app| {
        let (w, h) = (w as usize, h as usize);
        let px = &app.input;
        let mut prepared = rqrr::PreparedImage::prepare_from_greyscale(w, h, |x, y| {
            let i = (y * w + x) * 4;
            ((px[i] as u32 * 299 + px[i + 1] as u32 * 587 + px[i + 2] as u32 * 114) / 1000) as u8
        });
        let found = prepared.detect_grids().into_iter().find_map(|grid| {
            let (_, text) = grid.decode().ok()?;
            let (_, caps) = handshake::parse_key_qr(&text).ok()?;
            Some((text, caps))
        });
        match found {
            Some((text, caps)) => {
                app.key_qr = Some(text);
                app.caps = Some(caps);
                mode_index(&session::choose_mode(caps, false))
            }
            None => -1,
        }
    })
}

/// Index of the mode for the scanned receiver on this sender's screen: the
/// `tx_scan` one, or when `small_screen` is 1 the fastest the receiver
/// takes among grids a phone screen can show. -1 before a key code was read.
#[no_mangle]
pub extern "C" fn tx_mode(small_screen: u32) -> i32 {
    with(|app| app.caps.map_or(-1, |caps| mode_index(&session::choose_mode(caps, small_screen != 0))))
}

#[no_mangle]
pub extern "C" fn tx_clear_files() {
    with(|app| app.files.clear());
}

/// Name (UTF-8) of the next file, from the input buffer.
#[no_mangle]
pub extern "C" fn tx_file_name() {
    with(|app| app.pending.name = String::from_utf8_lossy(&app.input).into_owned());
}

#[no_mangle]
pub extern "C" fn tx_file_mime() {
    with(|app| app.pending.mime = String::from_utf8_lossy(&app.input).into_owned());
}

/// Preview image (e.g. a small JPEG) of the next file, from the input buffer.
#[no_mangle]
pub extern "C" fn tx_file_thumb() {
    with(|app| app.pending.thumbnail = std::mem::take(&mut app.input));
}

/// Contents of the next file, from the input buffer.
#[no_mangle]
pub extern "C" fn tx_file_data(compress: u32) {
    with(|app| {
        let PendingFile { name, mime, thumbnail } = std::mem::take(&mut app.pending);
        let data = std::mem::take(&mut app.input);
        app.files.push(FileIn { name, mime, data, thumbnail, compress: compress != 0 });
    })
}

/// Start sending the added files in mode `mode`, with the 32 random bytes
/// in the input buffer as the ephemeral secret. 0 on success, -1 without a
/// scanned key code, -2 if the key code is unusable.
#[no_mangle]
pub extern "C" fn tx_start(mode: u32, filler: u32) -> i32 {
    with(|app| {
        let Some(qr) = app.key_qr.clone() else { return -1 };
        let Some(p) = params::mode_names().nth(mode as usize).and_then(|n| Params::mode(n).ok()) else { return -2 };
        let files = std::mem::take(&mut app.files);
        match Sender::new(&qr, secret(app), files, p, filler as u64) {
            Ok(s) => {
                app.sender = Some(s);
                0
            }
            Err(_) => -2,
        }
    })
}

#[no_mangle]
pub extern "C" fn tx_fingerprint() -> *const u8 {
    with(|app| {
        let fp = app.sender.as_ref().expect("tx_start first").fingerprint().as_bytes().to_vec();
        emit(app, fp)
    })
}

#[no_mangle]
pub extern "C" fn tx_frame_width() -> u32 {
    with(|app| (app.sender.as_ref().expect("tx_start first").params().w + 2 * QUIET) as u32)
}

#[no_mangle]
pub extern "C" fn tx_frame_height() -> u32 {
    with(|app| (app.sender.as_ref().expect("tx_start first").params().h + 2 * QUIET) as u32)
}

/// Next frame as RGBA at one pixel per cell, quiet zone included; the page
/// scales it by an integer factor.
#[no_mangle]
pub extern "C" fn tx_frame() -> *const u8 {
    with(|app| {
        let sender = app.sender.as_mut().expect("tx_start first");
        let (w, h) = (sender.params().w, sender.params().h);
        let rgb = render::rasterize(&sender.next_frame(), w, h, 1);
        let rgba = rgb.px.as_chunks::<3>().0.iter().flat_map(|c| [c[0], c[1], c[2], 255]).collect();
        emit(app, rgba)
    })
}
