mod pngio;
mod sim;
mod video;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::str::FromStr;

use beamlet_stream::lab::Analyzer;
use beamlet_stream::layout::{self, Layout, Role};
use beamlet_stream::params::{self, Params};
use beamlet_stream::render;
use beamlet_stream::sample::Metric;

const USAGE: &str = "\
bos-lab — offline measurement for BOS1 (docs/STREAM_FORMAT.md)

USAGE
  bos-lab layout
      Capacity of every mode as actually laid out.
  bos-lab render --out DIR [STREAM] [--mp4]
      Write DIR/frames/*.png (1 px per cell), DIR/manifest.txt and DIR/player.html.
      --mp4 also writes DIR/stream.mp4 (needs ffmpeg).
  bos-lab analyze --manifest DIR/manifest.txt --capture FILE [--metric rgb|ycc] [--csv OUT]
      Decode a recorded video (any format ffmpeg reads) or a single PNG against the manifest.
  bos-lab sim [STREAM] [--cell-px N] [--captures N] [--fill F] [--metric rgb|ycc] [--dump DIR]
      Run the synthetic camera scenarios and report how the analyzer copes.

STREAM
  --mode stable|compact|standard|fast|fastest   base parameters (default standard)
  --grid WxH --bpc N --parity F --fps N --palette NAME --seed N --frames N
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((cmd, rest)) = args.split_first() else {
        eprint!("{USAGE}");
        return ExitCode::from(2);
    };
    let result = Opts::parse(rest).and_then(|opts| match cmd.as_str() {
        "layout" => cmd_layout(),
        "render" => cmd_render(&opts),
        "analyze" => cmd_analyze(&opts),
        "sim" => cmd_sim(&opts),
        "help" | "--help" | "-h" => {
            print!("{USAGE}");
            Ok(())
        }
        _ => Err(format!("unknown command `{cmd}`\n\n{USAGE}")),
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

struct Opts(HashMap<String, String>);

impl Opts {
    fn parse(args: &[String]) -> Result<Opts, String> {
        let mut map = HashMap::new();
        let mut it = args.iter().peekable();
        while let Some(arg) = it.next() {
            let key = arg.strip_prefix("--").ok_or_else(|| format!("unexpected argument `{arg}`"))?;
            let value = match it.peek() {
                Some(v) if !v.starts_with("--") => it.next().unwrap().clone(),
                _ => "true".to_string(),
            };
            map.insert(key.to_string(), value);
        }
        Ok(Opts(map))
    }

    fn get<T: FromStr>(&self, key: &str) -> Result<Option<T>, String>
    where
        T::Err: std::fmt::Display,
    {
        self.0.get(key).map(|v| v.parse::<T>().map_err(|e| format!("--{key} {v}: {e}"))).transpose()
    }

    fn path(&self, key: &str) -> Result<PathBuf, String> {
        self.0.get(key).map(PathBuf::from).ok_or_else(|| format!("--{key} is required"))
    }

    fn stream(&self) -> Result<Params, String> {
        let mut p = Params::mode(self.0.get("mode").map_or("standard", String::as_str))?;
        if let Some(grid) = self.0.get("grid") {
            let (w, h) = grid.split_once('x').ok_or_else(|| format!("--grid {grid}: expected WxH"))?;
            p.w = w.parse().map_err(|e| format!("--grid {grid}: {e}"))?;
            p.h = h.parse().map_err(|e| format!("--grid {grid}: {e}"))?;
        }
        p.bpc = self.get("bpc")?.unwrap_or(p.bpc);
        p.parity = self.get("parity")?.unwrap_or(p.parity);
        p.fps = self.get("fps")?.unwrap_or(p.fps);
        p.palette = self.get("palette")?.unwrap_or(p.palette);
        p.seed = self.get("seed")?.unwrap_or(p.seed);
        p.frames = self.get("frames")?.unwrap_or(p.frames);
        p.validate()?;
        Ok(p)
    }
}

fn cmd_layout() -> Result<(), String> {
    println!(
        "{:<9} {:>9} {:>3} {:>7} {:>9} {:>6} {:>10} {:>10} {:>10}",
        "mode", "grid", "bpc", "parity", "data", "tiles", "B/frame", "KB/s", "doc KB/s"
    );
    for name in params::mode_names() {
        let p = Params::mode(name)?;
        let layout = Layout::new(&p);
        let data = layout.count(|r| matches!(r, Role::Data));
        let per_frame = layout.tiles * p.payload();
        // §6.6 estimate: 85 % of cells usable, no per-tile header.
        let doc = (p.w * p.h) as f64 * 0.85 * p.bpc as f64 / 8.0 * (1.0 - p.parity);
        println!(
            "{:<9} {:>9} {:>3} {:>7} {:>8.1}% {:>6} {:>10} {:>10.1} {:>10.1}",
            name,
            format!("{}x{}", p.w, p.h),
            p.bpc,
            p.parity,
            100.0 * data as f64 / (p.w * p.h) as f64,
            layout.tiles,
            per_frame,
            per_frame as f64 * p.fps as f64 / 1024.0,
            doc * p.fps as f64 / 1024.0,
        );
    }
    println!("\nKB/s is the ideal payload rate at the mode's display fps with no tile loss.");
    Ok(())
}

fn cmd_render(opts: &Opts) -> Result<(), String> {
    let p = opts.stream()?;
    let out = opts.path("out")?;
    let frames_dir = out.join("frames");
    fs::create_dir_all(&frames_dir).map_err(|e| format!("{}: {e}", frames_dir.display()))?;
    let layout = Layout::new(&p);
    let palette = p.palette()?;
    for f in 0..p.frames {
        let cells = render::frame_cells(&layout, &palette, p.bpc, p.seed, f as u64);
        pngio::write_png(&frames_dir.join(format!("f{f:05}.png")), &render::rasterize(&cells, p.w, p.h, 1))?;
    }
    write(&out.join("manifest.txt"), &p.to_manifest())?;
    write(&out.join("player.html"), &player_html(&p))?;
    if opts.get::<bool>("mp4")?.unwrap_or(false) {
        encode_mp4(&p, &out)?;
    }
    println!("wrote {} frames ({} tiles × {} B payload each) to {}", p.frames, layout.tiles, p.payload(), out.display());
    Ok(())
}

fn write(path: &Path, text: &str) -> Result<(), String> {
    fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Integer nearest-neighbour upscale to fit 1920×1080. The factor is kept
/// even so 4:2:0 chroma blocks never straddle two cells.
fn encode_mp4(p: &Params, out: &Path) -> Result<(), String> {
    let (iw, ih) = (p.w + 2 * layout::QUIET, p.h + 2 * layout::QUIET);
    let scale = ((1920 / iw).min(1080 / ih) / 2 * 2).max(2);
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-framerate", &p.fps.to_string(), "-i"])
        .arg(out.join("frames/f%05d.png"))
        .args(["-vf", &format!("scale=iw*{scale}:ih*{scale}:flags=neighbor")])
        .args(["-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p"])
        .arg(out.join("stream.mp4"))
        .status()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    if !status.success() {
        return Err(format!("ffmpeg exited with {status}"));
    }
    Ok(())
}

fn player_html(p: &Params) -> String {
    include_str!("player.html")
        .replace("__W__", &p.w.to_string())
        .replace("__H__", &p.h.to_string())
        .replace("__Q__", &layout::QUIET.to_string())
        .replace("__FPS__", &p.fps.to_string())
        .replace("__FRAMES__", &p.frames.to_string())
}

fn cmd_analyze(opts: &Opts) -> Result<(), String> {
    let manifest = opts.path("manifest")?;
    let text = fs::read_to_string(&manifest).map_err(|e| format!("{}: {e}", manifest.display()))?;
    let p = Params::from_manifest(&text)?;
    let capture = opts.path("capture")?;
    let mut analyzer = Analyzer::new(p, opts.get("metric")?.unwrap_or(Metric::Rgb))?;
    let is_png = capture.extension().is_some_and(|e| e.eq_ignore_ascii_case("png"));
    let fps = if is_png {
        sim::timed_push(&mut analyzer, &pngio::read_png(&capture)?);
        1.0
    } else {
        video::for_each_frame(&capture, |img| sim::timed_push(&mut analyzer, img))?;
        video::probe_fps(&capture)?
    };
    print!("{}", analyzer.report(fps));
    if let Some(csv) = opts.get::<PathBuf>("csv")? {
        write(&csv, &analyzer.csv())?;
    }
    Ok(())
}

fn cmd_sim(opts: &Opts) -> Result<(), String> {
    let p = opts.stream()?;
    let cell_px = opts.get("cell-px")?.unwrap_or(5);
    let captures = opts.get("captures")?.unwrap_or(4);
    // Fraction of the 1920x1080 capture the frame fills; sets the camera
    // pixels per cell (about fill x 9.3 for the standard grid).
    let fill: Option<f64> = opts.get("fill")?;
    let metric = opts.get("metric")?.unwrap_or(Metric::Rgb);
    let dump: Option<PathBuf> = opts.get("dump")?;
    if let Some(dir) = &dump {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    println!(
        "grid {}x{} bpc={} parity={} palette={} cell_px={} metric={:?}, {} captures per scenario\n",
        p.w, p.h, p.bpc, p.parity, p.palette, cell_px, metric, captures
    );
    println!("{:<10} {:>9} {:>14} {:>10} {:>6} {:>9}", "scenario", "detected", "tiles ok", "cell err", "torn", "ms/frame");
    for (name, mut d) in sim::scenarios() {
        if let Some(f) = fill {
            d.fill = f;
        }
        let path = dump.as_ref().map(|dir| dir.join(name));
        let a = sim::run(&p, &d, captures, cell_px, metric, path.as_deref())?;
        let s = &a.stats;
        println!(
            "{:<10} {:>9} {:>14} {:>9.4}% {:>6} {:>9.1}",
            name,
            format!("{}/{}", s.detected, s.captures),
            format!("{}/{} ({:.0}%)", s.tiles_ok, s.tiles_seen, 100.0 * s.tiles_ok as f64 / s.tiles_seen.max(1) as f64),
            100.0 * s.cell_errors as f64 / s.cells.max(1) as f64,
            s.mixed,
            1e3 * s.seconds / s.captures.max(1) as f64,
        );
    }
    Ok(())
}
