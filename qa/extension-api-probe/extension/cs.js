// Content-script context of the API surface probe (runs on the rig's local fixture page only; see the manifest's matches).
if (location.pathname === '/fixture' && !window.__aciraProbeRan) {
  window.__aciraProbeRan = true;
  self.aciraProbe('content_script', self.ACIRA_PROBE_CONFIG).then(report => { document.documentElement.dataset.probeDone = String(Object.keys(report.surface).length); });
}
