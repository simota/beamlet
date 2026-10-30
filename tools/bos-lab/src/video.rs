use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};

use beamlet_stream::render::Rgb;

pub fn probe_fps(path: &Path) -> Result<f64, String> {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate", "-of", "default=nw=1:nk=1"])
        .arg(path)
        .output()
        .map_err(|e| format!("ffprobe: {e}"))?;
    if !out.status.success() {
        return Err(format!("ffprobe: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let (num, den) = text.trim().split_once('/').unwrap_or((text.trim(), "1"));
    let fps = num.parse::<f64>().ok().zip(den.parse::<f64>().ok()).map(|(n, d)| n / d);
    fps.filter(|f| f.is_finite() && *f > 0.0).ok_or_else(|| format!("ffprobe reported frame rate `{}`", text.trim()))
}

/// Decode every frame through ffmpeg as a PPM stream. PPM carries its own
/// dimensions, so rotation metadata on phone videos needs no special case.
pub fn for_each_frame(path: &Path, mut f: impl FnMut(&Rgb)) -> Result<usize, String> {
    let mut child = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-f", "image2pipe", "-vcodec", "ppm", "-"])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    let mut reader = BufReader::new(child.stdout.take().expect("stdout was piped"));
    let mut n = 0;
    while let Some(img) = read_ppm(&mut reader)? {
        f(&img);
        n += 1;
    }
    let status = child.wait().map_err(|e| format!("ffmpeg: {e}"))?;
    if !status.success() {
        return Err(format!("ffmpeg exited with {status}"));
    }
    Ok(n)
}

fn read_ppm(r: &mut impl BufRead) -> Result<Option<Rgb>, String> {
    let Some(magic) = token(r)? else { return Ok(None) };
    if magic != "P6" {
        return Err(format!("unexpected PPM magic `{magic}`"));
    }
    let mut field = |name: &str| -> Result<usize, String> {
        token(r)?
            .ok_or_else(|| format!("PPM header ended before {name}"))?
            .parse()
            .map_err(|e| format!("PPM {name}: {e}"))
    };
    let (w, h, max) = (field("width")?, field("height")?, field("maxval")?);
    if max != 255 {
        return Err(format!("PPM maxval {max} (expected 255)"));
    }
    let mut px = vec![0u8; w * h * 3];
    r.read_exact(&mut px).map_err(|e| format!("PPM pixels: {e}"))?;
    Ok(Some(Rgb { w, h, px }))
}

/// Next whitespace-delimited header token; consumes the single whitespace
/// byte after it, which is where PPM pixel data begins.
fn token(r: &mut impl BufRead) -> Result<Option<String>, String> {
    let mut out = String::new();
    let mut byte = [0u8; 1];
    loop {
        match r.read(&mut byte).map_err(|e| format!("PPM header: {e}"))? {
            0 if out.is_empty() => return Ok(None),
            0 => return Ok(Some(out)),
            _ if byte[0].is_ascii_whitespace() => {
                if !out.is_empty() {
                    return Ok(Some(out));
                }
            }
            _ => out.push(byte[0] as char),
        }
    }
}
