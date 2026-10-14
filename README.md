# electron-update-from-npm

Publish your Electron app to npm or GitHub, and people can run it without an installer:

```sh
npx my-app                    # try it
npm i -g my-app               # install it from the npm registry
npm i -g github:owner/my-app  # or install it straight from GitHub, private repos too
my-app                        # then launch it
```

This package adds what an installer would have given you: auto-update and Start Menu / Desktop shortcuts.\
You need **no code signing** and **no release server**: `npm publish` or a pushed `v<version>` tag is your release.

## Install

```sh
npm install electron-update-from-npm
```

Requires Electron 30+ and npm (not pnpm or yarn). ESM-only (from CommonJS, use `await import()`).

## Quick example

```js
import { app, BrowserWindow } from 'electron'
import { NpmUpdater } from 'electron-update-from-npm'
import pkg from './package.json' with { type: 'json' }

const updater = new NpmUpdater(pkg) // checks npm for pkg.name, newer than pkg.version

app.whenReady().then(async () => {
  const win = new BrowserWindow()
  win.loadFile('index.html')

  // Your own update UI
  const update = await updater.check()
  if (update?.type === 'update') showUpdateButton(update.latest, () => updater.install(update.spec))
  if (update?.type === 'install') showInstallButton(() => updater.install(update.spec)) // under npx

  // Or a native dialog: "My App 1.3.0 is available" → Update now / Later (skips npx runs unless { offerInstall: true })
  updater.prompt()
})

updater.createShortcuts({ name: 'My App' }) // runs at startup, so still before the first window
```

## API

```js
const updater = new NpmUpdater(pkg, { // your app's package.json: its name, version, and the `bin` that reopens it
  source,               // default: npm, for pkg.name newer than pkg.version.
                        // 'github:owner/repo', for `npm i -g github:owner/repo`: checks that repo's highest v<version> tag.
                        // Tag each build to match its package.json version, e.g. in CI: npm pkg set version=0.1.0-build.<run number>
  dev: false,           // a dev-server run of a repo checkout: checks anyway (installing replaces your global install
})                      // and doesn't reopen), writes no shortcuts

const update = await updater.check() // asks again on each call, e.g. on a timer for an app left open
// → null                                         up to date, or a repo checkout
// → { type: 'update', current, latest, spec }    a newer version for an npm i -g install
// → { type: 'install', spec }                    running under npx, at once and offline too: offer npm i -g
// → { type: 'problem', problem, message, fix }   with a source: git can't sign in or isn't installed (prompt() shows it)
//   update.spec is what gets installed: 'my-app@1.3.0', or 'github:owner/repo#v1.3.0' with a source;
//   for 'install' it's 'my-app', or absent with a source (install() looks up the latest tag)

await updater.install(update.spec) // close, npm i -g, reopen via your package.json `bin` (the old version if it
                                   // failed); without an argument, installs what the last check found

updater.createShortcuts({ // Start Menu + Desktop on Windows, ~/Applications on macOS; once per npm i -g, none under npx
  name,                 // shortcut name (default: app.getName()); a repo checkout gets "<name> (local)"
  appId,                // reverse-DNS app id (default: com.electron.<package name>)
  description,          // Windows tooltip
})                      // never throws: a failed write is logged, and retried on the next launch

await updater.prompt({ offerInstall: false })        // optional: a native "Update now / Later" dialog instead of your own UI;
                                                     // offerInstall also asks npx runs to install globally

updater.launchMode      // 'npm-global' | 'npx-temp' | 'npm-start' (repo checkout) | 'npm-dev' (with { dev: true })
                        // without electron: launchMode(dir) from 'electron-update-from-npm/launch-mode'
```

## Bundling

If you bundle your main process, keep this package external, so it stays in `node_modules` next to the `bin/update.js` it starts. By default electron-vite 5+ does this for everything in `dependencies`, but elsewhere mark it yourself:

```js
build: { rollupOptions: { external: ['electron-update-from-npm'] } } // Vite; esbuild: --external:electron-update-from-npm
```

## License

MIT
