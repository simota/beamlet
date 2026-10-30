#!/usr/bin/env python3
"""Synthesize a custom 38.0-second stereo 48kHz soundtrack + frame-locked sound design
for the Beamlet promotional film, mastered cleanly without clipping.
"""
import subprocess
import wave
from pathlib import Path
import numpy as np

SR = 48000
DURATION = 38.0
N = int(SR * DURATION)

SCRIPT_DIR = Path(__file__).resolve().parent
PUBLIC_ASSETS = SCRIPT_DIR.parent / "public" / "assets"
PROMO_ASSETS = SCRIPT_DIR.parent.parent / "assets"


def midi_to_hz(m: float) -> float:
    return 440.0 * (2.0 ** ((m - 69.0) / 12.0))


def env_adsr(length: int, a: float, d: float, s_level: float, r: float) -> np.ndarray:
    t = np.arange(length, dtype=np.float64) / SR
    dur = length / SR
    out = np.zeros(length, dtype=np.float64)
    a = max(a, 0.002)
    d = max(d, 0.005)
    r = max(r, 0.01)
    rel_start = max(a + d, dur - r)
    for idx in range(length):
        ti = t[idx]
        if ti < a:
            out[idx] = ti / a
        elif ti < a + d:
            out[idx] = 1.0 - (1.0 - s_level) * ((ti - a) / d)
        elif ti < rel_start:
            out[idx] = s_level
        else:
            rem = max(dur - rel_start, 1e-4)
            out[idx] = s_level * max(0.0, 1.0 - (ti - rel_start) / rem) ** 1.6
    return out


def add_stereo(mix_l: np.ndarray, mix_r: np.ndarray, start_s: float, sig_l: np.ndarray, sig_r: np.ndarray = None, gain: float = 1.0):
    if sig_r is None:
        sig_r = sig_l
    i0 = int(round(start_s * SR))
    if i0 >= N:
        return
    if i0 < 0:
        sig_l = sig_l[-i0:]
        sig_r = sig_r[-i0:]
        i0 = 0
    ln = min(len(sig_l), N - i0)
    if ln <= 0:
        return
    mix_l[i0 : i0 + ln] += sig_l[:ln] * gain
    mix_r[i0 : i0 + ln] += sig_r[:ln] * gain


def synth_pad_chord(notes_midi, dur: float, brightness: float = 0.35):
    ln = int(SR * dur)
    t = np.arange(ln, dtype=np.float64) / SR
    sig_l = np.zeros(ln, dtype=np.float64)
    sig_r = np.zeros(ln, dtype=np.float64)
    env = env_adsr(ln, min(0.45, dur * 0.2), 0.4, 0.78, min(0.9, dur * 0.3))
    for k, m in enumerate(notes_midi):
        f = midi_to_hz(m)
        # Detuned warm analog-style unison + gentle FM glass harmonic
        det = 0.0022 * (k % 2 * 2 - 1)
        mod = np.sin(2 * np.pi * f * 2.0 * t) * brightness * np.exp(-t * 1.2)
        v1 = np.sin(2 * np.pi * f * (1.0 - det) * t + mod)
        v2 = np.sin(2 * np.pi * f * (1.0 + det) * t + mod * 0.8)
        sub = 0.35 * np.sin(2 * np.pi * f * 0.5 * t) if k == 0 else 0.0
        pan = 0.3 + 0.4 * (k / max(1, len(notes_midi) - 1))
        sig_l += (v1 * (1.0 - pan * 0.35) + sub) / len(notes_midi)
        sig_r += (v2 * (0.65 + pan * 0.35) + sub) / len(notes_midi)
    return sig_l * env, sig_r * env


def synth_pluck(midi_note: float, dur: float = 0.32, glass: float = 0.9, pan: float = 0.5):
    ln = int(SR * dur)
    t = np.arange(ln, dtype=np.float64) / SR
    f = midi_to_hz(midi_note)
    env = np.exp(-t * 11.0) * (1.0 - np.exp(-t * 450.0))
    mod = np.sin(2 * np.pi * (f * 3.0) * t) * glass * np.exp(-t * 26.0)
    tone = np.sin(2 * np.pi * f * t + mod) + 0.25 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 18.0)
    sig = tone * env
    return sig * np.sqrt(1.0 - pan), sig * np.sqrt(pan)


