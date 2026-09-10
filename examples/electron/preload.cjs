const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("replHost", {
  control: (action, payload) => ipcRenderer.invoke("control", action, payload),
  onModel: (callback) =>
    ipcRenderer.on("model-output", (_, event) => callback(event)),
  onPreview: (callback) =>
    ipcRenderer.on("preview", (_, event) => callback(event)),
});
