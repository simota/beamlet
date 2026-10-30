# BOS1 (Beamlet Optical Stream) — An optical stream format for sending data with a screen and a camera

- Names: the app is **Beamlet**; the optical stream format is **BOS1** (Beamlet Optical Stream v1). The identifier is `BOS1`, the frame magic is `"BL"`, and the Rust crate is `beamlet-stream`
- Target: the Web / PWA (`web/`), which both sends and receives. The browser receiver advertises up to Standard mode (§5, §6.6)

## 1. Overview

The sender's screen continuously displays **custom color 2D frames**, and the receiver's camera reads them. No network or Bluetooth is used.

| Layer | Method |
|---|---|
| Key exchange | The receiver shows its public key once as an **ordinary QR code**, and the sender reads it with its camera (§5) |
| Encryption | X25519 + HKDF-SHA256 + ChaCha20-Poly1305 (§8) |
| Inter-frame error correction | **RaptorQ** (RFC 6330). Missed frames are compensated for |
| Intra-frame error correction | Per-tile Reed-Solomon (GF(256)) and CRC32 |
| Modulation | 1–3 bits of color per cell. Symbol codes are assigned so that easily confused colors differ in one bit, and every frame carries palette strips for color calibration |
| What is sent | Multiple files in one session. Images can be converted before sending, and thumbnails are delivered first (§4) |
| Implementation | The Rust crate `beamlet-stream`, compiled to wasm (`beamlet-stream/wasm`) and used by the web pages (§9) |

## 2. Communication model — UDP + FEC style

The sender **keeps streaming**, and the transfer completes when the receiver has everything. The receiver sends nothing back to the sender. This is the same idea as FLUTE / ALC, which distribute files over a one-way channel.

| UDP term | BOS1 counterpart |
|---|---|
| Datagram | **Tile**. On its own, it identifies which symbol of which object it carries (§6.3) |
| Discard anything whose checksum does not match | Discard tiles that CRC / RS cannot correct |
| No retransmission, no ACKs | The sender keeps generating and streaming repair symbols. Anything missed is compensated for by symbols that arrive later |
| The sender decides the send rate | The sender decides the fps and the mode. The receiver's capabilities are communicated only once, at key exchange (`caps` in §5) |
| Reliable delivery is the upper layer's job | RaptorQ. Recovery is probabilistic and succeeds with high probability once slightly more symbols than the number of source symbols have been collected. If it fails, the receiver keeps receiving and retries with the additional symbols |

Consequences of this approach:
- **Reception may start midway**. Every symbol that arrives is usable for recovery, so the receiver may point its camera at the sender partway through the transmission
- **The sender cannot stop on its own**. It has no way to learn that the receiver has finished (when a phone's rear camera is pointed at the sender, the receiver's screen is not visible from the sender). The sender stops when a person taps the sending screen. It then shows how many frames it displayed and that sending can be started again if the receiver has not completed
- **Only the one device that exchanged keys can receive**. The encryption is bound to the receiver's public key, and frames of another session are ignored (§5)
- **No congestion control is needed**. We are the only users of the channel. The speed limit is determined by the combination of the receiver's analysis speed, the camera's resolution and fps, color classification errors, and the sender's display fps (§11)

## 3. Scope

**In scope**
- One-to-one, one-way transfer. Multiple files can be sent in one session (total limit 100 MB; 20 MB or less recommended)
- Image conversion and delivering thumbnails ahead of the files (§4)
- Automatic mode selection according to the receiver's capabilities, and manual switching (§6.6)
- Offering each received file for saving as soon as it is complete and verified

**Out of scope**
- Feedback from the receiver to the sender during transfer (retransmission requests, automatic rate adjustment, completion notification)
- Secure transfer when the sender has no camera. Key exchange is impossible (§5). Browsers on Macs or PCs without a camera cannot send
- Simultaneous sending to multiple receivers (broadcast). It would mean sharing the key, and anyone who recorded the screen could read the contents
- Resuming a transfer after the sender has stopped streaming. While the sender is streaming, the receiver can pause and resume, keeping what it has received
- Video conversion (video is always sent as is)

## 4. What is sent — objects and image conversion

### 4.1 Objects

