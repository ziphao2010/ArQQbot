import { app, BrowserWindow, safeStorage } from 'electron'
import path from 'node:path'
import { InstanceManager } from './instance-manager'
import { createElectronWorkerFactory } from './electron-worker-factory'
import { createSecretCodec } from './secrets'
import { registerIpc } from './ipc'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let manager: InstanceManager | undefined

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'ArQQBot',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f5f5f7',
      symbolColor: '#1d1d1f',
      height: 40
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  const appPath = app.getAppPath()
  const builtinPluginRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'plugins')
    : path.resolve(appPath, '../../packages')
  const externalPluginRoot = path.join(app.getPath('userData'), 'plugins')
  const workerEntryPath = app.isPackaged
    ? path.join(process.resourcesPath, 'worker/worker-entry.cjs')
    : path.resolve(appPath, '../../packages/runtime/dist/worker-entry.cjs')

  manager = new InstanceManager({
    rootDir: app.getPath('userData'),
    builtinPluginRoot,
    externalPluginRoot,
    workerFactory: createElectronWorkerFactory(workerEntryPath),
    secretCodec: createSecretCodec(safeStorage)
  })

  await manager.init()
  registerIpc(manager)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void manager?.shutdown()
})
