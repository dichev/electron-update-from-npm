# electron-update-from-npm

Publish your Electron app to npm, and people can run it without an installer:

```sh
npx my-app        # try it
npm i -g my-app   # install it, then launch with `my-app`
```

This package adds what an installer would have given you: auto-update and Start Menu / Desktop shortcuts. No code signing or release server: `npm publish` is your release.

## Install

```sh
npm install electron-update-from-npm
```

Requires Electron 30+ and npm (not pnpm or yarn). ESM-only (from CommonJS, use `await import()`).

## API

```js
await checkForUpdate({
  dev: false,           // check from a repo checkout too (otherwise null there); the install then doesn't reopen
  fresh: false,         // check again instead of reusing the last answer, e.g. on a timer
  source,               // check a git repo instead of npm, e.g. 'github:owner/repo' (see Installing from npm or git)
})                      // → { name, current, latest, mode, spec }, { problem, message, fix }, or null; under npx always a result

await installUpdate()   // install what the last check found: close, npm i -g, reopen via your package.json `bin` (the old version if it failed)

createShortcuts({       // Start Menu + Desktop on Windows, ~/Applications on macOS; once per npm i -g, none under npx
  name,                 // shortcut name (default: app.getName()); a repo checkout gets "<name> (local)"
  appId,                // reverse-DNS app id (default: com.electron.<package name>)
  description,          // Windows tooltip
  dev: false,           // write no shortcuts from a repo checkout
})

launchMode(app.getAppPath()) // 'npm-global' | 'npx-temp' | 'npm-start' (repo checkout) | 'npm-dev' (with { dev: true })
                             // also in 'electron-update-from-npm/launch-mode', without the electron import

await promptForUpdate({ npx: false, ...checkOptions }) // optional: a native "Update now / Later" dialog instead of your own UI
```

## Quick example

```js
import { app, BrowserWindow } from 'electron'
import { checkForUpdate, createShortcuts, installUpdate, promptForUpdate } from 'electron-update-from-npm'

createShortcuts({ name: 'My App' }) // before the first window

app.whenReady().then(async () => {
  const win = new BrowserWindow()
  win.loadFile('index.html')

  // Your own update UI
  const update = await checkForUpdate()
  if (update?.spec) showUpdateButton(update.latest, () => installUpdate())

  // Or a native dialog: "My App 1.3.0 is available" → Update now / Later (skips npx runs unless { npx: true })
  promptForUpdate()
})
```

## Installing from npm or git

```js
// From npm (default), for `npm i -g my-app` or `npx my-app`: checks npm's latest version
await checkForUpdate()
// → { ..., latest: '1.3.0', spec: 'my-app@1.3.0' }

// From git, for `npm i -g github:owner/repo`: checks the repo's v<version> tags instead
await checkForUpdate({ source: 'github:owner/repo' }) // promptForUpdate takes it too
// → { ..., latest: '0.1.0-build.42', spec: 'github:owner/repo#v0.1.0-build.42' }, the highest tag
// → { problem: 'sign-in' | 'git-missing', message, fix } when git can't sign in or isn't installed (promptForUpdate shows it)

// So tag each build v<version>, matching its package.json version, e.g. in CI:
//   npm pkg set version=0.1.0-build.${{ github.run_number }}
```

## Bundling

If you bundle your main process, keep this package external, so it stays in `node_modules` next to the `installer.js` it starts. By default electron-vite 5+ does this for everything in `dependencies`, but elsewhere mark it yourself:

```js
build: { rollupOptions: { external: ['electron-update-from-npm'] } } // Vite; esbuild: --external:electron-update-from-npm
```

## License

MIT