| OID | Contents |
|---|---|
| 0 | **Manifest**. Per file, `{oid, size, sha256, name, mime, thumbnail}`. The thumbnail is a JPEG with a 160px long edge (quality 0.6), present only for images the browser can decode. The format is a custom length-prefixed binary (`beamlet-stream/src/manifest.rs`) |
| 1–255 | File bodies |

- The receiver shows the file list and thumbnails once OID 0 is complete. Each file body replaces its thumbnail as it arrives
- Each object is RaptorQ-encoded separately. They are distinguished by the `OID` in the tile header (§6.3)

### 4.2 Send order (sender schedule)

```
Tiles in each frame:  allocate 1/10 to OID 0 (streamed continuously)
                      the remaining ~90% send the body objects in OID order:
                        once oid i's source symbols + repair symbols (K_i × 1.1, at least 2 frames' worth of tiles) are sent, move to i+1
                      after the last object, return to the first and keep cycling with repair symbols
```

- Because OID 0 is constantly mixed in, the list and thumbnails appear first even when reception starts midway
- The tiles allocated to OID 0 are those whose tile number t satisfies `t mod 10 = frame_no mod 10`. Since the position shifts by one each frame, OID 0's share is 1/10 even in frames with fewer than 10 tiles (3 in Stable mode, 9 in Compact mode)
- Each pass is made to span at least 2 frames because, if one pass of a small file (such as text that fits in a few symbols) fit in a single frame, missing just that frame would mean waiting a full cycle of the large files (about 50 seconds for a 300 KB image)
- Because bodies are sent in order, small files and earlier files complete first
- Anything missed in the first cycle is compensated for by repair symbols in the second and later cycles
- The ESI (symbol number) is 24 bits. Even when streaming 3000 tiles per second, it takes about 90 minutes to exhaust

### 4.3 Image conversion (chosen on the sender)

| Mode | Processing | Use |
|---|---|---|
| High (default) / Standard / Light | Downscale to at most a 2048 / 1280 / 800px long edge and re-encode as WebP (JPEG where the browser cannot encode WebP) at quality 0.8 / 0.7 / 0.6. **Re-encoding drops EXIF and all other metadata, location included**. Images the browser cannot decode (such as HEIC outside Safari) are sent as is | Everyday sharing; the lighter levels shorten the transfer |
| Original | Send the original byte sequence as is. Metadata is kept, and the sender notes that location and other metadata will be sent | When the original data is needed |

- Files whose MIME type is already compressed are not deflated: `image/*`, `video/*`, `audio/*`, and types matching zip, gzip, compressed, x-7z, x-rar, or pdf. Everything else is deflated. The choice is recorded per object in the container's flag byte (§8). The manifest is always deflated

## 5. Key exchange

```
Receiver R                                       Sender S
generate (skR, pkR)
show QR: "BOS1:" + Base45(ver | pkR | caps)  ───▶  read with camera (ordinary QR)
show fingerprint FP as 6 digits                    generate (skE, pkE) and show FP → a person compares them, OK
                                                  choose mode from caps (§6.6)
                  ◀──────────────  keep streaming BOS1 frames (pkE goes in the header band)
```

- `ver` is `0x01`; the QR payload is 37 bytes before Base45 (RFC 9285)
- `shared = X25519(skE, pkR)` (abort if the result is non-contributory, i.e. all zeros), `key = HKDF-SHA256(ikm=shared, salt="", info="BOS1" || pkE || pkR, len=32)`
- `session_id = SHA-256(pkR)[0..8]`; `FP` = the first 4 bytes of `SHA-256("BOS1-fp" || pkR)` as a big-endian integer, `mod 10^6`, shown as 6 digits
- `caps` (4B) describes the receiver's capabilities
  - `fps`: the camera's effective fps (1B)
  - `bpc_mask`: the numbers of bits per cell the receiver can handle (1B; bit0 = 1bit, bit1 = 2bit, bit2 = 3bit)
  - `max_cells`: the maximum number of cells along the long edge the receiver can handle (2B, big-endian)
  - The browser receiver sends `fps = 30`, `bpc_mask = 0b011`, `max_cells = 192`
