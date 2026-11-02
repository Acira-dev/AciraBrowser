// Shared by probe.html and offscreen.html: turn a stream id into a stream (Chrome's getUserMedia constraints) and record 2 s of it.
async function streamFor(source, id, {audio = false, maxWidth = 1920, maxHeight = 1080} = {}) {
  const part = extra => ({mandatory: {chromeMediaSource: source, chromeMediaSourceId: id, ...extra}});
  return navigator.mediaDevices.getUserMedia({audio: audio ? part({}) : false, video: part({maxWidth, maxHeight, maxFrameRate: 30})});
}
async function record(stream, ms = 2000) {
  const track = stream.getVideoTracks()[0], settings = track ? track.getSettings() : {};
  const chunks = [], recorder = new MediaRecorder(stream, {mimeType: 'video/webm;codecs=vp8'});
  recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });
  recorder.start(250);
  await new Promise(resolve => setTimeout(resolve, ms));
  recorder.stop(); await stopped;
  const blob = new Blob(chunks, {type: 'video/webm'});
  // Decode what was recorded: its first frame's size is the size of the capture.
  const video = document.createElement('video'); video.muted = true; video.src = URL.createObjectURL(blob);
  const decoded = await new Promise(resolve => { video.onloadedmetadata = () => resolve({width: video.videoWidth, height: video.videoHeight}); video.onerror = () => resolve({error: String(video.error && video.error.message)}); setTimeout(() => resolve({timeout: true}), 4000); });
  for (const t of stream.getTracks()) t.stop();
  return {size: blob.size, chunks: chunks.length, settings: {width: settings.width, height: settings.height, displaySurface: settings.displaySurface}, decoded, audioTracks: stream.getAudioTracks().length, label: track && track.label};
}
