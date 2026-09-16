#!/usr/bin/env node
/**
 * The permission safety gate.
 *
 * Compares what the manifest asks for against the baseline recorded in
 * project.yml, and fails on any growth. A permission increase changes what the
 * extension can reach on a user's machine and can change store review, so it
 * must never ride along inside an ordinary change.
 *
 * This is deliberately mechanical rather than a rule the agent is asked to
 * follow: an agent that forgets ships a scope increase, a diff cannot forget.
 *
 * Widening the baseline is a reviewed edit to project.yml, visible in the PR.
 *
 * Chrome extensions: permissions + host_permissions from manifest.json.
 * Workspace add-ons: oauthScopes from appsscript.json (same gate, same rules).
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { pathToFileURL } from 'node:url'

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

export function diffPermissions(root) {
  const configPath = join(root, 'project.yml')
  if (!existsSync(configPath)) {
    return { ok: false, fatal: 'project.yml not found - the permission gate cannot run' }
  }

  const config = parse(readFileSync(configPath, 'utf8'))
  const baseline = config?.permissions?.baseline ?? []
  const hostBaseline = config?.permissions?.host_baseline ?? []

  let current = []
  let currentHosts = []
  let kind

  if (existsSync(join(root, 'manifest.json'))) {
    const manifest = readJson(join(root, 'manifest.json'))
    current = manifest.permissions ?? []
    currentHosts = manifest.host_permissions ?? []
    kind = 'chrome-extension'
  } else if (existsSync(join(root, 'appsscript.json'))) {
    current = readJson(join(root, 'appsscript.json')).oauthScopes ?? []
    kind = 'google-workspace-addon'
  } else {
    return { ok: false, fatal: 'neither manifest.json nor appsscript.json found' }
  }

  const grew = (now, was) => now.filter(p => !was.includes(p))
  const shrank = (now, was) => was.filter(p => !now.includes(p))

  return {
    ok: grew(current, baseline).length === 0 && grew(currentHosts, hostBaseline).length === 0,
    kind,
    added: grew(current, baseline),
    removed: shrank(current, baseline),
    hostsAdded: grew(currentHosts, hostBaseline),
    hostsRemoved: shrank(currentHosts, hostBaseline),
    baseline,
    hostBaseline,
    current,
    currentHosts
  }
}

// pathToFileURL, not string interpolation: a repo path containing spaces or
// & percent-encodes in import.meta.url and would never match, silently
// skipping the CLI block - which for a safety gate means passing by doing
// nothing.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = diffPermissions(process.argv[2] ?? process.cwd())

  if (result.fatal) {
    console.error(`permission gate: ${result.fatal}`)
    process.exit(1)
  }

  const { added, removed, hostsAdded, hostsRemoved } = result

  if (added.length || hostsAdded.length) {
    console.error('\nPERMISSION CHANGE - this pull request requests more access than the baseline allows\n')
    if (added.length) {
      console.error('  New permissions:')
      for (const p of added) console.error(`    + ${p}`)
    }
    if (hostsAdded.length) {
      console.error('  New host permissions:')
      for (const p of hostsAdded) console.error(`    + ${p}`)
    }
    console.error('\n  Current baseline:')
    for (const p of result.baseline) console.error(`    ${p}`)
    for (const p of result.hostBaseline) console.error(`    ${p}  (host)`)
    console.error(
      '\n  This may affect user privacy and store review.\n' +
        '  To allow it: comment /approve-permissions on the issue, which updates\n' +
        '  permissions.baseline in project.yml as a reviewed change.\n'
    )
    process.exit(1)
  }

  if (removed.length || hostsRemoved.length) {
    console.log('Permissions reduced since the baseline was set:')
    for (const p of [...removed, ...hostsRemoved]) console.log(`  - ${p}`)
    console.log('Update permissions.baseline in project.yml to lock the reduction in.\n')
  }

  console.log(
    `permission gate ok - ${result.current.length} permission(s), ` +
      `${result.currentHosts.length} host permission(s), no growth`
  )
}