- Secrets are generated from 32 random bytes supplied by the page (`crypto.getRandomValues`)
- The receiver does not know the grid size until it reads the header. It locates markers once per capture, fits each distinct grid of the §6.6 modes (trying the most recently successful mode first), and uses whichever yields a header of its own session. For modes that share a grid, such as Stable and Compact, the markers and header band are in the same positions, so a single sampling pass is calibrated with each mode's palette strips, and the mode is decided by the bpc and `rs_level` of the header that was read (§6.6)
- A header is accepted only if its `session_id` is this receiver's, its grid, bpc, and `rs_level` match the layout it was read with, its `symbol_size` is a nonzero multiple of 8 that fits the tile, and, once a key has been derived, its `pkE` matches
- QR is used for handing over the key because the data is small and an existing detector can read it as is: the receiver renders the QR with the `qrcode` crate and the sender reads it with `rqrr`, both in wasm
- **Key exchange cannot be done in one direction only**. The sender must read the receiver's public key, so a camera is required

## 6. Frame (physical layer)

### 6.1 Layout

A frame is a rectangle of W × H cells surrounded by a white quiet zone 4 cells wide. W × H is fixed per mode (§6.6); on a portrait screen the frame is drawn rotated 90° (§6.5).

```
┌───────────────────────────────────────────────────┐
│ F1 ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ F2 │   F1–F3: 7×7 finders (identical shape)
│    [header band (top copy)]   A          A        │   F4    : 7×7 orientation marker (shape differs from F1–F3)
│ A  [tile 0 ─────────────────────────────────]  A  │   ▒     : palette strip (first and last rows)
│    [tile 1 ─────────────────────────────────]     │   A     : 5×5 alignment marker (lattice, at most 32 cells apart)
│ A  [ ... tiles in horizontal bands ...      ]  A  │
│    [padding]                                      │
│    [header band (bottom copy)]  A          A      │
│ F3 ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ F4 │
└───────────────────────────────────────────────────┘
```

- **Corner markers**: F1 (top left), F2 (top right), and F3 (bottom left) are 7×7 finders with ring ratio 1:1:3:1:1; F4 (bottom right) is a 7×7 marker of alternating rings, 1:1:1:1:1:1:1. Each is centered 3 cells from the grid edges and surrounded by a 1-cell light separator. A projective transform is computed from the 4 corner markers, correcting for oblique capture. Because F4 differs from the finders, the orientation is determined at any rotation
- **Alignment markers** (5×5: dark ring, light ring, dark center) sit on a lattice of columns and rows running from 3 cells inside one edge to 3 cells inside the other, evenly spaced and no more than 32 cells apart; the corner points of the lattice are the corner markers. A bilinear field of local offsets measured at them corrects lens distortion and local misalignment
- **Palette strips** occupy the first and last rows of the grid (the cells not taken by markers) and list every color of the palette in turn, 4 cells per color. The receiver interpolates between the top and bottom strips per row to obtain reference colors. This follows color changes between top and bottom caused by rolling shutter or uneven screen brightness
- The **header band** is written in 1-bit black and white (black = 1) with stronger RS (§6.2). There are 2 copies of 1024 cells each: the top copy fills free cells in serpentine order from the first row down, the bottom copy from the last row up
- The remaining free cells, in serpentine order, are divided into tiles (§6.3). Cells left over after the last whole tile are padding, filled with pseudo-random palette colors so that the frame has no flat areas that could resemble markers
- From the second capture on, the receiver **tracks** the frame by re-fitting the corner and alignment markers near their previous positions. It falls back to a full search only when tracking or reading fails

### 6.2 Header band (64B, RS(128, 64))

| Field | Size | Contents |
|---|---|---|
| magic | 2B | `"BL"` |
| ver | 1B | `0x01` |
| session_id | 8B | §5 |
| pkE | 32B | The sender's public key. It is in every frame, so the receiver can derive the key from the first frame it reads |
| grid_w / grid_h | 2B + 2B | W, H (in cells) |
| bpc | 1B | Bits per cell (1 / 2 / 3) |
| rs_level | 1B | Tile RS parity rate (0 = 12.5%, 1 = 25%, 2 = 50%) |
| symbol_size | 2B | RaptorQ symbol size T (bytes). Common to all objects |
| object_count | 1B | Number of body objects (excluding OID 0) |
| frame_no | 4B | Display-side frame number (selects the OID 0 tiles and the mixed-in Stable frames, §4.2, §6.6) |
| reserved | 4B | Filled with 0 |
| crc32 | 4B | CRC of everything up to here |

