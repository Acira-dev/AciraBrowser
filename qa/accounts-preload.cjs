"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("localSetupQa", {
  setup: (request) => ipcRenderer.invoke("local-setup-qa:command", request),
});
