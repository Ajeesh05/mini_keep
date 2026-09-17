#!/usr/bin/env node
/**
 * Assigns the next version and records it.
 *
 * Versions are decided here, at release time, rather than on feature branches.
 * Two branches in flight would otherwise both claim the same next number and
 * whichever merged second would ship a version that already exists - which the
 * Chrome Web Store rejects outright, since an upload must be strictly greater
 * than what is published.
 *
 *   node version-bump.mjs <patch|minor|major>   bump, write files, print version
 *   node version-bump.mjs --current             print the current version
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

/**
 * Chrome accepts 1-4 dot-separated integers, each 0-65535, no leading zeros
 * and no prerelease suffix. So semver is the reasoning model, but "1.2.3-beta"
 * is never a legal manifest version.
 */
export function nextVersion(current, bump) {
  const parts = String(current).split('.').map(Number)
  while (parts.length < 3) parts.push(0)
  let [major, minor, patch] = parts

  if (bump === 'major') [major, minor, patch] = [major + 1, 0, 0]
  else if (bump === 'minor') [major, minor, patch] = [major, minor + 1, 0]
  else if (bump === 'patch') patch += 1
  else throw new Error(`Unknown bump "${bump}" - expected patch, minor or major`)

  if ([major, minor, patch].some(n => n > 65535)) {
    throw new Error(`Bumping ${current} to ${major}.${minor}.${patch} exceeds Chrome's 65535 limit`)
  }
  return `${major}.${minor}.${patch}`
}

const readJson = p => JSON.parse(readFileSync(p, 'utf8'))

/** Commit subjects since the last tag, minus the noise nobody reads. */
export function changesSinceLastTag(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  let range = ''
  try {
    range = `${git(['describe', '--tags', '--abbrev=0'])}..HEAD`
  } catch {
    range = '' // no tags yet: take everything
  }

  const log = git(['log', '--no-merges', '--pretty=format:%s', ...(range ? [range] : [])])
  return log
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^Release v/.test(line))
    .filter(line => !/^(chore|ci|docs)[:(]/i.test(line))
}

export function writeChangelog(root, version, entries) {
  const path = join(root, 'CHANGELOG.md')
  const date = new Date().toISOString().slice(0, 10)
  const section = [
    `## ${version} - ${date}`,
    '',
    ...(entries.length ? entries.map(e => `- ${e}`) : ['- No user-visible changes.']),
    ''
  ].join('\n')

  if (!existsSync(path)) {
    writeFileSync(path, `# Changelog\n\n${section}`)
    return
  }

  const existing = readFileSync(path, 'utf8')
  const marker = '# Changelog\n'
  writeFileSync(
    path,
    existing.startsWith(marker)
      ? existing.replace(marker, `${marker}\n${section}`)
      : `# Changelog\n\n${section}\n${existing}`
  )
}

export function applyBump(root, bump) {
  const manifestPath = join(root, 'manifest.json')
  const manifest = readJson(manifestPath)
  const current = manifest.version
  const version = nextVersion(current, bump)

  // Preserve the file's own formatting habits rather than reformatting it.
  const raw = readFileSync(manifestPath, 'utf8')
  const indent = /^\s*\n?\s*"/.test(raw) ? (raw.match(/\n(\s+)"/)?.[1].length ?? 2) : 2
  manifest.version = version
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, indent)}\n`)

  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath)
    pkg.version = version
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  writeChangelog(root, version, changesSinceLastTag(root))
  return { current, version }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = process.cwd()
  const arg = process.argv[2]

  if (arg === '--current') {
    console.log(readJson(join(root, 'manifest.json')).version)
  } else {
    const { current, version } = applyBump(root, arg)
    console.log(`${current} -> ${version}`)
    // Consumed by the release workflow.
    if (process.env.GITHUB_OUTPUT) {
      writeFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nprevious=${current}\n`, { flag: 'a' })
    }
  }
}
