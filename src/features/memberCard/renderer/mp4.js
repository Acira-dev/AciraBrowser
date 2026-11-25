// Beta 14 member cards: the saved video as an MP4 (H.264, yuv420p, 4:2:0), so it can be posted on Instagram, TikTok and X as it is (reported 17 Nov).
// The frames are encoded with the browser's own WebCodecs H.264 encoder (hardware where there is one: VideoToolbox on a Mac, Media Foundation on Windows) and put into a plain MP4 here:
// ONE video track, no audio, `moov` before `mdat` (plays and streams from the first byte), one entry per sample in stsz/stss, a single chunk. No B-frames (real-time encoding), so no composition offsets are needed.
// Pure JavaScript with no imports and no assets, so a test can run it in Node. Nothing here touches the page.
const FOUR = (text) => [...text].map((c) => c.charCodeAt(0));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n) => [(n >>> 8) & 255, n & 255];
const zeros = (n) => new Array(n).fill(0);
const join = (parts) => { let size = 0; for (const p of parts) size += p.length; const out = new Uint8Array(size); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
/** One box: 4-byte size, 4-byte type, the parts. */
const box = (type, ...parts) => { const body = join(parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)))); return join([Uint8Array.from([...be32(body.length + 8), ...FOUR(type)]), body]); };
const full = (version, flags) => [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255];
const MATRIX = [...be32(0x00010000), ...zeros(12), ...be32(0x00010000), ...zeros(12), ...be32(0x40000000)];
const EPOCH_1904 = 2082844800;

/** H.264 profiles tried in this order: High, Main, Constrained Baseline, all at level 4.0 (a 720 x 1080 clip at 30 fps is level 3.1; 4.0 leaves room). The encoder writes its real profile and level into the stream and the avcC record. */
export const H264_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'];
/** Even sizes (4:2:0 needs them): the card is 2:3, so the width is made even and the height is 1.5 times it, made even. */
export const clipSize = (width) => { const w = Math.max(2, Math.round(width / 2) * 2); return { width: w, height: Math.max(2, Math.round((w * 1.5) / 2) * 2) }; };

/** The first H.264 configuration this browser can encode at that size, or null (no WebCodecs, or no H.264 encoder here). `api` is the global scope (a test passes a stand-in). */
export async function pickH264(width, fps = 30, api = globalThis) {
  try {
    if (typeof api.VideoEncoder !== 'function' || typeof api.VideoFrame !== 'function' || typeof api.VideoEncoder.isConfigSupported !== 'function') return null;
    const { width: w, height: h } = clipSize(width);
    for (const codec of H264_CODECS) {
      const config = { codec, width: w, height: h, framerate: fps, bitrate: 5e6, latencyMode: 'realtime', avc: { format: 'avc' } };
      let answer = null; try { answer = await api.VideoEncoder.isConfigSupported(config); } catch { /* this one is not understood */ }
      if (answer && answer.supported) return config;
    }
  } catch { /* none */ }
  return null;
}
/** 'mp4' when the clip can be an MP4 here, else 'webm' (the recorder's own format). */
export async function videoFormat(width = 720, fps = 30, api = globalThis) { return (await pickH264(width, fps, api)) ? 'mp4' : 'webm'; }
/** Whether Save video makes an MP4 here (the Welcome names the file type under the button). */
export const canRecordMp4 = (width = 720, fps = 30, api = globalThis) => pickH264(width, fps, api).then((config) => !!config);

/**
 * Writes the MP4. `samples`: [{data: Uint8Array in AVCC form (length-prefixed NAL units, as the encoder gives them with avc.format 'avc'), key: boolean}] in decode order, one per frame at a constant `fps`;
 * `avcC`: the encoder's decoderConfig.description (the AVCDecoderConfigurationRecord). Returns the file's bytes.
 */
