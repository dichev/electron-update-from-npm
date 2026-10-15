// createShortcuts() writes launchers on the first launch of each install or update, then only when what they contain changes.
// These tests pin when shortcuts are written, that a deleted one stays deleted until the next install, which name
// and app id each kind of launch gets, that a failed write is retried rather than thrown, and the icon conversion.
// They run the @windows flavour on any OS; @macOS needs a real Electron.app, except with an icon.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  dirs: {}, // set per test
  app: { getAppPath: () => mocks.dirs.app, getPath: name => mocks.dirs[name], getName: () => 'my-app', setAppUserModelId: vi.fn() },
  shell: { writeShortcutLink: vi.fn() },
  // A fake image whose PNG bytes name the file and the size it was resized to, e.g. 'icon256'
  nativeImage: { createFromPath: vi.fn(path => ({ isEmpty: () => path.endsWith('missing.png'), resize: ({ width }) => ({ toPNG: () => Buffer.from(`${path.match(/(\w+)\.png$/)[1]}${width}`) }) })) },
}))
vi.mock('electron', () => ({ app: mocks.app, shell: mocks.shell, nativeImage: mocks.nativeImage }))

import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const platform = process.platform
let tmp

function installAt(...segments) {
  mocks.dirs.app = join(tmp, ...segments, 'my-app')
  fs.mkdirSync(mocks.dirs.app, { recursive: true })
}

async function launch(options = { appId: 'com.example.my-app', name: 'My App' }, updaterOptions) {
  const { NpmUpdater } = await import('../src/updater.js')
  new NpmUpdater({ name: 'my-app', version: '1.0.0' }, updaterOptions).createShortcuts(options)
}

// Makes the next launch look like the first one after an update: the stored birth times are an older install's
function update() {
  const file = join(mocks.dirs.userData, 'electron-update-from-npm.json')
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))).map(([path, written]) => [path, { ...written, install: 1 }]))))
}