def synth_sub_hit(freq: float = 48.0, dur: float = 0.85):
    ln = int(SR * dur)
    t = np.arange(ln, dtype=np.float64) / SR
    # Pitch drop from 2.2x to 1.0x for clean cinema sub impact
    phase = 2 * np.pi * freq * (t + 0.045 * (1.0 - np.exp(-t * 32.0)))
    env = np.exp(-t * 4.2) * (1.0 - np.exp(-t * 500.0))
    click = np.sin(2 * np.pi * 190.0 * t) * np.exp(-t * 65.0) * 0.3
    sig = (np.sin(phase) + 0.22 * np.tanh(2.0 * np.sin(phase)) + click) * env
    return sig, sig


def synth_laser_beam(dur: float = 0.42, f_start: float = 280.0, f_end: float = 1680.0):
    ln = int(SR * dur)
    t = np.arange(ln, dtype=np.float64) / SR
    # Exponential frequency sweep + stereo pan left-to-center (matching Beamlet icon motif!)
    ratio = (f_end / f_start) ** (t / dur)
    inst_f = f_start * ratio
    phase = 2 * np.pi * np.cumsum(inst_f) / SR
    env = np.sin(np.pi * (t / dur)) ** 0.7 * np.exp(-t * 2.2)
    shimmer = np.sin(phase) * 0.65 + np.sin(phase * 1.5) * 0.35
    pan = np.clip(0.15 + 0.35 * (t / dur), 0.0, 1.0)
    return shimmer * env * (1.0 - pan * 0.4), shimmer * env * (0.5 + pan * 0.5)


def synth_ui_click(freq: float = 1480.0, dur: float = 0.055):
    ln = int(SR * dur)
    t = np.arange(ln, dtype=np.float64) / SR
    env = np.exp(-t * 95.0) * (1.0 - np.exp(-t * 1500.0))
    sig = (np.sin(2 * np.pi * freq * t) + 0.45 * np.sin(2 * np.pi * freq * 2.41 * t)) * env
    return sig, sig


def synth_data_shimmer(dur: float, rate_hz: float = 15.0):
    ln = int(SR * dur)
    t = np.arange(ln, dtype=np.float64) / SR
    rng = np.random.default_rng(667855)
    # Soft 15fps crystalline optical frame ticks
    sig_l = np.zeros(ln, dtype=np.float64)
    sig_r = np.zeros(ln, dtype=np.float64)
    step = 1.0 / rate_hz
    scale_notes = [72, 74, 75, 79, 82, 84, 86, 87]  # C minor9 pentatonic/hexatonic high glass
    k = 0
    while k * step < dur - 0.08:
        note = scale_notes[rng.integers(0, len(scale_notes))]
        pl, pr = synth_pluck(note, dur=0.11, glass=0.5, pan=0.25 + 0.5 * ((k % 5) / 4.0))
        i0 = int(k * step * SR)
        m = min(len(pl), ln - i0)
        sig_l[i0 : i0 + m] += pl[:m] * 0.22
        sig_r[i0 : i0 + m] += pr[:m] * 0.22
        k += 1
    fade = env_adsr(ln, 0.25, 0.1, 0.9, 0.35)
    return sig_l * fade, sig_r * fade


