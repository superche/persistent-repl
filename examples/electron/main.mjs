import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";
import {
  createCuaProvider,
  MockCuaClient,
} from "@superche/persistent-repl/cua";
let window,
  session,
  closing = false,
  call = 0;
const host = new ReplHost(1);
const backend = new MockCuaClient((event) => {
  if (window && !window.isDestroyed())
    window.webContents.send("preview", event);
});
const context = () => ({
  ownerKey: "electron-fixture",
  taskKey: "demo",
  turnKey: "1",
  callKey: String(++call),
  authorizationRevision: "1",
});
app.whenReady().then(async () => {
  session = await host.create({
    ownerKey: "electron-fixture",
    taskKey: "demo",
    semanticsVersion: SEMANTICS_VERSION,
    capabilityRevision: "cua/1",
    authorizationRevision: "1",
    providers: [createCuaProvider(backend)],
    authorize: () => true,
    onOutput: (event) => window.webContents.send("model-output", event),
  });
  window = new BrowserWindow({
    width: 1050,
    height: 800,
    title: "Persistent REPL · Synthetic CUA",
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on("preload-error", (_, path, error) =>
    console.error("Fixture preload failed:", error.message),
  );
  window.webContents.on("console-message", (_event, details) =>
    console.error("Fixture renderer:", details.message),
  );
  ipcMain.handle("control", async (event, action, payload) => {
    if (event.sender !== window.webContents)
      throw new Error("Window owner mismatch");
    if (action === "execute")
      return host.execute(
        session,
        { code: String(payload).slice(0, 65536) },
        context(),
      );
    if (action === "status") return host.status(session);
    if (action === "reset") return host.reset(session);
    if (action === "dispose") return host.dispose(session);
    if (action === "stop") {
      const status = await host.status(session);
      const cancelled = status.executionId
        ? await host.cancel(session, status.executionId)
        : null;
      const stopped = await backend.stop(
        {
          sessionId: session.sessionId,
          trusted: context(),
          signal: new AbortController().signal,
        },
        "user-stop",
      );
      return { cancelled, externalCleanup: stopped };
    }
    throw new Error("Unknown control");
  });
  await window.loadFile(
    fileURLToPath(new URL("./index.html", import.meta.url)),
  );
});
app.on("before-quit", (event) => {
  if (closing) return;
  event.preventDefault();
  closing = true;
  void host.close().finally(() => app.quit());
});
app.on("window-all-closed", () => app.quit());
