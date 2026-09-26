#!/usr/bin/env node
/**
 * Collects the files that actually ship, into a directory or a zip.
 *
 * The same file set feeds three consumers, which is the point: E2E loads the
 * packed directory, CI uploads the packed zip, and the release job sends that
 * zip to the Chrome Web Store. If a file is missing from the store build, the
 * E2E run is missing it too, so the tests notice before users do.
 */

import { readFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Patterns excluded from every build regardless of project config. */
const ALWAYS_EXCLUDE = [
  'node_modules',
  'tests',
  '.git',
  '.github',
  '.ai',
  '.codex',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  'blob-report',
  'docs'
]

const ALWAYS_EXCLUDE_FILES = [
  'package.json',
  'package-lock.json',
  'eslint.config.js',
  'vitest.config.js',
  'playwright.config.js',
  'project.yml',
  'CLAUDE.md',
  '.gitignore'
]

/**
 * File types a browser extension can actually use.
 *
 * The rest of this function is a deny-list, which means anything a tool drops
 * into the tree ships unless someone thought to name it. That is how a gitleaks
 * SARIF report - the secret scanner's own output - ended up inside a packaged
 * extension: CI wrote results.sarif to the repo root and the packer had no
 * opinion about it. That particular report was clean, but the same path would
 * have published matched secret fragments and internal file paths to anyone who
 * downloaded the extension from the store.
 *
 * An allow-list fails the other way: something unusual gets left out, loudly,
 * rather than something private getting shipped, silently.
 */
const SHIPPABLE = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'wasm',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'ogg', 'wav', 'webm', 'mp4', 'txt'
])

/** Files left out because their type is not shippable, for the build log. */
export const skippedByType = []

function shouldSkip(relPath, extraDirs, extraFiles, isDirectory = false) {
  const parts = relPath.split(sep)
  const top = parts[0]
  const name = parts[parts.length - 1]

  if (ALWAYS_EXCLUDE.includes(top) || extraDirs.includes(top)) return true

  // No dotfile belongs in a store upload - not .gitignore, not the lint and
  // manifest baselines, not editor config. A packaged extension that carries
  // repository plumbing is both larger and more revealing than it needs to be.
  if (name.startsWith('.')) return true

  if (parts.length === 1) {
    if (ALWAYS_EXCLUDE_FILES.includes(relPath) || extraFiles.includes(relPath)) return true
    if (relPath.endsWith('.zip')) return true
    if (relPath.endsWith('.md')) return true
  }

  // Directories are traversed; only the files inside them are judged on type.
  if (isDirectory) return false

  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (!SHIPPABLE.has(ext)) {
    skippedByType.push(relPath)
    return true
  }

  return false
}

/** Every shippable file, as paths relative to `root`. */
export function collectFiles(root, { extraDirs = [], extraFiles = [] } = {}) {
  const out = []

  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry)
      const rel = relative(root, abs)
      const isDirectory = statSync(abs).isDirectory()
      if (shouldSkip(rel, extraDirs, extraFiles, isDirectory)) continue

      if (isDirectory) walk(abs)
      else out.push(rel)
    }
  }

  walk(root)
  return out.sort()
}

/** Copy the shippable file set into `outDir`, which is recreated empty. */
export function packDir(root, outDir, options = {}) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const files = collectFiles(root, options)
  for (const rel of files) {
    const dest = join(outDir, rel)
    mkdirSync(join(dest, '..'), { recursive: true })
    cpSync(join(root, rel), dest)
  }
  return files
}

/**
 * Zip the shippable file set. Uses `zip -X` for a reproducible archive: no
 * extra file attributes, entries added in sorted order.
 */
export function packZip(root, outZip, options = {}) {
  // zip runs with cwd set to the staging directory, so the output path must be
  // absolute or it lands inside the staging tree (and its parent may not exist).
  const absZip = resolve(root, outZip)
  const stagingDir = `${absZip}.staging`

  const files = packDir(root, stagingDir, options)

  mkdirSync(dirname(absZip), { recursive: true })
  rmSync(absZip, { force: true })
  try {
    execFileSync('zip', ['-X', '-q', '-r', absZip, '.'], { cwd: stagingDir, stdio: 'pipe' })
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw new Error(`zip failed: ${error.stdout?.toString().trim() || error.message}`)
  }
  rmSync(stagingDir, { recursive: true, force: true })

  return files
}

function readManifestVersion(root) {
  return JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version
}

// pathToFileURL, not string interpolation: a repo path containing spaces or
// & percent-encodes in import.meta.url and would never match, silently
// skipping the CLI block - which for a safety gate means passing by doing
// nothing.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2)
  const root = process.cwd()
  const dirIdx = args.indexOf('--dir')
  const zipIdx = args.indexOf('--zip')

  /** Anything left out for its type is said out loud, never dropped quietly. */
  const reportSkipped = () => {
    const unique = [...new Set(skippedByType)].sort()
    if (unique.length) {
      console.log(`left out, not a shippable file type: ${unique.join(', ')}`)
    }
  }

  if (dirIdx >= 0) {
    const files = packDir(root, args[dirIdx + 1])
    console.log(`packed ${files.length} files -> ${args[dirIdx + 1]}`)
    reportSkipped()
  } else if (zipIdx >= 0) {
    const files = packZip(root, args[zipIdx + 1])
    console.log(`packed ${files.length} files (v${readManifestVersion(root)}) -> ${args[zipIdx + 1]}`)
    reportSkipped()
  } else {
    console.log(collectFiles(root).join('\n'))
  }
}
