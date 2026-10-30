use std::collections::HashMap;

/// One RS(n, k) codeword per tile, n at most 255 (STREAM_FORMAT.md §6.3).
pub const MAX_TILE_BYTES: usize = 255;
/// OID + SBN + ESI + F + CRC32 (STREAM_FORMAT.md §6.3).
pub const TILE_HEADER: usize = 14;

/// Mode table from STREAM_FORMAT.md §6.6: (name, W, H, bpc, parity, display fps).
const MODES: [(&str, usize, usize, u32, f64, u32); 5] = [
    ("stable", 128, 72, 1, 0.5, 10),
    ("compact", 128, 72, 2, 0.25, 15),
    ("standard", 192, 108, 2, 0.25, 15),
    ("fast", 256, 144, 3, 0.25, 30),
    ("fastest", 320, 180, 2, 0.25, 60),
];

pub fn mode_names() -> impl Iterator<Item = &'static str> {
    MODES.iter().map(|m| m.0)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Params {
    pub mode: String,
    pub w: usize,
    pub h: usize,
    pub bpc: u32,
    pub parity: f64,
    pub fps: u32,
    pub palette: String,
    pub seed: u64,
    pub frames: usize,
}

impl Params {
    pub fn mode(name: &str) -> Result<Params, String> {
        MODES
            .iter()
            .find(|m| m.0 == name)
            .map(|&(mode, w, h, bpc, parity, fps)| Params {
                mode: mode.to_string(),
                w,
                h,
                bpc,
                parity,
                fps,
                palette: "default".to_string(),
                seed: 1,
                frames: 120,
            })
            .ok_or_else(|| format!("unknown mode `{name}` (stable|compact|standard|fast|fastest)"))
    }

    /// RS message length k of the tile codeword: the parity's share of 255
    /// bytes, but no more than any built-in mode on the same grid takes.
    /// Modes sharing a grid then share the RaptorQ symbol size whatever
    /// their bpc and parity, so one stream can mix their frames
    /// (compact's tiles are shortened to stable's message, §6.3).
    pub fn k(&self) -> usize {
        let full = |parity: f64| (MAX_TILE_BYTES as f64 * (1.0 - parity)).round() as usize;
        MODES
            .iter()
            .filter(|m| (m.1, m.2) == (self.w, self.h))
            .map(|m| full(m.4))
            .fold(full(self.parity), usize::min)
    }

    /// RS codeword length n of a tile: k plus the parity.
    pub fn tile_bytes(&self) -> usize {
        MAX_TILE_BYTES.min((self.k() as f64 / (1.0 - self.parity)).round() as usize)
    }

    /// Byte errors a bounded-distance RS decoder fixes per tile.
    pub fn correctable(&self) -> usize {
        (self.tile_bytes() - self.k()) / 2
    }

    /// RaptorQ symbol bytes a decodable tile delivers.
    pub fn payload(&self) -> usize {
        self.k().saturating_sub(TILE_HEADER)
    }

    pub fn palette(&self) -> Result<Vec<[u8; 3]>, String> {
        palette(self.bpc, &self.palette)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.w < 48 || self.h < 48 {
            return Err(format!("grid {}x{} is too small (min 48x48)", self.w, self.h));
        }
        if !(0.0..1.0).contains(&self.parity) {
            return Err(format!("parity {} must be in [0, 1)", self.parity));
        }
        if self.frames < 2 {
            return Err("frames must be at least 2".to_string());
        }
        self.palette().map(|_| ())
    }

    pub fn to_manifest(&self) -> String {
        format!(
            "mode={}\nw={}\nh={}\nbpc={}\nparity={}\nfps={}\npalette={}\nseed={}\nframes={}\n",
            self.mode, self.w, self.h, self.bpc, self.parity, self.fps, self.palette, self.seed, self.frames
        )
    }

    pub fn from_manifest(text: &str) -> Result<Params, String> {
        let kv: HashMap<&str, &str> = text
            .lines()
            .filter_map(|l| l.split_once('='))
            .map(|(k, v)| (k.trim(), v.trim()))
            .collect();
        let get = |k: &str| kv.get(k).copied().ok_or_else(|| format!("manifest is missing `{k}`"));
        let num = |k: &str| -> Result<f64, String> {
            get(k)?.parse::<f64>().map_err(|e| format!("manifest `{k}`: {e}"))
        };
        let p = Params {
            mode: get("mode")?.to_string(),
            w: num("w")? as usize,
            h: num("h")? as usize,
            bpc: num("bpc")? as u32,
            parity: num("parity")?,
            fps: num("fps")? as u32,
            palette: get("palette")?.to_string(),
            seed: get("seed")?.parse().map_err(|e| format!("manifest `seed`: {e}"))?,
            frames: num("frames")? as usize,
        };
        p.validate()?;
        Ok(p)
    }
}

const K: [u8; 3] = [0, 0, 0];
const W: [u8; 3] = [255, 255, 255];

/// Palette indexed by symbol value. Symbol codes are chosen so the colour
/// pairs a camera confuses most (dark with dark, bright with bright) differ
/// in one bit (STREAM_FORMAT.md §6.4).
pub fn palette(bpc: u32, name: &str) -> Result<Vec<[u8; 3]>, String> {
    match (bpc, name) {
        (1, "default" | "bw") => Ok(vec![K, W]),
        (2, "default" | "kwrc") => Ok(vec![K, [255, 0, 0], W, [0, 255, 255]]),
        (2, "kwby") => Ok(vec![K, [0, 0, 255], W, [255, 255, 0]]),
        // One bit per RGB channel: a single-channel misread is a single-bit error.
        (3, "default" | "rgb8") => Ok((0..8u8)
            .map(|s| [(s >> 2 & 1) * 255, (s >> 1 & 1) * 255, (s & 1) * 255])
            .collect()),
        _ => Err(format!(
            "no palette `{name}` for bpc={bpc} (bpc1: bw, bpc2: kwrc|kwby, bpc3: rgb8)"
        )),
    }
}
