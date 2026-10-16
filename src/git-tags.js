// The latest version of an app installed from git, from the repo's `v<version>` tags, with the credentials npm's install uses
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import hostedGitInfo from 'hosted-git-info'
import semver from 'semver'

// A background check must never prompt: git, the Windows credential manager and ssh all fail at once instead.
// LC_ALL=C keeps git's errors in English, which SIGN_IN and WRONG_ACCOUNT read
const ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE:     'never',
  GIT_SSH_COMMAND:     `${process.env.GIT_SSH_COMMAND || 'ssh'} -o BatchMode=yes`,
  LC_ALL:              'C',
}
const SIGN_IN = /could not read Username|Authentication failed|Permission denied \(publickey\)|Host key verification failed/i
// Signed in, but as an account or with a token that can't read the repo (signed out, a private repo gets a 401 instead):
// git only drops a saved sign-in after a 401, so it keeps reusing this one
const WRONG_ACCOUNT = /The requested URL returned error: 403|Permission to \S+ denied|repository (\S+ )?not found|you don't have permission to view it/i
const execFileAsync = promisify(execFile)

// Resolves to { latest, spec }; throws an Error with `problem` and `fix` when the user has to act
export async function latestTag(source) {
  const hosted = hostedGitInfo.fromUrl(source)
  if (!hosted) throw new Error(`not a git source: ${source}`)
  const urls = [hosted.https({ noGitPlus: true, noCommittish: true }), hosted.sshurl({ noGitPlus: true, noCommittish: true })] // as npm tries them
  const failures = []
  for (const url of urls) {
    let stdout
    try {
      stdout = await lsRemoteTags(url)
    } catch (err) {
      if (err.problem) throw err
      failures.push(err)
      continue
    }
    const { tag, version } = highestTag(stdout)
    return { latest: version, spec: hosted.shortcut({ committish: tag }) }
  }
  // Only when every URL was refused: one that merely timed out says nothing about the credentials
  if (failures.every(err => SIGN_IN.test(err.stderr) || WRONG_ACCOUNT.test(err.stderr))) {
    if (failures.some(err => WRONG_ACCOUNT.test(err.stderr))) {
      // No space before the pipe: cmd would pass it on, ending the url
      const forget = `echo url=https://${hosted.domain}| git credential reject`
      throw problem('wrong-account', `git signed in to ${hosted.domain} as an account that can't read ${hosted.path({ noCommittish: true })}`, `${forget}\ngit ls-remote ${urls[0]}`)
    }
    throw problem('sign-in', `git couldn't sign in to ${hosted.domain}`, `git ls-remote ${urls[0]}`)
  }
  throw failures[0]
}

async function lsRemoteTags(url) {
  try {
    return (await execFileAsync('git', ['ls-remote', '--tags', '--refs', url], { env: ENV, timeout: 30_000, windowsHide: true })).stdout
  } catch (err) {
    throw err.code === 'ENOENT' ? problem('git-missing', 'git is not installed', 'https://git-scm.com/downloads') : err
  }
}

function highestTag(lsRemote) {
  const tags = lsRemote.split('\n')
    .map(line => line.split('\trefs/tags/')[1])
    .map(tag => ({ tag, version: tag && semver.clean(tag) }))
    .filter(t => t.version)
  if (!tags.length) throw new Error('no v<version> tags in the repo')
  return tags.sort((a, b) => semver.rcompare(a.version, b.version))[0]
}

function problem(kind, message, fix) {
  return Object.assign(new Error(message), { problem: kind, fix })
}
