/// Planar homography, row-major 3×3 with h[8] = 1.
#[derive(Clone, Copy, Debug)]
pub struct Homography([f64; 9]);

impl Homography {
    pub fn from_points(src: [(f64, f64); 4], dst: [(f64, f64); 4]) -> Option<Homography> {
        let mut a = [[0.0f64; 9]; 8];
        for (i, (&(x, y), &(u, v))) in src.iter().zip(&dst).enumerate() {
            a[2 * i] = [x, y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y, u];
            a[2 * i + 1] = [0.0, 0.0, 0.0, x, y, 1.0, -v * x, -v * y, v];
        }
        let h = solve8(a)?;
        Some(Homography([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0]))
    }

    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        let m = &self.0;
        let d = m[6] * x + m[7] * y + m[8];
        ((m[0] * x + m[1] * y + m[2]) / d, (m[3] * x + m[4] * y + m[5]) / d)
    }

    pub fn inverse(&self) -> Option<Homography> {
        let m = &self.0;
        let c = [
            m[4] * m[8] - m[5] * m[7],
            m[2] * m[7] - m[1] * m[8],
            m[1] * m[5] - m[2] * m[4],
            m[5] * m[6] - m[3] * m[8],
            m[0] * m[8] - m[2] * m[6],
            m[2] * m[3] - m[0] * m[5],
            m[3] * m[7] - m[4] * m[6],
            m[1] * m[6] - m[0] * m[7],
            m[0] * m[4] - m[1] * m[3],
        ];
        let det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
        if det.abs() < 1e-12 || c[8].abs() < 1e-12 {
            return None;
        }
        Some(Homography(c.map(|v| v / c[8])))
    }
}

/// Gaussian elimination with partial pivoting on an 8×8 augmented system.
fn solve8(mut a: [[f64; 9]; 8]) -> Option<[f64; 8]> {
    for col in 0..8 {
        let pivot = (col..8).max_by(|&i, &j| a[i][col].abs().total_cmp(&a[j][col].abs()))?;
        if a[pivot][col].abs() < 1e-12 {
            return None;
        }
        a.swap(col, pivot);
        for row in 0..8 {
            if row != col {
                let f = a[row][col] / a[col][col];
                let pivot_row = a[col];
                for (v, p) in a[row][col..].iter_mut().zip(&pivot_row[col..]) {
                    *v -= f * p;
                }
            }
        }
    }
    let mut x = [0.0; 8];
    for i in 0..8 {
        x[i] = a[i][8] / a[i][i];
    }
    Some(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_four_points_and_inverts() {
        let src = [(0.0, 0.0), (10.0, 0.0), (0.0, 5.0), (10.0, 5.0)];
        let dst = [(100.0, 50.0), (300.0, 70.0), (90.0, 180.0), (320.0, 210.0)];
        let h = Homography::from_points(src, dst).unwrap();
        let inv = h.inverse().unwrap();
        for (s, d) in src.iter().zip(&dst) {
            let (u, v) = h.apply(s.0, s.1);
            assert!((u - d.0).abs() < 1e-6 && (v - d.1).abs() < 1e-6);
            let (x, y) = inv.apply(d.0, d.1);
            assert!((x - s.0).abs() < 1e-6 && (y - s.1).abs() < 1e-6);
        }
    }
}
