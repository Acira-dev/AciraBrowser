import { useCallback, useEffect, useRef, useState } from 'react';
import { runtime } from '../runtime/client';
import type { OwnVideo } from '../runtime/connectedServices';
import { artworkError } from './usePersonalArtwork';

/** 14.4 live wallpaper: the sizes Acira keeps (desktop/workspace-video.cjs MAX_LONG_SIDE / MAX_SHORT_SIDE): up to 3840 x 2160 either way round. */
export const videoSizeAllowed = (width: number, height: number): boolean => width > 0 && height > 0 && Math.max(width, height) <= 3840 && Math.min(width, height) <= 2160;
/** The content type mediaCapabilities is asked about: a MOV is the MP4 family to the engine. */
export const capabilityType = (mime: string, codec: string): string => `${mime === 'video/quicktime' ? 'video/mp4' : mime}; codecs="${codec}"`;

/** desktop/workspace-video.cjs MAX_STILL_BYTES: the first frame kept as the still. */
export const MAX_STILL_BYTES = 2 * 1024 * 1024;
export interface ProbedVideo { still: string; width: number; height: number; duration: number; powerEfficient: boolean }
export class VideoRefused extends Error {}

/** The engine's own check of a copied video, before it is kept: it must decode its first frame within 8 s (that frame becomes the still the New Tab shows
 * at once), be at most 3840 x 2160, and the engine says whether it decodes it efficiently (mediaCapabilities decodingInfo powerEfficient: a file it does not is
 * kept, but never plays on battery). Muted, never attached to the page. */
export async function probeVideo(pending: { url: string; mime: string; codec: string; bytes: number }, timeoutMs = 8000): Promise<ProbedVideo> {
  const video = document.createElement('video');
  video.muted = true; video.defaultMuted = true; video.volume = 0; video.preload = 'auto'; video.playsInline = true; video.disablePictureInPicture = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new VideoRefused('unplayable')), timeoutMs);
      video.addEventListener('loadeddata', () => { window.clearTimeout(timer); resolve(); }, { once: true });
      video.addEventListener('error', () => { window.clearTimeout(timer); reject(new VideoRefused('unplayable')); }, { once: true });
      video.src = pending.url;
    });
    const width = video.videoWidth, height = video.videoHeight;
    if (!width || !height) throw new VideoRefused('unplayable');
    if (!videoSizeAllowed(width, height)) throw new VideoRefused('too-large');
    const scale = Math.min(1, 1920 / width), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [.9, .8, .7, .6]) { blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality)); if (!blob || blob.size <= MAX_STILL_BYTES) break; }
    if (!blob || blob.size > MAX_STILL_BYTES) throw new VideoRefused('unplayable');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    let powerEfficient = false;
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: capabilityType(pending.mime, pending.codec), width, height, bitrate: duration > 0 ? Math.max(1, Math.round(pending.bytes * 8 / duration)) : 5_000_000, framerate: 30 } });
      powerEfficient = info.supported && info.powerEfficient;
    } catch { powerEfficient = false; }
    return { still: btoa(binary), width, height, duration, powerEfficient };
  } finally { video.removeAttribute('src'); video.load(); }
}

/** Adds a video: the chooser (main copies the file in), the engine's check here, then main keeps it with its still. Null when the chooser was cancelled. */
export async function addOwnVideo(): Promise<OwnVideo | null> {
  const chosen = await runtime.service({ type: 'artwork.video-import' });
  const pending = chosen.artworkVideo?.pending;
  if (!pending) return null;
  try {
    const probed = await probeVideo(pending);
    const kept = await runtime.service({ type: 'artwork.video-commit', id: pending.id, ...probed });
    return kept.artworkVideo?.video ?? null;
  } catch (reason) { await runtime.service({ type: 'artwork.video-discard', id: pending.id }).catch(() => undefined); throw reason; }
}
export const videoErrorKey = (reason: unknown): string | null => reason instanceof VideoRefused ? (reason.message === 'too-large' ? 'ntp.videoTooLarge' : 'ntp.videoUnplayable') : null;
export { artworkError };

/** The profile's video (null when none), kept current with main's `artwork-changed`. */
export function useOwnVideo(profileId: string, privateMode: boolean, enabled: boolean) {
  const [video, setVideo] = useState<OwnVideo | null>(null), [owner, setOwner] = useState(''), generation = useRef(0);
  const want = enabled && !privateMode, key = profileId + ':' + privateMode;
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    if (!want) { setVideo(null); setOwner(key); return; }
    try { const result = await runtime.service({ type: 'artwork.video' }); if (current !== generation.current) return; setVideo(result.artworkVideo?.profileId === profileId ? result.artworkVideo.video ?? null : null); }
    catch { if (current === generation.current) setVideo(null); }
    if (current === generation.current) setOwner(key);
  }, [want, profileId, key]);
  useEffect(() => { void refresh(); const unsubscribe = runtime.subscribeBrowser(event => { if (event.type === 'artwork-changed' && event.profileId === profileId) void refresh(); }); return () => { generation.current++; unsubscribe(); }; }, [refresh, profileId]);
  return { pending: want && owner !== key, video: owner === key ? video : null, refresh };
}

/** Battery and Low Power Mode, from main (desktop/power-state.cjs): asked when a video wallpaper shows, then once a minute while `watching`, and on main's `power-state`. */
export function usePowerState(watching: boolean) {
  const [power, setPower] = useState({ onBattery: false, lowPower: false });
  useEffect(() => {
    let alive = true;
    const ask = () => void runtime.service({ type: 'power.state' }).then(result => { if (alive && result.power) setPower(old => old.onBattery === result.power!.onBattery && old.lowPower === result.power!.lowPower ? old : result.power!); }).catch(() => undefined);
    ask();
    const unsubscribe = runtime.subscribeBrowser(event => { if (event.type === 'power-state') setPower({ onBattery: event.onBattery, lowPower: event.lowPower }); });
    const timer = watching ? window.setInterval(ask, 60_000) : 0;
    return () => { alive = false; unsubscribe(); if (timer) window.clearInterval(timer); };
  }, [watching]);
  return power;
}
