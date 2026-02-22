const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const WEB_URL = process.env.VIDERE_WEB_URL || "http://127.0.0.1:5173";

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Videre",
    backgroundColor: "#0d0f11",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.removeMenu();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadURL(WEB_URL).catch(() => {
    mainWindow.loadURL(
      "data:text/html;charset=UTF-8," +
        encodeURIComponent(
          `<html><body style="font-family:sans-serif;background:#0d0f11;color:#fff;padding:24px;">
            <h2>Videre failed to load</h2>
            <p>Expected web app at <code>${WEB_URL}</code>.</p>
            <p>Run <code>pnpm desktop:dev</code> to start all local services.</p>
          </body></html>`
        )
    );
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
