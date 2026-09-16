#!/usr/bin/env node
/**
 * Lint gate for code that predates the lint rules.
 *
 * Adopting eslint on an existing extension usually means a choice between
 * turning real rules off and blocking every build until a backlog is cleared.
 * This takes the third option: a committed baseline of the errors that exist
 * today. The build fails if any file's error count goes UP, or if a clean file
 * becomes dirty. Fixing errors is always allowed, and the baseline is rewritten
 * downward so they can never come back.
 *
 * A project with no pre-existing errors gets an empty baseline, which makes the
 * gate strict - that is the normal case, and the intended destination for all
 * of them.
 *
 *   node lint-ratchet.mjs            check against .eslint-baseline.json
 *   node lint-ratchet.mjs --update   rewrite the baseline (review the diff!)
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { relative } from 'node:path'

const BASELINE = '.eslint-baseline.json'
const update = process.argv.includes('--update')
const root = process.cwd()

function runEslint() {
  try {
    return execFileSync('npx', ['eslint', '.', '--format', 'json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
  } catch (error) {
    // eslint exits non-zero whenever there are errors; the JSON is still on stdout.
    if (error.stdout) return error.stdout
    throw error
  }
}

const results = JSON.parse(runEslint())

const counts = {}
const detail = {}
for (const file of results) {
  if (!file.errorCount) continue
  const key = relative(root, file.filePath).split('\\').join('/')
  counts[key] = file.errorCount
  detail[key] = file.messages
    .filter(m => m.severity === 2)
    .map(m => `${m.line}:${m.column} ${m.message} (${m.ruleId})`)
}

const totalErrors = Object.values(counts).reduce((a, b) => a + b, 0)
const totalWarnings = results.reduce((a, f) => a + f.warningCount, 0)

if (update) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`)
  console.log(`baseline written: ${totalErrors} error(s) across ${Object.keys(counts).length} file(s)`)
  process.exit(0)
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}

const regressions = []
const improvements = []

for (const [file, count] of Object.entries(counts)) {
  const allowed = baseline[file] ?? 0
  if (count > allowed) regressions.push({ file, count, allowed })
}
for (const [file, allowed] of Object.entries(baseline)) {
  const count = counts[file] ?? 0
  if (count < allowed) improvements.push({ file, count, allowed })
}

if (regressions.length > 0) {
  console.error('\nLint regression - these files have more errors than the baseline allows:\n')
  for (const { file, count, allowed } of regressions) {
    console.error(`  ${file}: ${count} error(s), baseline allows ${allowed}`)
    for (const line of detail[file] ?? []) console.error(`      ${line}`)
  }
  console.error('\nFix the new errors. Do not run --update to paper over them.\n')
  process.exit(1)
}

if (improvements.length > 0) {
  console.log('\nErrors fixed since the baseline was taken:')
  for (const { file, count, allowed } of improvements) {
    console.log(`  ${file}: ${allowed} -> ${count}`)
  }
  console.log('\nRun `npm run lint:update` to lock the improvement in.\n')
}

console.log(
  `lint ok - ${totalErrors} baselined error(s), ${totalWarnings} warning(s), no regressions`
)
