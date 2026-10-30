/// SplitMix64: small, seedable and identical on every platform, so the
/// analyzer can regenerate the exact bytes the renderer drew.
pub struct SplitMix64(u64);

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    pub fn fill(&mut self, out: &mut [u8]) {
        for chunk in out.chunks_mut(8) {
            let v = self.next_u64().to_le_bytes();
            chunk.copy_from_slice(&v[..chunk.len()]);
        }
    }

    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    pub fn gaussian(&mut self) -> f64 {
        let u1 = self.next_f64().max(1e-12);
        let u2 = self.next_f64();
        (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }
}

/// Independent stream per (frame, lane); lane 0 is header/padding, lane t+1 is tile t.
pub fn stream(seed: u64, frame: u64, lane: u64) -> SplitMix64 {
    let mut s = SplitMix64::new(
        seed ^ frame.wrapping_mul(0xD1B5_4A32_D192_ED03) ^ lane.wrapping_mul(0x8CB9_2BA7_2F3D_8DD7),
    );
    s.next_u64();
    s
}
