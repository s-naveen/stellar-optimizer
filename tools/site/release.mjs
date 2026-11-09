#!/usr/bin/env node
// Releases of Stellar Optimizer. The changelog (libs/gi/ui/src/changelog/changelog.json, newest
// first) is the one source: the app shows it (home page, footer version), CHANGELOG.md and the
// GitHub release notes are made from it. Every deploy is a release. Notes list only what users
// notice in the app (no SEO, deploy or tooling work): a deploy with nothing of that kind is a
// release without notes, which the app and CHANGELOG.md leave out (GitHub calls it maintenance).
//
//   node tools/site/release.mjs draft            next release from the commits since the last tag
//                                                 (feat → minor, fix/perf → patch, `!:` → major);
//                                                 prints JSON to edit into plain language, dropping
//                                                 every line users would not notice
//   node tools/site/release.mjs add <entry.json>  puts it first in the changelog, sets package.json's
//                                                 version, rewrites CHANGELOG.md
//   node tools/site/release.mjs notes [version]   the release's notes as Markdown
//   node tools/site/release.mjs publish          tags HEAD v<latest>, pushes the tag and creates the
//                                                 GitHub release (run once the deploy is live)
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CHANGELOG = resolve(ROOT, 'libs/gi/ui/src/changelog/changelog.json')
const CHANGELOG_MD = resolve(ROOT, 'CHANGELOG.md')
const PACKAGE = resolve(ROOT, 'package.json')
const REPO = 's-naveen/stellar-optimizer'
const GROUPS = [
  ['new', 'New'],
  ['improved', 'Improved'],
  ['fixed', 'Fixed'],
]

const run = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const releases = () => readJson(CHANGELOG)
const today = () => new Date().toISOString().slice(0, 10)

function lastTag() {
  try {
    return run('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'])
  } catch {
    return undefined
  }
}

function bump(version, level) {
  const [major, minor, patch] = version.split('.').map(Number)
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** A commit subject as a changelog line: no type/scope prefix, a capital, a full stop */
function line(subject) {
  const text = subject.replace(/^\w+(\([^)]*\))?!?:\s*/, '').trim()
  const capital = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

function draft() {
  const tag = lastTag()
  const latest = releases()[0]
  // nothing tagged yet: the changelog's newest release is the first one to publish
  if (!tag && latest) {
    console.error(
      `No release tag yet: v${latest.version} (already in the changelog) is the one to publish.`
    )
    process.exit(1)
  }
  const range = tag ? [`${tag}..HEAD`] : []
  const subjects = run('git', ['log', '--format=%s', ...range])
    .split('\n')
    .filter(Boolean)
    .filter((s) => !/^chore\(release\)/.test(s))
  const entry = { version: '', date: today(), new: [], improved: [], fixed: [] }
  let level = 'patch'
  for (const subject of subjects) {
    const type = subject.match(/^(\w+)/)?.[1]
    if (/^\w+(\([^)]*\))?!:/.test(subject)) level = 'major'
    else if (type === 'feat' && level !== 'major') level = 'minor'
    if (type === 'feat') entry.new.push(line(subject))
    else if (type === 'perf') entry.improved.push(line(subject))
    else if (type === 'fix') entry.fixed.push(line(subject))
  }
  entry.version = bump(tag ? tag.slice(1) : '0.0.0', level)
  for (const [key] of GROUPS) if (!entry[key].length) delete entry[key]
  console.log(JSON.stringify(entry, null, 2))
}

const hasNotes = (release) => GROUPS.some(([key]) => release[key]?.length)

function markdown(release, heading = '##') {
  const lines = [
    `${heading} [v${release.version}](https://github.com/${REPO}/releases/tag/v${release.version}) (${release.date})`,
    '',
  ]
  if (release.title) lines.push(`_${release.title}_`, '')
  if (!hasNotes(release))
    lines.push(
      'Maintenance release: no changes you would notice in the app.',
      ''
    )
  for (const [key, label] of GROUPS) {
    if (!release[key]?.length) continue
    lines.push(`### ${label}`, '', ...release[key].map((s) => `- ${s}`), '')
  }
  return lines.join('\n')
}

function writeChangelogMd(all) {
  const intro = [
    '# Changelog',
    '',
    'Every release of [Stellar Optimizer](https://gi-beta73.github.io/). The app shows the same notes',
    '(home page, and the version in the footer). Generated from',
    '`libs/gi/ui/src/changelog/changelog.json` by `tools/site/release.mjs`: edit that file, not this one.',
    '',
  ]
  writeFileSync(
    CHANGELOG_MD,
    `${[...intro, ...all.filter(hasNotes).map((r) => markdown(r))].join('\n').trimEnd()}\n`
  )
}

function add(file) {
  const entry = readJson(resolve(file))
  if (!/^\d+\.\d+\.\d+$/.test(entry.version ?? ''))
    throw new Error(`bad version: ${entry.version}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? ''))
    throw new Error(`bad date: ${entry.date}`)
  if (!hasNotes(entry))
    console.log(
      'no notes: a maintenance release (left out of the app and CHANGELOG.md)'
    )
  const all = releases().filter((r) => r.version !== entry.version)
  all.unshift(entry)
  writeFileSync(CHANGELOG, `${JSON.stringify(all, null, 2)}\n`)
  const pkg = readFileSync(PACKAGE, 'utf8')
  writeFileSync(
    PACKAGE,
    pkg.replace(/"version": "[^"]+"/, `"version": "${entry.version}"`)
  )
  writeChangelogMd(all)
  console.log(
    `v${entry.version} added: changelog, package.json and CHANGELOG.md`
  )
}

function notes(version) {
  const release = version
    ? releases().find((r) => r.version === version.replace(/^v/, ''))
    : releases()[0]
  if (!release) throw new Error(`no release ${version}`)
  // the GitHub release has its own title: start at the notes
  console.log(markdown(release).split('\n').slice(2).join('\n').trim())
}

function publish() {
  const release = releases()[0]
  const tag = `v${release.version}`
  const pkgVersion = readJson(PACKAGE).version
  if (pkgVersion !== release.version)
    throw new Error(
      `package.json says ${pkgVersion}, the changelog ${release.version}`
    )
  if (run('git', ['status', '--porcelain', '--untracked-files=no']))
    throw new Error('commit the release first: the working tree has changes')
  const exists = run('git', ['tag', '--list', tag])
  if (!exists) run('git', ['tag', '-a', tag, '-m', `Stellar Optimizer ${tag}`])
  run('git', ['push', '-q', 'origin', tag])
  const body = markdown(release).split('\n').slice(2).join('\n').trim()
  let released = false
  try {
    run('gh', ['release', 'view', tag, '-R', REPO])
    released = true
  } catch {}
  if (released) run('gh', ['release', 'edit', tag, '-R', REPO, '--notes', body])
  else
    run('gh', [
      'release',
      'create',
      tag,
      '-R',
      REPO,
      '--title',
      `Stellar Optimizer ${tag}`,
      '--notes',
      body,
      '--latest',
    ])
  console.log(
    `${released ? 'updated' : 'published'} https://github.com/${REPO}/releases/tag/${tag}`
  )
}

const [command, arg] = process.argv.slice(2)
if (command === 'draft') draft()
else if (command === 'add') add(arg)
else if (command === 'notes') notes(arg)
else if (command === 'publish') publish()
else if (command === 'changelog-md') writeChangelogMd(releases())
else {
  console.error(
    'usage: release.mjs draft | add <entry.json> | notes [version] | publish | changelog-md'
  )
  process.exit(1)
}