const written = () => mocks.shell.writeShortcutLink.mock.calls.map(([path, , { appUserModelId }]) => [path.includes('Start Menu') ? 'start' : 'desktop', basename(path), appUserModelId])

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { value: 'win32' })
  tmp = fs.mkdtempSync(join(tmpdir(), 'shortcuts-'))
  mocks.dirs = { appData: join(tmp, 'appData'), desktop: join(tmp, 'desktop'), userData: join(tmp, 'userData'), home: join(tmp, 'home') }
  fs.mkdirSync(join(mocks.dirs.appData, 'Microsoft/Windows/Start Menu/Programs'), { recursive: true })
  fs.mkdirSync(mocks.dirs.desktop)
  mocks.shell.writeShortcutLink.mockImplementation(path => { fs.writeFileSync(path, ''); return true })
  installAt('npm', 'node_modules')
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform })
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('createShortcuts', () => {
  it('creates Start Menu and Desktop shortcuts on a new install, under the app id', async () => {
    await launch()
    expect(written()).toEqual([
      ['start', 'My App.lnk', 'com.example.my-app'],
      ['desktop', 'My App.lnk', 'com.example.my-app'],
    ])
    expect(mocks.app.setAppUserModelId).toHaveBeenCalledWith('com.example.my-app')
  })

  it('writes nothing on later launches of the same install, so a deleted shortcut stays deleted', async () => {
    await launch()
    fs.rmSync(join(mocks.dirs.desktop, 'My App.lnk'))
    vi.clearAllMocks()
    await launch()
    expect(written()).toEqual([])
    expect(mocks.app.setAppUserModelId).toHaveBeenCalledWith('com.example.my-app')
  })

  it('re-points existing shortcuts and recreates deleted ones after an update', async () => {
    await launch()
    fs.rmSync(join(mocks.dirs.desktop, 'My App.lnk'))
    update()
    vi.clearAllMocks()
    await launch()
    expect(written().map(([place]) => place)).toEqual(['start', 'desktop'])
  })

  it('re-points the remaining shortcuts when what they contain changes, but keeps a deleted one deleted', async () => {
    installAt('src')
    await launch()
    fs.rmSync(join(mocks.dirs.desktop, 'My App (local).lnk'))
    vi.clearAllMocks()
    await launch({ appId: 'com.example.renamed', name: 'My App' }) // likewise a moved checkout, a new logo, or a new PATH on macOS
    expect(written()).toEqual([['start', 'My App (local).lnk', 'com.example.renamed.local']])
  })

  it('gives a repo checkout its own shortcuts, so both stay launchable', async () => {
    installAt('src')
    await launch()
    expect(written()).toEqual([
      ['start', 'My App (local).lnk', 'com.example.my-app.local'],
      ['desktop', 'My App (local).lnk', 'com.example.my-app.local'],
    ])
  })

  it.each([
    ['an npx run', () => installAt('.npm', '_npx', 'ab12', 'node_modules'), {}, 'com.example.my-app'],
    ['dev', () => installAt('src'), { dev: true }, 'com.example.my-app.local'],
  ])('writes none for %s, but still sets the app id', async (_, setup, config, appId) => {
    setup()
    await launch(undefined, config)
    expect(written()).toEqual([])
    expect(mocks.app.setAppUserModelId).toHaveBeenCalledWith(appId)
  })

  it('logs a failed write instead of throwing, still writes the rest, and retries the failed one on the next launch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.shell.writeShortcutLink.mockReturnValueOnce(false)
    await expect(launch()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('[electron-update-from-npm] shortcuts failed:', expect.stringContaining('cannot write'))
    expect(written().map(([place]) => place)).toEqual(['start', 'desktop'])
    expect(mocks.app.setAppUserModelId).toHaveBeenCalledWith('com.example.my-app')
    vi.clearAllMocks()
    await launch()
    expect(written().map(([place]) => place)).toEqual(['start'])
    warn.mockRestore()
  })

  it('defaults the app id to the package name and the shortcut name to the app name', async () => {
    await launch({})
    expect(written()[0]).toEqual(['start', 'my-app.lnk', 'com.electron.my-app'])
  })

  describe('icon', () => {
    const icoDir = () => join(mocks.dirs.userData, 'shortcut-icons/com.electron.my-app')
    const icos   = () => fs.existsSync(icoDir()) ? fs.readdirSync(icoDir()).map(name => join(icoDir(), name)) : []
    const icons  = () => mocks.shell.writeShortcutLink.mock.calls.map(([, , { icon, iconIndex }]) => [icon, iconIndex])

    it('points the shortcuts at the PNG converted to an .ico in userData, resolved from the app dir', async () => {
      await launch({ name: 'My App', icon: 'build/icon.png' })
      expect(mocks.nativeImage.createFromPath).toHaveBeenCalledWith(join(mocks.dirs.app, 'build/icon.png'))
      const [ico] = icos()
      expect(icons()).toEqual([[ico, 0], [ico, 0]])
      const file = fs.readFileSync(ico)
      expect([0, 2, 4].map(at => file.readUInt16LE(at))).toEqual([0, 1, 1]) // ICONDIR: reserved, icon type, one image
      expect([file[6], file[7], file.readUInt16LE(10), file.readUInt16LE(12)]).toEqual([0, 0, 1, 32]) // 256×256, planes, bpp
      expect([file.readUInt32LE(14), file.readUInt32LE(18)]).toEqual([7, 22]) // PNG length and offset
      expect(file.subarray(22).toString()).toBe('icon256')
    })

    it('writes a new logo to a new .ico, as Explorer caches icons by path, and removes the old one', async () => {
      await launch({ name: 'My App', icon: 'icon.png' })
      const [old] = icos()
      vi.clearAllMocks()
      await launch({ name: 'My App', icon: 'logo.png' })
      const [ico] = icos()
      expect(icos()).toHaveLength(1)
      expect(ico).not.toBe(old)
      expect(icons()).toEqual([[ico, 0], [ico, 0]])
      expect(fs.readFileSync(ico).subarray(22).toString()).toBe('logo256')
    })

    it("keeps Electron's icon without the option", async () => {
      await launch()
      expect(icons()).toEqual([[process.execPath, 0], [process.execPath, 0]])
      expect(mocks.nativeImage.createFromPath).not.toHaveBeenCalled()
      expect(icos()).toEqual([])
    })

    it("falls back to Electron's icon, with a warning, when the PNG can't be read", async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await launch({ name: 'My App', icon: 'missing.png' })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot read icon'))
      expect(icons()).toEqual([[process.execPath, 0], [process.execPath, 0]])
      warn.mockRestore()
    })

    it('puts the PNG into the @macOS bundle as an .icns of 256 and 512 px', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      await launch({ name: 'My App', icon: 'icon.png' })
      const file = fs.readFileSync(join(mocks.dirs.home, 'Applications/My App.app/Contents/Resources/icon.icns'))
      expect([file.toString('latin1', 0, 4), file.readUInt32BE(4)]).toEqual(['icns', file.length])
      expect([file.toString('latin1', 8, 12), file.readUInt32BE(12), file.toString('latin1', 16, 23)]).toEqual(['ic08', 15, 'icon256'])
      expect([file.toString('latin1', 23, 27), file.readUInt32BE(27), file.toString('latin1', 31, 38)]).toEqual(['ic09', 15, 'icon512'])
    })
  })
})
