import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { Config, Member } from './types.js'

function must<T>(value: T | undefined | null, key: string): T {
  if (value === undefined || value === null) throw new Error(`config.yml 에 ${key} 가 없다`)
  return value
}

export function loadConfig(dir: string, membersDir = dir): Config {
  const raw = parse(readFileSync(join(dir, 'config.yml'), 'utf8')) ?? {}
  const membersRaw = parse(readFileSync(join(membersDir, 'members.yml'), 'utf8')) ?? {}

  const props = must(raw.notion?.properties, 'notion.properties')
  const status = must(raw.notion?.status, 'notion.status')
  const members: Member[] = membersRaw.members ?? []

  if (members.length === 0) throw new Error('members.yml 의 멤버가 비어 있다')

  return {
    upstream: must(raw.upstream, 'upstream'),
    forkRepoName: must(raw.forkRepoName, 'forkRepoName'),
    notion: {
      properties: {
        status: must(props.status, 'notion.properties.status'),
        prUrl: must(props.prUrl, 'notion.properties.prUrl'),
        syncKey: must(props.syncKey, 'notion.properties.syncKey'),
        date: must(props.date, 'notion.properties.date'),
        ...(props.assignee ? { assignee: props.assignee } : {}),
      },
      status: {
        teamReview: must(status.teamReview, 'notion.status.teamReview'),
        maintainerReview: must(status.maintainerReview, 'notion.status.maintainerReview'),
        merged: must(status.merged, 'notion.status.merged'),
        closed: must(status.closed, 'notion.status.closed'),
      },
    },
    titleFormat: must(raw.titleFormat, 'titleFormat'),
    members,
  }
}
