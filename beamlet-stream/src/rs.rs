//! Systematic Reed-Solomon over GF(2^8) (primitive polynomial 0x11d, first
//! consecutive root α^0), for any codeword length up to 255 — shortened
//! codes simply use fewer positions.

const fn tables() -> ([u8; 512], [u8; 256]) {
    let mut exp = [0u8; 512];
    let mut log = [0u8; 256];
    let mut x: u16 = 1;
    let mut i = 0;
    while i < 255 {
        exp[i] = x as u8;
        log[x as usize] = i as u8;
        x <<= 1;
        if x & 0x100 != 0 {
            x ^= 0x11d;
        }
        i += 1;
    }
    while i < 512 {
        exp[i] = exp[i - 255];
        i += 1;
    }
    (exp, log)
}

const TABLES: ([u8; 512], [u8; 256]) = tables();
const EXP: [u8; 512] = TABLES.0;
const LOG: [u8; 256] = TABLES.1;

fn mul(a: u8, b: u8) -> u8 {
    if a == 0 || b == 0 {
        0
    } else {
        EXP[LOG[a as usize] as usize + LOG[b as usize] as usize]
    }
}

fn div(a: u8, b: u8) -> u8 {
    if a == 0 {
        0
    } else {
        EXP[LOG[a as usize] as usize + 255 - LOG[b as usize] as usize]
    }
}

fn alpha_pow(e: usize) -> u8 {
    EXP[e % 255]
}

/// Evaluate a polynomial stored lowest degree first.
fn eval_low(poly: &[u8], x: u8) -> u8 {
    poly.iter().rev().fold(0, |acc, &c| mul(acc, x) ^ c)
}

/// Generator Π (x − α^j), j < nsym, highest degree first.
fn generator(nsym: usize) -> Vec<u8> {
    let mut g = vec![1u8];
    for j in 0..nsym {
        let root = alpha_pow(j);
        let mut next = vec![0u8; g.len() + 1];
        for (i, &c) in g.iter().enumerate() {
            next[i] ^= c;
            next[i + 1] ^= mul(c, root);
        }
        g = next;
    }
    g
}

/// `msg` followed by `nsym` parity bytes.
pub fn encode(msg: &[u8], nsym: usize) -> Vec<u8> {
    assert!(msg.len() + nsym <= 255, "RS codeword longer than 255");
    let g = generator(nsym);
    let mut rem = vec![0u8; nsym];
    for &m in msg {
        let coef = m ^ rem[0];
        rem.rotate_left(1);
        rem[nsym - 1] = 0;
        if coef != 0 {
            for j in 0..nsym {
                rem[j] ^= mul(g[j + 1], coef);
            }
        }
    }
    let mut out = msg.to_vec();
    out.extend_from_slice(&rem);
    out
}

/// Correct `codeword` in place. Returns the number of corrected bytes, or
/// None when there are more errors than nsym/2 can fix (detected failure).
pub fn decode(codeword: &mut [u8], nsym: usize) -> Option<usize> {
    let n = codeword.len();
    // Position i carries the coefficient of x^(n-1-i).
    let syndromes: Vec<u8> = (0..nsym)
        .map(|j| codeword.iter().fold(0, |acc, &c| mul(acc, alpha_pow(j)) ^ c))
        .collect();
    if syndromes.iter().all(|&s| s == 0) {
        return Some(0);
    }

    // Berlekamp–Massey: error locator Λ, lowest degree first.
    let mut lambda = vec![1u8];
    let mut prev = vec![1u8];
    let (mut l, mut shift, mut prev_d) = (0usize, 1usize, 1u8);
    for r in 0..nsym {
        let d = (1..=l).fold(syndromes[r], |acc, i| acc ^ mul(*lambda.get(i).unwrap_or(&0), syndromes[r - i]));
        if d == 0 {
            shift += 1;
            continue;
        }
        let coef = div(d, prev_d);
        let mut next = lambda.clone();
        next.resize(next.len().max(prev.len() + shift), 0);
        for (i, &p) in prev.iter().enumerate() {
            next[i + shift] ^= mul(coef, p);
        }
        if 2 * l <= r {
            prev = std::mem::replace(&mut lambda, next);
            l = r + 1 - l;
            prev_d = d;
            shift = 1;
        } else {
            lambda = next;
            shift += 1;
        }
    }
    if l > nsym / 2 {
        return None;
    }

    // Chien search: an error at index i makes Λ vanish at α^-(n-1-i).
    let positions: Vec<usize> = (0..n).filter(|&i| eval_low(&lambda, alpha_pow(255 - (n - 1 - i) % 255)) == 0).collect();
    if positions.len() != l {
        return None;
    }

    // Forney with first root α^0: e = X · Ω(X⁻¹) / Λ'(X⁻¹).
    let mut omega = vec![0u8; nsym];
    for (i, &s) in syndromes.iter().enumerate() {
        for (j, &c) in lambda.iter().enumerate() {
            if i + j < nsym {
                omega[i + j] ^= mul(s, c);
            }
        }
    }
    let derivative: Vec<u8> = lambda.iter().enumerate().skip(1).map(|(i, &c)| if i % 2 == 1 { c } else { 0 }).collect();
    for &i in &positions {
        let x = alpha_pow(n - 1 - i);
        let x_inv = div(1, x);
        let denom = eval_low(&derivative, x_inv);
        if denom == 0 {
            return None;
        }
        codeword[i] ^= mul(x, div(eval_low(&omega, x_inv), denom));
    }

    let clean = (0..nsym).all(|j| codeword.iter().fold(0, |acc, &c| mul(acc, alpha_pow(j)) ^ c) == 0);
    clean.then_some(positions.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prng::SplitMix64;

    fn corrupt(cw: &mut [u8], count: usize, rng: &mut SplitMix64) {
        let mut hit = std::collections::HashSet::new();
        while hit.len() < count {
            hit.insert((rng.next_u64() % cw.len() as u64) as usize);
        }
        for &i in &hit {
            cw[i] ^= 1 + (rng.next_u64() % 255) as u8;
        }
    }

    #[test]
    fn corrects_up_to_half_the_parity_for_full_and_shortened_codes() {
        let mut rng = SplitMix64::new(42);
        for (n, k) in [(255, 223), (255, 191), (255, 128), (128, 64)] {
            let nsym = n - k;
            for errors in [0, 1, nsym / 4, nsym / 2] {
                for _ in 0..20 {
                    let mut msg = vec![0u8; k];
                    rng.fill(&mut msg);
                    let clean = encode(&msg, nsym);
                    let mut cw = clean.clone();
                    corrupt(&mut cw, errors, &mut rng);
                    assert_eq!(decode(&mut cw, nsym), Some(errors), "RS({n},{k}) with {errors} errors");
                    assert_eq!(cw, clean);
                }
            }
        }
    }

    #[test]
    fn reports_failure_beyond_the_correction_limit() {
        let mut rng = SplitMix64::new(7);
        let (n, k) = (255, 191);
        let mut failures = 0;
        for _ in 0..50 {
            let mut msg = vec![0u8; k];
            rng.fill(&mut msg);
            let mut cw = encode(&msg, n - k);
            corrupt(&mut cw, (n - k) / 2 + 5, &mut rng);
            if decode(&mut cw, n - k).is_none() {
                failures += 1;
            }
        }
        // Miscorrection beyond the limit is possible but rare for 64 parity bytes.
        assert!(failures >= 48, "only {failures}/50 overloads were detected");
    }
}
