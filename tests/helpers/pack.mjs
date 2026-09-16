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

function shouldSkip(relPath, extraDirs, extraFiles) {
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
  return false
}

/** Every shippable file, as paths relative to `root`. */
export function collectFiles(root, { extraDirs = [], extraFiles = [] } = {}) {
  const out = []

  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry)
      const rel = relative(root, abs)
      if (shouldSkip(rel, extraDirs, extraFiles)) continue

      if (statSync(abs).isDirectory()) walk(abs)
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

  if (dirIdx >= 0) {
    const files = packDir(root, args[dirIdx + 1])
    console.log(`packed ${files.length} files -> ${args[dirIdx + 1]}`)
  } else if (zipIdx >= 0) {
    const files = packZip(root, args[zipIdx + 1])
    console.log(`packed ${files.length} files (v${readManifestVersion(root)}) -> ${args[zipIdx + 1]}`)
  } else {
    console.log(collectFiles(root).join('\n'))
  }
}
