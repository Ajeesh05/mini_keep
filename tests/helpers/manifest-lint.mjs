#!/usr/bin/env node
/**
 * Manifest V3 validator.
 *
 * Beyond schema checks, this enforces two rules that came directly out of real
 * bugs found in this fleet, because both are invisible until a user hits them:
 *
 *   - An API is used in the code but its permission is not declared. The call
 *     then fails at runtime, usually inside a try/catch, so the feature just
 *     quietly does nothing.
 *   - An API is used that needs a newer Chrome than minimum_chrome_version
 *     admits. Users on older Chrome install successfully and hit an undefined
 *     object.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Chrome version each API first shipped in. */
const API_MIN_CHROME = {
  sidePanel: 114,
  offscreen: 109,
  userScripts: 120,
  tabGroups: 89,
  declarativeNetRequest: 84,
  scripting: 88,
  action: 88,
  runtime: 0,
  storage: 0,
  tabs: 0,
  cookies: 0,
  windows: 0,
  commands: 0,
  contextMenus: 0,
  downloads: 0,
  alarms: 0,
  system: 0
}

/** chrome.<ns> namespaces that require a permission of the same name. */
const PERMISSION_APIS = [
  'sidePanel',
  'scripting',
  'cookies',
  'tabGroups',
  'downloads',
  'contextMenus',
  'alarms',
  'declarativeNetRequest',
  'offscreen',
  'notifications',
  'webRequest',
  'bookmarks',
  'history',
  'topSites',
  'idle',
  'power'
]

const problems = []
const err = (rule, message) => problems.push({ level: 'error', rule, message })
const warn = (rule, message) => problems.push({ level: 'warning', rule, message })

function sourceFiles(root) {
  const out = []
  const skip = new Set(['node_modules', '.git', 'tests', 'dist', 'coverage', 'docs', '.github'])
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue
      const abs = join(dir, entry)
      if (statSync(abs).isDirectory()) walk(abs)
      else if (entry.endsWith('.js')) out.push(abs)
    }
  }
  walk(root)
  return out
}

/** Every chrome.<namespace> referenced anywhere in the extension's own code. */
function usedNamespaces(root) {
  const used = new Map()
  for (const file of sourceFiles(root)) {
    const src = readFileSync(file, 'utf8')
    for (const match of src.matchAll(/\bchrome\.([a-zA-Z]+)\b/g)) {
      const ns = match[1]
      if (!used.has(ns)) used.set(ns, relative(root, file))
    }
  }
  return used
}

/**
 * Files that read a tab field only granted by the "tabs" permission.
 *
 * chrome.tabs works without that permission - which is why it is not in
 * PERMISSION_APIS - but url, title, pendingUrl and favIconUrl come back
 * undefined instead of throwing. Code that reads them keeps running and
 * quietly does nothing, which is far harder to notice than a failed call.
 *
 * @param {string} root
 *
 * @returns {string[]} repo-relative paths
 */
function filesReadingTabUrl(root) {
  const reads = /\b(?:tab|tabs\[\d+\]|activeTab)\s*(?:\?\.|\.)\s*(?:url|title|pendingUrl|favIconUrl)\b/
  const files = []

  for (const file of sourceFiles(root)) {
    const src = readFileSync(file, 'utf8')
    if (/\bchrome\.tabs\b/.test(src) && reads.test(src)) files.push(relative(root, file))
  }

  return files
}

/** Declared paths that must exist on disk. */
function declaredPaths(manifest) {
  const paths = []
  const add = (value, where) => value && paths.push({ path: value, where })

  add(manifest.background?.service_worker, 'background.service_worker')
  add(manifest.side_panel?.default_path, 'side_panel.default_path')
  add(manifest.action?.default_popup, 'action.default_popup')
  add(manifest.options_page, 'options_page')

  for (const [size, file] of Object.entries(manifest.icons ?? {})) add(file, `icons.${size}`)
  for (const [size, file] of Object.entries(manifest.action?.default_icon ?? {})) {
    add(file, `action.default_icon.${size}`)
  }
  for (const [i, cs] of (manifest.content_scripts ?? []).entries()) {
    for (const js of cs.js ?? []) add(js, `content_scripts[${i}].js`)
    for (const css of cs.css ?? []) add(css, `content_scripts[${i}].css`)
  }
  for (const [i, war] of (manifest.web_accessible_resources ?? []).entries()) {
    for (const res of war.resources ?? []) {
      if (!res.includes('*')) add(res, `web_accessible_resources[${i}].resources`)
    }
  }
  return paths
}

