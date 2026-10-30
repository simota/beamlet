//! BOS1 optical stream (docs/STREAM_FORMAT.md): frame layout, rendering and
//! the camera-side decoding pipeline. Pure computation, no I/O, so the same
//! code runs natively and in WebAssembly.

pub mod container;
pub mod crc;
pub mod detect;
pub mod frame;
pub mod geom;
pub mod handshake;
pub mod header;
pub mod lab;
pub mod layout;
pub mod manifest;
pub mod params;
pub mod prng;
pub mod render;
pub mod rs;
pub mod sample;
pub mod session;
pub mod tile;