- Multi-byte fields are big-endian. The receiver uses the first copy whose RS decoding, CRC, magic, and `ver` all check out
- The total byte count of each object (RaptorQ's F) is carried in every tile (§6.3)
- `ver` is `0x01`. The send page and the receive page are served from the same site at the same version, so the two sides can differ only when an old version is cached; in that case, reload the page

### 6.3 Tile (datagram)

The data area is divided into **tiles arranged in horizontal bands**. Each tile carries one RaptorQ packet.

```
tile = RS_encode( OID (1B) | SBN (1B) | ESI (3B) | F (5B) | symbol (k − 14 B) | crc32 (4B) )
```

- F is the object's transfer length (40 bits). The receiver sizes the object's RaptorQ decoder from the first tile it accepts for that object, and drops tiles whose F disagrees or exceeds the object size limit
- The RaptorQ symbol size T is the symbol field (k − 14 bytes) rounded down to a multiple of 8; shorter symbols are zero-padded to fill the field
- All the information needed for recovery (which symbol of which object) is inside the tile. Even if, within one captured image, the top half is frame n and the bottom half is frame n+1, **the tiles from both can be used as is**. Display and capture timing do not need to be synchronized
- Tiles that RS or CRC cannot correct are discarded. RaptorQ compensates for what is discarded
- Horizontal bands are a countermeasure against rolling shutter. The image sensor exposes row by row in sequence, so damage at a frame transition takes the form of a horizontal band. Aligning tiles to horizontal bands minimizes the number of damaged tiles
- Data cells are taken in serpentine order (direction reversed on each row), and each tile is a consecutive run of them, so a tile occupies whole rows. Within a tile, the codeword's bits are packed `bpc` bits per cell
- Tile length: the RS message length k, `round(255 × (1 − parity rate))`, is set to the shortest among the §6.6 modes that share the same grid (W × H). The codeword length n is `min(255, round(k / (1 − parity rate)))`
  - Stable (1 bit, 50% parity): RS(255, 128), 16 rows, 3 tiles per frame
  - Compact (2 bit, 25% parity): RS(171, 128), matching Stable's k; about 5.3 rows, 9 tiles per frame
  - Standard, Fast, and Fastest have no other mode on the same grid, so they use RS(255, 191)
  - Because k is the same, modes on the same grid have the same RaptorQ symbol size T (112 bytes) even if their bpc or parity rate differ. This is why Stable frames can be mixed into a Compact stream (§6.6)
  - A shortened code is the same code as RS(255, ·) with leading zero padding, so it corrects (n − k) / 2 bytes, and the fraction of the tile that is correctable differs from RS(255, k) only by 1 byte of rounding. A decode whose error locations fall outside the tile (in the zero-padded part) is discarded as a failure. When RS miscorrects to a different codeword, CRC-32 discards it. All of this is verified per mode by the tests in `tile.rs`
  - Compact tiles are short, so a tear (frame transition) cutting across a frame loses only about 1 of the 9 (89% in the `bos-lab sim` tear scenario; still 89% with `--fill` 0.15, about 2 pixels per cell. Stable loses 1 of 3, at 67%). In exchange, the 14-byte tile header takes a slightly larger share than in a 255-byte tile

### 6.4 Color (modulation)

| bpc | Palette (symbol 0, 1, 2, …) |
|---|---|
| 1 | Black, white |
| 2 | Black, red, white, cyan |
| 3 | The 8 vertices of the RGB cube, one bit per channel (bit 2 = R, bit 1 = G, bit 0 = B) |

- Symbol codes are assigned so that the color pairs a camera confuses most differ in one bit: for bpc 2, black/red (dark) and white/cyan (bright); for bpc 3, a misread in a single channel is a single-bit error
- Classification uses the squared RGB distance to the per-row reference colors, interpolated between the top and bottom palette strips
- After reading the header and before reading tiles, the reference colors are re-measured (`Classifier::refine`). The data cells classified with the palette strips are grouped by color, and the top and bottom reference colors are refitted by least squares against row position. In blurred footage, the palette strips' cells are pulled toward the quiet zone (white) and the neighboring header band, and come out a different color from the data cells; because the header band's content differs per session, so does this shift. Colors with fewer than 64 data cells keep the palette strip's reference color

### 6.5 Display and capture

- Each cell is drawn with nearest-neighbor scaling, at an **integer multiple of physical pixels** when a cell gets fewer than 8 physical pixels. The Canvas's actual size is matched using `devicePixelRatio`. This prevents blur from interpolation and moiré
  - From 8 physical pixels per cell up, the frame is not rounded down to an integer multiple but drawn to fill the screen's height or width (whichever runs out first) (`fitFrame` in `web/beamlet.js`). Since it remains nearest-neighbor, cells are n or n + 1 pixels wide, and cell boundary misalignment stays within 0.5 pixels (1/16 cell). Rounding down would turn a screen with room for 13.5 pixels per cell (Compact / Stable frames on a phone with a 1080-pixel short edge) into 13 pixels, reducing the pixels the receiver's camera gets per cell by about 4%
  - On a portrait screen the frame is drawn rotated 90° so that it runs along the long side; what then limits the cell size is the short edge (frame height H + 8 cells)
- Frames are displayed at the mode's display fps (§6.6). The mode is chosen so that the receiver captures at least 2 frames per displayed frame. Images captured mid-transition are discarded per tile, but the higher the discard rate, the lower the efficiency
- While sending, the page goes full screen and holds a screen Wake Lock
- Color temperature adjustments such as True Tone and Night Shift cannot be disabled by the page. They are absorbed by the palette strip calibration

### 6.6 Modes

The fastest mode whose requirements are met is chosen automatically from the receiver's `caps` (`session::choose_mode`): its bpc is in `bpc_mask`, W ≤ `max_cells`, and display fps × 2 ≤ `caps.fps`. If no mode qualifies, Stable is used. Users can also switch manually (Advanced settings on the send page). W × H is 16:9 in every mode.

| Mode | W × H | bpc | rs_level | Display fps | Requirements | Tiles / frame | Payload / frame |
|---|---|---|---|---|---|---|---|
| Stable | 128 × 72 | 1 | 2 (50%) | 10 | Receiver at 20 fps (otherwise used as the fallback) | 3 | 342 B |
| Compact | 128 × 72 | 2 | 1 (25%) | 15 | Receiver at 30 fps with 2 bit, `max_cells` 128–191 or a small-screen sender. Stable frames are mixed in | 9 | 1026 B |
| Standard | 192 × 108 | 2 | 1 (25%) | 15 | Receiver at 30 fps with 2 bit, `max_cells` ≥ 192 | 16 | 2832 B |
| Fast | 256 × 144 | 3 | 1 (25%) | 30 | Receiver at 60 fps with 3 bit, `max_cells` ≥ 256 | 48 | 8496 B |
| Fastest (experimental) | 320 × 180 | 2 | 1 (25%) | 60 | Receiver at 120 fps with 2 bit, `max_cells` ≥ 320 | 51 | 9027 B |

Payload per frame is tiles × T from the actual layout (`bos-lab layout`). With the browser receiver's `caps` (§5), the fastest mode is Standard.

- Fastest mode uses bpc 2 rather than 3 because 120 fps capture has short exposure times, which is expected to increase noise

**Compact mode** (when sending from a phone to a PC)
- When a PC's built-in camera (30 fps) captures a phone screen, even a 128-cell-wide grid gives only about 2.5 pixels per cell. Finer cells become unreadable, so Compact keeps Stable's grid while using 4 colors (2 bit, §6.4), a display of 15 fps, and 25% parity. Tiles are shortened to Stable's k (§6.3)
- If the screen's short edge is under 600 CSS px, the sender chooses only among modes with a grid width of 128 cells or less (`small_screen` in `session::choose_mode`). If the receiver's `caps` is 30 fps or more and supports 2 bit, the result is Compact; otherwise Stable. There is no setting for this. Right after the QR is read, the send screen shows the chosen mode, e.g. "Automatically chose the mode that fits this screen (Compact, 15 fps). You can send as is." The reasons and mechanism are not shown on screen; they are documented in this section and in web/README.md
- In `bos-lab sim` at about 2.5 pixels per cell, all tiles were read in every scenario except tear, and tear was 89% (Stable 67%). With more blurred footage (`--fill 0.15`, about 2 pixels per cell), Compact read 99% of tiles in blur and 100% in combined. Even so, because it adds colors and lowers parity, its limit is reached sooner than Stable's. That is the reason for mixing in Stable frames below
- **Mixing in Stable frames**: frames drawn in Stable (1 bit) are mixed into the Compact stream (`session.rs`). In general, the sender mixes in a built-in mode on the same grid with fewer bits per cell and the same symbol size; Compact → Stable is the only such pair
  - Ratio: 1 in 4 frames from the first frame, and 1 in 2 once every object has been sent through one cycle (`FALLBACK_FIRST`, `FALLBACK_LATER`)
  - They are drawn 3 in a row (200 ms at 15 fps) (`FALLBACK_RUN`). If a tear (§6.3) falls on a boundary between Stable frames, only the 1 tile below the tear is lost. A tear on a boundary between Stable and Compact loses all tiles on the side whose mode differs from the header. If they were mixed in one at a time, almost every boundary before and after a Stable frame would be a boundary with Compact
  - Which groups become Stable: frame_no divided by 3 identifies a group, and the choice is made by a hash (SplitMix64) of that value rather than by alternation. With alternation, a camera that drops every 2nd or 4th frame would be biased toward dropping either all Stable frames or none
  - The header of a Stable frame records bpc = 1 and rs_level = 2. Both modes have the same symbol size T (§6.3), so they carry the same RaptorQ symbols, and the receiver combines symbols from both for recovery
  - The receiver reads the modes of the same grid with a single sampling pass. The markers and header band are in the same positions and only the color order of the palette strips differs by bpc, so it calibrates with each mode's palette strips, reads the header, and reads the tiles of whichever mode the header's bpc and rs_level match
  - A camera that can read Compact normally completes within the first cycle, where Stable is 1 in 4 frames, so the average per frame drops from 9 tiles to 7.5 tiles (38 seconds instead of 33 for a 300 KB image; §11)
  - A camera that cannot distinguish colors (dark, blurred, color bleeding, etc.) starts collecting Stable frames from the first frame and can complete with those alone. In the first cycle Stable frames average 3.75 per second, and from the second cycle 7.5 per second, with 1/10 going to the manifest. For a 300 KB image this takes 198–199 seconds (§11). The user does not need to reconfigure anything
  - The ratio balances the two cases (simulation in §11): mixing in Stable 1 in 3 throughout gives 40 seconds for a camera that can read Compact and 277 seconds for one that cannot; 1 in 2 throughout gives 46 and 183 seconds; starting the mix only after the first cycle makes the camera that cannot read Compact wait out that cycle (210 seconds). Fewer in the first cycle and more afterward lets cameras that can read Compact finish almost entirely within the first cycle, while cameras that cannot catch up after it

## 7. Upper layers

1. **Container**: built per object (§8)
2. **RaptorQ**: each container is encoded per RFC 6330. The symbol size T is determined to fit the tile capacity (§6.3). The send order is in §4.2
3. **Completion**: an object is complete when RaptorQ recovery and AEAD verification succeed and its size and SHA-256 match its manifest entry (a body that arrives before the manifest is held and checked once the manifest arrives). An object that fails these checks is marked as failed. The session completes when every object in the manifest is complete. The sender is not notified (§2)

## 8. Encrypted container

```
plaintext_o = flag (1: deflated, 0: as is) || (flag ? deflate : id)(data_o)   # OID 0 is the manifest
chunk_{o,i} = ChaCha20-Poly1305(key, nonce_{o,i}, plaintext_o[i*64KiB .. (i+1)*64KiB], aad_o)
nonce_{o,i} = o (1B) || i (10B big-endian) || last (1B: 0x01 only for the last chunk)
aad_o       = "BOS1" || session_id || pkE || o
container_o = chunk_{o,0} || chunk_{o,1} || ... || chunk_{o,n}
```

- pkE is carried in the header band (§6.2), not in the container
- The object number `o` is in the nonce and the AAD. Swapping objects or mixing one into another causes verification to fail
- The key is used only once per session. Each `(o, i)` pair is unique within a session, so nonces never repeat
- Because of the `last` flag, truncating the end causes verification to fail
- File names, MIME types, and the manifest's contents are all inside the encryption
- Decryption and inflation stop at a size limit (100 MiB + 1 MiB for a file, 4 MiB for the manifest); exceeding it fails the object

## 9. Implementation structure

```
beamlet-stream/             # Rust crate: the format, pure computation with no I/O
  src/
    params.rs               # mode table (§6.6), tile k / n, palettes
    layout.rs               # grid: markers, palette strips, header band, tile placement (shared by sender and receiver)
    header.rs               # header band (§6.2)
    tile.rs                 # tile packet, RS + CRC (§6.3)
    rs.rs                   # Reed-Solomon over GF(256)
    crc.rs                  # CRC-32
    frame.rs                # whole frame: header + tiles <-> cell colors
    render.rs               # cell colors -> RGB image; bit packing per cell
    detect.rs               # marker search, projective transform + alignment offsets, tracking
    geom.rs                 # homography
    sample.rs               # cell sampling and color classification (§6.4)
    handshake.rs            # key QR, caps, X25519 / HKDF, fingerprint (§5)
    container.rs            # encrypted container (§8)
    manifest.rs             # manifest (§4.1)
    session.rs              # Sender / Receiver: schedule, RaptorQ, mode choice, Stable mixing
    prng.rs                 # SplitMix64
    lab.rs                  # measurement helpers shared by bos-lab and lab.html
  wasm/                     # C ABI exports for the web pages (no wasm-bindgen, no imports); QR via qrcode / rqrr
tools/bos-lab/              # CLI: layout / render / analyze / sim (synthetic camera)
web/                        # static PWA: send.html, receive.html, lab.html, Workers, Service Worker
```

- Image conversion and thumbnail generation run in the page (`web/images.js`, `OffscreenCanvas.convertToBlob`), and the resulting bytes are passed to wasm
- Receiver: `receive.js` captures camera frames (scaled to at most 1920 px on the long edge) and passes RGBA pixels to `receive-worker.js`, which calls `rx_push` in wasm
- Sender: `send-worker.js` reads the key QR (`tx_scan`), prepares the session (`tx_start`), and renders each frame (`tx_frame`, one pixel per cell); `send.js` draws it into a 2D Canvas, scaled per §6.5
- `web/build.sh` builds the wasm to `web/pkg/beamlet.wasm`. The Service Worker (`sw.js`) caches the pages and the wasm for offline use
- Web security
  - Served as static pages with a CSP of `default-src 'self'`; `connect-src` is limited to `'self'`, and the Service Worker only handles same-origin GET requests. File contents never leave the device over the network
  - Files are selected with `<input type=file>` and processed in the page and in wasm
  - Served over HTTPS because `getUserMedia` requires a secure context

## 10. Security

- Headers and tiles are plaintext. All that is revealed is the session ID, pkE, the number of objects, the approximate size of each object, and parameters. File names, types, and contents are inside the AEAD
- CRC and RS are strictly for error correction; tamper detection is left to the AEAD tag. Even if tiles are tampered with to corrupt RaptorQ recovery, the final verification yields `AuthFailed`
- Even if the screen is recorded, the contents cannot be read because of the key exchange in §5. Both screens show the 6-digit fingerprint so a person can detect a substituted key QR
- Share mode drops EXIF location by re-encoding. Original mode keeps the metadata, and the sender notes this before sending

## 11. Performance

| Mode | Payload / frame | Display fps | Ideal (no tile loss) | At 20% tile loss |
|---|---|---|---|---|
| Stable | 342 B | 10 | 3.3 KB/s | 2.7 KB/s |
| Compact | 1026 B | 15 | 15.0 KB/s | 12.0 KB/s |
| Standard | 2832 B | 15 | 41.5 KB/s | 33.2 KB/s |
| Fast | 8496 B | 30 | 248.9 KB/s | 199.1 KB/s |
| Fastest | 9027 B | 60 | 528.9 KB/s | 423.1 KB/s |

- Ideal rates are from `bos-lab layout` (1 KB = 1024 B). They exclude the RaptorQ overhead, the 1/10 of tiles spent on the manifest, and the wait for cycling through the objects and back
- The actual limit is set by the receiver's analysis speed (whether one frame can be processed within the capture period), the camera's resolution and fps, the color classification error rate, and the sender's display fps
- Analysis time in wasm on V8 (Node 22, Mac): 27 ms in Standard, 40 ms in Fast, and 50 ms in Fastest for a 1920×1080 capture, including ground-truth comparison (`lab.html`); a receive session (`rx_push`) takes 10.8–10.9 ms per capture when run alone (around 18 ms when run alongside other measurements), including the reference color re-measurement

End-to-end simulation (wasm sender connected directly to the wasm receiver; 1/4 of displayed frames dropped, 1/3 captured rotated 90°; sending a 300 KB Share image and 16 KB of text), time from the start of display to completion:

| Capture | Compact | Stable |
|---|---|---|
| 5 pixels per cell | 38 s (33 s without Stable mixed in) | 137 s |
| PC camera filming a phone (2.45 pixels per cell, blur and noise), 3 sessions | 38 s each | 137 s |
| Same at 2.565 pixels per cell | 38 s | 137 s |
| Same footage in black and white (channels averaged), 3 sessions | 198.4, 198.8, 198.8 s | 137 s |

- In black and white, Compact's 4 colors become grays only 85 apart and no Compact frame is readable; the Compact stream completes from the mixed-in Stable frames alone. The test `a_camera_that_cannot_read_compact_completes_from_the_stable_frames` in `session.rs` verifies that, with such a camera, nothing arrives without the Stable frames and the transfer completes with them
- With reference color re-measurement (§6.4), every session reads all Compact tiles

## 12. Tests

- `cargo test --workspace` (`beamlet-stream` and `tools/bos-lab`)
  - Codes and primitives: `rs.rs` (`corrects_up_to_half_the_parity_for_full_and_shortened_codes`, `reports_failure_beyond_the_correction_limit`), `crc.rs` (`matches_the_standard_check_value`), `geom.rs` (`maps_the_four_points_and_inverts`), `handshake.rs` (`base45_matches_rfc_9285_examples`)
  - Header: `header.rs` `round_trips_through_damage`
  - Tiles (`tile.rs`): `round_trips_through_correctable_damage` (RS(255, 191) and RS(171, 128)); for every mode, `every_mode_keeps_the_parity_share_of_a_full_length_codeword`, `every_mode_corrects_up_to_its_bound_and_never_delivers_a_wrong_packet`, and `every_mode_rejects_a_miscorrection_by_its_crc`
  - Frame and detection: `frame.rs` `a_rendered_frame_reads_back_header_and_every_tile`, `render.rs` `symbol_packing_round_trips_for_every_bpc`, `detect.rs` `locates_cells_to_subpixel_accuracy_on_a_pixel_aligned_frame`
  - Synthetic camera (`tools/bos-lab/src/sim.rs`): `clean_capture_decodes_every_tile_in_every_mode`, `moderate_distortions_keep_almost_every_tile` (tilt, 180° rotation, blur, noise, color shift, barrel distortion), `combined_distortion_loses_only_the_tile_under_the_tear`, `pixel_perfect_frames_decode_without_marker_confusion`, `torn_capture_yields_tiles_from_both_frames` (rolling shutter)
  - Color reference: `sample.rs` `refining_follows_the_data_cells_when_the_palette_strips_read_off`
  - Key exchange: `handshake.rs` `both_sides_derive_the_same_key_from_the_key_code`, `rejects_malformed_codes_and_weak_keys`
  - Container (`container.rs`): `round_trips_stored_and_deflated_payloads_across_chunks`; `rejects_tampering_wrong_key_truncation_and_object_swaps` (1-byte modification, a different key, truncation of the end, and another object's number all yield `AuthFailed`); `refuses_to_inflate_past_the_declared_size`
  - Manifest: `manifest.rs` `round_trips_and_rejects_truncation`
  - Session (`session.rs`)
    - `files_arrive_intact_despite_dropped_frames` (30% of frames dropped), `every_mode_completes_a_transfer`, `finished_files_are_hashed_once_and_drop_their_decoder`, `frames_for_another_receiver_are_ignored`
    - Tracking: `tracking_follows_small_motion_and_falls_back_after_a_jump`, `a_receiver_tracks_across_interleaved_modes`
    - Mode choice: `picks_the_fastest_mode_the_receiver_can_take`, `a_small_screen_gets_compact_only_from_a_receiver_that_takes_it`
    - Schedule: `the_manifest_gets_a_tenth_of_the_tiles_however_few_a_frame_has`
    - Compact stream: `a_compact_stream_falls_back_to_stable_frames_carrying_the_same_symbols`, `stable_frames_are_mixed_in_from_the_first_frame_and_more_after_a_pass`, `a_camera_that_cannot_read_compact_completes_from_the_stable_frames`, `a_capture_torn_within_a_run_loses_only_the_tile_under_the_tear`
- wasm: `node web/test/e2e.mjs` (after `./web/build.sh`) exercises the exported API end to end without a browser: reading the key QR with `rqrr`, mode choice for a PC-sized and a phone-sized sender, matching fingerprints, sending 2 files, and receiving and verifying their contents and thumbnails
