// Extension-page context of the API surface probe.
self.aciraProbe('extension_page', self.ACIRA_PROBE_CONFIG).then(report => { document.body.dataset.probeDone = String(Object.keys(report.surface).length); });