def simple_stereo_reverb(sig_l: np.ndarray, sig_r: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    # Multi-tap feedback-free velvet delay network for spacious Apple-keynote tail
    taps_ms = [37, 61, 89, 131, 197, 283, 389]
    gains = [0.18, 0.14, 0.11, 0.085, 0.06, 0.04, 0.025]
    wet_l = np.zeros_like(sig_l)
    wet_r = np.zeros_like(sig_r)
    for idx, (ms, g) in enumerate(zip(taps_ms, gains)):
        d = int(SR * ms / 1000.0)
        if d < len(sig_l):
            if idx % 2 == 0:
                wet_l[d:] += sig_r[:-d] * g
                wet_r[d + 113 :] += sig_l[: -(d + 113)] * (g * 0.92)
            else:
                wet_r[d:] += sig_l[:-d] * g
                wet_l[d + 89 :] += sig_r[: -(d + 89)] * (g * 0.92)
    # Gentle lowpass on reverb tail
    kernel = np.exp(-np.linspace(0, 3.5, 18))
    kernel /= kernel.sum()
    wet_l = np.convolve(wet_l, kernel, mode="same")
    wet_r = np.convolve(wet_r, kernel, mode="same")
    return sig_l + wet_l * 0.55, sig_r + wet_r * 0.55


def main():
    PUBLIC_ASSETS.mkdir(parents=True, exist_ok=True)
    PROMO_ASSETS.mkdir(parents=True, exist_ok=True)

    mix_l = np.zeros(N, dtype=np.float64)
    mix_r = np.zeros(N, dtype=np.float64)

    # ---- Harmonic Progression across the 7 Scenes (120 BPM = 0.5s/beat) ----
    chords = [
        # Scene 1: Hook (0.0 - 3.5s) — Deep C minor9 mystery & clarity
        (0.0, 3.6, [36, 48, 55, 62, 63, 67], 0.40, 0.24),
        # Scene 2: Problem (3.5 - 5.6s) — Abmaj7(#11) tension -> (5.6 - 8.0s) G7sus4 lift
        (3.5, 2.2, [32, 44, 51, 56, 60], 0.22, 0.22),
        (5.6, 2.5, [43, 50, 55, 60, 62, 67], 0.45, 0.26),
        # Scene 3: Key Handshake (8.0 - 14.0s) — Cm9 -> Fm9 warm verification
        (8.0, 3.0, [36, 48, 55, 58, 62, 67], 0.35, 0.23),
        (11.0, 3.1, [41, 53, 56, 60, 63, 67], 0.45, 0.26),
        # Scene 4: Optical Stream Climax (14.0 - 21.5s) — Propulsive Ebmaj9 -> Abmaj9 -> Fm9 -> Cmaj9/G!
        (14.0, 2.0, [39, 51, 55, 58, 62, 67], 0.48, 0.27),
        (16.0, 2.0, [44, 56, 60, 63, 67, 70], 0.50, 0.27),
        (18.0, 1.6, [41, 53, 60, 63, 67, 72], 0.52, 0.27),
        (19.6, 2.0, [39, 51, 58, 62, 67, 70, 74], 0.60, 0.30),
        # Scene 5: Architecture X-Ray (21.5 - 28.5s) — Clean analytical Cm11 -> Abmaj7 -> Bb6
        (21.5, 2.4, [36, 48, 55, 58, 62, 65], 0.35, 0.22),
        (23.9, 2.3, [32, 44, 51, 55, 60, 63], 0.38, 0.22),
        (26.2, 2.4, [34, 46, 53, 58, 62, 67], 0.42, 0.24),
        # Scene 6: Security & Offline PWA (28.5 - 33.5s) — Solid Fm9 -> G7sus4 build
        (28.5, 2.5, [41, 53, 56, 60, 63, 67], 0.36, 0.24),
        (31.0, 2.5, [43, 55, 60, 62, 65, 67], 0.48, 0.27),
        # Scene 7: Climax & CTA (33.5 - 37.8s) — Luminous Eb Major 9 resolution!
        (33.5, 4.3, [39, 51, 58, 62, 67, 70, 74], 0.55, 0.32),
    ]
    for start_t, dur_t, notes, br, gain in chords:
        pl, pr = synth_pad_chord(notes, dur_t, brightness=br)
        add_stereo(mix_l, mix_r, start_t, pl, pr, gain=gain)

    # ---- Rhythmic Pulse & Melodic Glass Arpeggio (8.0s - 33.5s, 120 BPM = 0.25s 8th / 0.125s 16th) ----
    arp_pattern = [60, 67, 74, 75, 79, 75, 74, 67]
    t_cursor = 8.0
    step_idx = 0
    while t_cursor < 33.25:
        # Pause briefly at major transition hits for dramatic breathing room
        if not (13.75 <= t_cursor < 14.0 or 21.25 <= t_cursor < 21.5 or 28.25 <= t_cursor < 28.5):
            note = arp_pattern[step_idx % len(arp_pattern)]
            if 14.0 <= t_cursor < 21.25:
                note += 12 if step_idx % 4 == 2 else 0
            vel = 0.17 if (14.0 <= t_cursor < 21.25) else 0.12
            pl, pr = synth_pluck(note, dur=0.24, glass=0.75, pan=0.3 + 0.4 * ((step_idx * 3) % 5) / 4.0)
            add_stereo(mix_l, mix_r, t_cursor, pl, pr, gain=vel)
            # Soft electronic kick/pulse every 0.5s during active sections
            if step_idx % 2 == 0 and (8.0 <= t_cursor < 28.25):
                kl, kr = synth_sub_hit(freq=55.0, dur=0.22)
                add_stereo(mix_l, mix_r, t_cursor, kl, kr, gain=0.20 if t_cursor >= 14.0 else 0.13)
        t_cursor += 0.25
        step_idx += 1

    # ---- Frame-Exact Foley & Cinematic Accents ----
    # 0.00s: Opening Hook Sub Impact + Laser Beam across Viewfinder!
    add_stereo(mix_l, mix_r, 0.00, *synth_sub_hit(49.0, 0.95), gain=0.45)
    add_stereo(mix_l, mix_r, 0.02, *synth_laser_beam(0.45, 240, 1560), gain=0.26)
    # 0.00 - 3.3s: Subtle 15Hz BOS1 optical shimmer
    add_stereo(mix_l, mix_r, 0.15, *synth_data_shimmer(3.1, 15.0), gain=0.55)
    # 0.35s & 1.60s: Hero Typography lock clicks
    add_stereo(mix_l, mix_r, 0.35, *synth_ui_click(1620, 0.06), gain=0.22)
    add_stereo(mix_l, mix_r, 1.60, *synth_pluck(79, 0.45, 1.1, 0.5), gain=0.24)

    # Scene 2: 3.50s Transition + 4 Red Barrier Ticks + 5.60s Optical Breakthrough!
    add_stereo(mix_l, mix_r, 3.50, *synth_sub_hit(43.65, 0.7), gain=0.32)
    for bt in [3.75, 4.05, 4.35, 4.65]:
        add_stereo(mix_l, mix_r, bt, *synth_ui_click(620, 0.05), gain=0.20)
    add_stereo(mix_l, mix_r, 5.60, *synth_laser_beam(0.38, 360, 1920), gain=0.25)
    add_stereo(mix_l, mix_r, 5.65, *synth_pluck(79, 0.55, 1.0, 0.5), gain=0.26)

    # Scene 3: 8.00s Dual Device Stage + 9.50s QR Scan + 11.00s 6-Digit Fingerprint Sync!
    add_stereo(mix_l, mix_r, 8.00, *synth_sub_hit(49.0, 0.65), gain=0.28)
    add_stereo(mix_l, mix_r, 9.50, *synth_pluck(72, 0.18, 0.9, 0.35), gain=0.25)
    add_stereo(mix_l, mix_r, 9.61, *synth_pluck(79, 0.32, 1.1, 0.65), gain=0.28)
    # 11.00s: Dual-screen 667855 verification chime
    add_stereo(mix_l, mix_r, 11.00, *synth_pluck(77, 0.45, 1.2, 0.4), gain=0.26)
    add_stereo(mix_l, mix_r, 11.08, *synth_pluck(84, 0.60, 1.2, 0.6), gain=0.28)

    # Scene 4: 14.00s Optical Stream Ignition + 16.00s Instant Preview + 19.60s 100% Complete Chime!
    add_stereo(mix_l, mix_r, 14.00, *synth_sub_hit(51.9, 0.85), gain=0.38)
    add_stereo(mix_l, mix_r, 14.05, *synth_data_shimmer(5.4, 15.0), gain=0.80)
    # 16.00s: OID 0 Instant Thumbnail pop
    add_stereo(mix_l, mix_r, 16.00, *synth_pluck(80, 0.35, 1.0, 0.55), gain=0.25)
    # 19.60s: 100% Verified Complete Sparkle (Eb - G - Bb - D - F)!
    for idx, m_note in enumerate([75, 79, 82, 86, 89]):
        add_stereo(mix_l, mix_r, 19.60 + idx * 0.065, *synth_pluck(m_note, 0.65, 1.15, 0.3 + idx * 0.1), gain=0.24)

    # Scene 5: 21.50s Architecture X-Ray + 3 Callout Precision Locks
    add_stereo(mix_l, mix_r, 21.50, *synth_sub_hit(49.0, 0.65), gain=0.30)
    for ct, freq in [(22.20, 1320), (24.30, 1480), (26.40, 1660)]:
        add_stereo(mix_l, mix_r, ct, *synth_ui_click(freq, 0.06), gain=0.22)
        add_stereo(mix_l, mix_r, ct + 0.03, *synth_pluck(74 if ct < 25 else 79, 0.3, 0.8, 0.5), gain=0.18)

    # Scene 6: 28.50s Security Pillars — 3 Cryptographic Vault Locks
    add_stereo(mix_l, mix_r, 28.50, *synth_sub_hit(43.65, 0.7), gain=0.30)
    for pt, m_note in [(29.10, 72), (30.30, 75), (31.50, 79)]:
        add_stereo(mix_l, mix_r, pt, *synth_ui_click(1520, 0.055), gain=0.22)
        add_stereo(mix_l, mix_r, pt + 0.02, *synth_pluck(m_note, 0.4, 0.9, 0.5), gain=0.22)

    # Scene 7: 33.50s Beamlet Logo Laser Convergence + Final Resolution Chime + Clean Fadeout
    add_stereo(mix_l, mix_r, 33.50, *synth_laser_beam(0.42, 300, 1760), gain=0.28)
    add_stereo(mix_l, mix_r, 33.88, *synth_sub_hit(38.89, 1.4), gain=0.42)
    for idx, m_note in enumerate([75, 82, 86, 87]):
        add_stereo(mix_l, mix_r, 33.90 + idx * 0.08, *synth_pluck(m_note, 1.3, 1.0, 0.35 + idx * 0.1), gain=0.22)

    # Spacious stereo reverb + master envelope + soft limiter (zero clipping!)
    mix_l, mix_r = simple_stereo_reverb(mix_l, mix_r)

    # Master fade-in (first 12ms anti-click) and smooth cosine fade-out (36.4s -> 38.0s)
    fade_in_n = int(0.012 * SR)
    mix_l[:fade_in_n] *= np.linspace(0.0, 1.0, fade_in_n)
    mix_r[:fade_in_n] *= np.linspace(0.0, 1.0, fade_in_n)

    fade_out_start = int(36.3 * SR)
    fade_out_len = N - fade_out_start
    fade_curve = 0.5 * (1.0 + np.cos(np.linspace(0.0, np.pi, fade_out_len)))
    mix_l[fade_out_start:] *= fade_curve
    mix_r[fade_out_start:] *= fade_curve

    # Normalize & transparent tanh ceiling at -1.8 dBFS (0.8128 peak max -> zero clipping guaranteed!)
    peak = max(np.max(np.abs(mix_l)), np.max(np.abs(mix_r)), 1e-6)
    mix_l = np.tanh((mix_l / peak) * 1.18) / np.tanh(1.18) * 0.78
    mix_r = np.tanh((mix_r / peak) * 1.18) / np.tanh(1.18) * 0.78

    stereo = np.empty((N, 2), dtype=np.int16)
    stereo[:, 0] = np.clip(np.round(mix_l * 32767.0), -32767, 32767).astype(np.int16)
    stereo[:, 1] = np.clip(np.round(mix_r * 32767.0), -32767, 32767).astype(np.int16)

    wav_pub = PUBLIC_ASSETS / "soundtrack.wav"
    wav_ast = PROMO_ASSETS / "soundtrack.wav"
    for p in [wav_pub, wav_ast]:
        with wave.open(str(p), "wb") as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(SR)
            wf.writeframes(stereo.tobytes())

    print(f"Synthesized stereo 48kHz soundtrack: {wav_pub} (peak={max(np.max(np.abs(mix_l)), np.max(np.abs(mix_r))):.3f})")


if __name__ == "__main__":
    main()