export function muxMp4({ width, height, fps = 30, samples, avcC }) {
  if (!samples || !samples.length) throw new Error('no frames');
  if (!(avcC instanceof Uint8Array) || avcC.length < 7 || avcC[0] !== 1) throw new Error('no avcC');
  if (!(width > 0 && height > 0) || width % 2 || height % 2) throw new Error('odd size');
  const n = samples.length, timescale = fps * 1000, delta = 1000;
  const sizes = samples.map((s) => s.data.length), keys = []; samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
  if (!keys.length || keys[0] !== 1) throw new Error('the first frame must be a key frame');
  const now = Math.floor(Date.now() / 1000) + EPOCH_1904, movieMs = Math.round((n * 1000) / fps);
  const ftyp = box('ftyp', FOUR('isom'), be32(0x200), FOUR('isom'), FOUR('iso2'), FOUR('avc1'), FOUR('mp41'));
  const stsd = box('stsd', full(0, 0), be32(1), box('avc1',
    zeros(6), be16(1), zeros(16), be16(width), be16(height), be32(0x00480000), be32(0x00480000), be32(0), be16(1),
    [11, ...FOUR('Acira video'), ...zeros(20)], be16(0x0018), be16(0xffff), box('avcC', avcC)));
  const moov = (offset) => box('moov',
    box('mvhd', full(0, 0), be32(now), be32(now), be32(1000), be32(movieMs), be32(0x00010000), be16(0x0100), zeros(10), MATRIX, zeros(24), be32(2)),
    box('trak',
      box('tkhd', full(0, 3), be32(now), be32(now), be32(1), be32(0), be32(movieMs), zeros(8), be16(0), be16(0), be16(0), be16(0), MATRIX, be32(width << 16), be32(height << 16)),
      box('mdia',
        box('mdhd', full(0, 0), be32(now), be32(now), be32(timescale), be32(n * delta), be16(0x55c4), be16(0)),
        box('hdlr', full(0, 0), be32(0), FOUR('vide'), zeros(12), [...FOUR('VideoHandler'), 0]),
        box('minf',
          box('vmhd', full(0, 1), zeros(8)),
          box('dinf', box('dref', full(0, 0), be32(1), box('url ', full(0, 1)))),
          box('stbl', stsd,
            box('stts', full(0, 0), be32(1), be32(n), be32(delta)),
            box('stss', full(0, 0), be32(keys.length), keys.flatMap(be32)),
            box('stsc', full(0, 0), be32(1), be32(1), be32(n), be32(1)),
            box('stsz', full(0, 0), be32(0), be32(n), sizes.flatMap(be32)),
            box('stco', full(0, 0), be32(1), be32(offset)))))));
  const mdatSize = sizes.reduce((a, b) => a + b, 0) + 8;
  const head = ftyp.length, moovLength = moov(0).length;   // the offsets do not change the box's length
  const first = head + moovLength + 8;
  const out = join([ftyp, moov(first), join([Uint8Array.from([...be32(mdatSize), ...FOUR('mdat')]), ...samples.map((s) => s.data)])]);
  return out;
}

/**
 * Records `frames` frames of the clip as H.264 and returns the MP4's bytes. `drawFrame(i)` makes frame i appear on `canvas` (the caller's own scene); the frames are read straight after it, in the same task.
 * Rejects on any trouble (no encoder, an encoder error, a frame out of order, no avcC): the caller then makes its WebM instead.
 */
export async function encodeMp4({ canvas, frames, fps = 30, config, drawFrame, onProgress, api = globalThis }) {
  const { width, height } = config;
  const samples = []; let avcC = null, failure = null, last = -1;
  const encoder = new api.VideoEncoder({
    output: (chunk, meta) => {
      if (chunk.timestamp <= last) { failure = failure || new Error('frames out of order'); return; }   // B-frames would need composition offsets: not written, so not accepted
      last = chunk.timestamp;
      const d = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (d && !avcC) avcC = d instanceof Uint8Array ? Uint8Array.from(d) : new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key' });
    },
    error: (e) => { failure = failure || e || new Error('encoder error'); },
  });
  try {
    encoder.configure(config);
    for (let i = 0; i < frames; i++) {
      if (failure) throw failure;
      drawFrame(i);
      const frame = new api.VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      try { encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 }); } finally { frame.close(); }
      onProgress?.((i + 1) / frames);
      if (encoder.encodeQueueSize > 6) await new Promise((resolve) => { encoder.addEventListener('dequeue', resolve, { once: true }); setTimeout(resolve, 250); });
      else if (i % 12 === 11) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await encoder.flush();
    if (failure) throw failure;
    if (samples.length !== frames) throw new Error('frames lost');
    return muxMp4({ width, height, fps, samples, avcC });
  } finally { try { encoder.close(); } catch { /* closed */ } }
}