export function lintManifest(root) {
  problems.length = 0
  const manifestPath = join(root, 'manifest.json')

  if (!existsSync(manifestPath)) {
    err('manifest-exists', 'manifest.json not found')
    return problems
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    err('manifest-json', `manifest.json is not valid JSON: ${error.message}`)
    return problems
  }

  if (manifest.manifest_version !== 3) {
    err('mv3', `manifest_version must be 3, found ${manifest.manifest_version}`)
  }
  for (const field of ['name', 'version', 'description']) {
    if (!manifest[field]) err('required-field', `${field} is required`)
  }

  // Chrome accepts 1-4 dot-separated integers, 0-65535, no leading zeros, and
  // no prerelease suffix - so semver's "1.2.3-beta" is not a legal version.
  const version = String(manifest.version ?? '')
  const parts = version.split('.')
  if (!/^\d+(\.\d+){0,3}$/.test(version)) {
    err('version-format', `version "${version}" must be 1-4 dot-separated integers (no suffixes)`)
  } else if (parts.some(p => Number(p) > 65535)) {
    err('version-format', `version "${version}" has a component above 65535`)
  } else if (parts.some(p => p.length > 1 && p.startsWith('0'))) {
    err('version-format', `version "${version}" has a component with a leading zero`)
  }

  for (const { path, where } of declaredPaths(manifest)) {
    if (!existsSync(join(root, path))) {
      err('missing-file', `${where} points at "${path}", which does not exist`)
    }
  }

  const permissions = new Set(manifest.permissions ?? [])
  const used = usedNamespaces(root)
  const minChrome = Number(manifest.minimum_chrome_version ?? 0)

  // "tabs" is deliberately absent from PERMISSION_APIS: chrome.tabs is callable
  // without it. What it withholds are the tab fields below, which arrive as
  // undefined - so the call appears to succeed and the feature silently stops.
  if (used.has('tabs') && !permissions.has('tabs')) {
    const readers = filesReadingTabUrl(root)
    for (const file of readers) {
      err(
        'undeclared-tabs-permission',
        `${file} reads a tab's url/title, but "tabs" is not in permissions - ` +
        'those fields will be undefined at runtime, with no error'
      )
    }
    if (readers.length === 0) {
      warn(
        'undeclared-tabs-permission',
        `${used.get('tabs')} uses chrome.tabs without the "tabs" permission - ` +
        'fine unless it starts reading tab.url or tab.title'
      )
    }
  }

  for (const [ns, file] of used) {
    if (PERMISSION_APIS.includes(ns) && !permissions.has(ns)) {
      err(
        'undeclared-permission',
        `${file} uses chrome.${ns}, but "${ns}" is not in permissions - the call will fail at runtime`
      )
    }

    const required = API_MIN_CHROME[ns]
    if (required && minChrome && minChrome < required) {
      err(
        'minimum-chrome-version',
        `${file} uses chrome.${ns}, which needs Chrome ${required}, ` +
          `but minimum_chrome_version is ${minChrome}`
      )
    }
  }

  for (const permission of permissions) {
    if (PERMISSION_APIS.includes(permission) && !used.has(permission)) {
      warn('unused-permission', `"${permission}" is requested but chrome.${permission} is never used`)
    }
  }

  for (const [i, war] of (manifest.web_accessible_resources ?? []).entries()) {
    if ((war.matches ?? []).includes('<all_urls>')) {
      warn(
        'broad-war-match',
        `web_accessible_resources[${i}] is exposed to <all_urls>; scope it to the origins that need it`
      )
    }
  }

  if (manifest.side_panel && !permissions.has('sidePanel')) {
    err('side-panel-permission', 'side_panel is declared but the sidePanel permission is missing')
  }

  return problems
}

// pathToFileURL, not string interpolation: a repo path containing spaces or
// & percent-encodes in import.meta.url and would never match, silently
// skipping the CLI block - which for a safety gate means passing by doing
// nothing.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2)
  const update = args.includes('--update')
  const root = args.find(a => !a.startsWith('--')) ?? process.cwd()
  const baselinePath = join(root, '.manifest-baseline.json')

  const found = lintManifest(root)
  const key = p => `${p.rule}|${p.message}`
  const errors = found.filter(p => p.level === 'error')

  if (update) {
    writeFileSync(baselinePath, `${JSON.stringify(errors.map(key).sort(), null, 2)}\n`)
    console.log(`manifest baseline written: ${errors.length} accepted error(s)`)
    process.exit(0)
  }

  // Same ratchet as the lint gate: pre-existing problems stay visible and
  // cannot grow, but they do not block every build forever. Anything new is
  // fatal.
  const baseline = new Set(existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : [])
  const fresh = errors.filter(p => !baseline.has(key(p)))
  const known = errors.filter(p => baseline.has(key(p)))
  const warnings = found.filter(p => p.level === 'warning')

  for (const p of fresh) console.error(`  error       ${p.message}  (${p.rule})`)
  for (const p of known) console.log(`  baselined   ${p.message}  (${p.rule})`)
  for (const p of warnings) console.log(`  warning     ${p.message}  (${p.rule})`)

  const fixed = [...baseline].filter(k => !errors.map(key).includes(k))
  if (fixed.length) {
    console.log(`\n${fixed.length} baselined manifest error(s) fixed. Run with --update to lock it in.`)
  }

  if (fresh.length) {
    console.error(`\nmanifest: ${fresh.length} new error(s). Fix them; do not run --update to hide them.`)
    process.exit(1)
  }

  console.log(
    `manifest ok - ${known.length} baselined error(s), ${warnings.length} warning(s), nothing new`
  )
}
