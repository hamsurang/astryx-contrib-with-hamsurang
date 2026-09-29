import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './config.js'

function fixture(config: string, members: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cbs-'))
  writeFileSync(join(dir, 'config.yml'), config)
  writeFileSync(join(dir, 'members.yml'), members)
  return dir
}

const VALID_CONFIG = `
upstream: facebook/astryx
forkRepoName: astryx
notion:
  properties: { status: 상태, prUrl: PR 링크, syncKey: 동기화 키, date: 날짜 }
  status:
    teamReview: In Team-Review
    maintainerReview: In Maintainer-Review
    merged: Merged
    closed: Closed
titleFormat: "[{name}] {title}"
`

describe('loadConfig', () => {
  it('두 파일을 읽어 하나의 Config 로 합친다', () => {
    const dir = fixture(VALID_CONFIG, 'members:\n  - login: Kyujenius\n')
    const config = loadConfig(dir)
    expect(config.upstream).toBe('facebook/astryx')
    expect(config.notion.properties.syncKey).toBe('동기화 키')
    expect(config.members).toEqual([{ login: 'Kyujenius' }])
  })

  it('members 에 name 을 적으면 유지한다', () => {
    const dir = fixture(VALID_CONFIG, 'members:\n  - login: Kyujenius\n    name: 홍규진\n')
    expect(loadConfig(dir).members[0]).toEqual({ login: 'Kyujenius', name: '홍규진' })
  })

  it('members 의 notionUserId 와 properties.assignee 는 선택이다', () => {
    const withAssignee = VALID_CONFIG.replace('date: 날짜 }', 'date: 날짜, assignee: 담당자 }')
    const dir = fixture(withAssignee, 'members:\n  - login: Kyujenius\n    notionUserId: u-1\n')
    const config = loadConfig(dir)
    expect(config.notion.properties.assignee).toBe('담당자')
    expect(config.members[0]).toEqual({ login: 'Kyujenius', notionUserId: 'u-1' })
    expect(loadConfig(fixture(VALID_CONFIG, 'members:\n  - login: Kyujenius\n')).notion.properties).not.toHaveProperty('assignee')
  })

  it('빠진 키의 이름을 그대로 말하며 실패한다', () => {
    const missing = VALID_CONFIG.replace('forkRepoName: astryx\n', '')
    const dir = fixture(missing, 'members:\n  - login: Kyujenius\n')
    expect(() => loadConfig(dir)).toThrow(/forkRepoName/)
  })

  it('중첩된 키가 빠져도 경로를 말한다', () => {
    const missing = VALID_CONFIG.replace('    merged: Merged\n', '')
    const dir = fixture(missing, 'members:\n  - login: Kyujenius\n')
    expect(() => loadConfig(dir)).toThrow(/notion\.status\.merged/)
  })

  it('멤버가 하나도 없으면 실패한다', () => {
    const dir = fixture(VALID_CONFIG, 'members: []\n')
    expect(() => loadConfig(dir)).toThrow(/멤버가 비어 있다/)
  })
})
