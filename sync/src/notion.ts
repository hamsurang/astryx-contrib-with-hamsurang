import type { Action, Card, Config } from './types.js'

const API = 'https://api.notion.com/v1'
const VERSION = '2022-06-28'

type StatusKind = 'status' | 'select'

type PropertySchema = {
  type: string
  status?: { options: { name: string }[] }
  select?: { options: { name: string }[] }
}

export class NotionClient {
  private statusKind: StatusKind = 'status'
  private titleProp = 'Name'

  constructor(
    private readonly token: string,
    private readonly databaseId: string,
    private readonly config: Config,
  ) {}

  private async call(path: string, init: RequestInit, attempt = 0): Promise<any> {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? 1)
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000 * 2 ** attempt))
      return this.call(path, init, attempt + 1)
    }

    if (!response.ok) {
      throw new Error(`Notion ${init.method} ${path} ${response.status}: ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * 첫 쓰기 전에 DB 스키마를 검증한다. config.yml 의 오타를 400 이나 조용한 무시가
   * 아니라 사람이 읽을 수 있는 메시지로 잡는 게 목적이다.
   */
  async verifySchema(): Promise<void> {
    const db = await this.call(`/databases/${this.databaseId}`, { method: 'GET' })
    const props = db.properties as Record<string, PropertySchema>
    const names = this.config.notion.properties

    for (const [role, name] of Object.entries(names)) {
      if (name === undefined) continue
      if (!props[name]) {
        throw new Error(`Notion DB 에 '${name}' 속성이 없다 (config.yml 의 notion.properties.${role})`)
      }
    }

    const titleEntry = Object.entries(props).find(([, prop]) => prop.type === 'title')
    if (!titleEntry) throw new Error('Notion DB 에 title 속성이 없다')
    this.titleProp = titleEntry[0]

    const statusProp = props[names.status]!
    if (statusProp.type !== 'status' && statusProp.type !== 'select') {
      throw new Error(`'${names.status}' 속성이 status 나 select 가 아니라 ${statusProp.type} 이다`)
    }
    this.statusKind = statusProp.type

    const options = (statusProp.status ?? statusProp.select)?.options.map((o) => o.name) ?? []
    for (const [role, value] of Object.entries(this.config.notion.status)) {
      if (!options.includes(value)) {
        throw new Error(
          `'${names.status}' 속성에 '${value}' 선택지가 없다 (config.yml 의 notion.status.${role}). 있는 선택지: ${options.join(', ')}`,
        )
      }
    }

    if (props[names.syncKey]!.type !== 'rich_text') {
      throw new Error(`'${names.syncKey}' 속성은 rich_text 여야 한다 (지금은 ${props[names.syncKey]!.type})`)
    }
    if (props[names.prUrl]!.type !== 'url') {
      throw new Error(`'${names.prUrl}' 속성은 url 이어야 한다 (지금은 ${props[names.prUrl]!.type})`)
    }
    if (names.assignee && props[names.assignee]!.type !== 'people') {
      throw new Error(`'${names.assignee}' 속성은 people 이어야 한다 (지금은 ${props[names.assignee]!.type})`)
    }
  }

  async fetchCards(): Promise<Card[]> {
    const names = this.config.notion.properties
    const cards: Card[] = []
    let cursor: string | undefined

    do {
      const page = await this.call(`/databases/${this.databaseId}/query`, {
        method: 'POST',
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
      })

      for (const result of page.results) {
        const props = result.properties ?? {}
        const statusProp = props[names.status]
        const keyText: string =
          props[names.syncKey]?.rich_text?.map((t: { plain_text: string }) => t.plain_text).join('') ?? ''

        cards.push({
          pageId: result.id,
          key: keyText.trim() === '' ? null : keyText.trim(),
          status: (statusProp?.status ?? statusProp?.select)?.name ?? null,
          prUrl: props[names.prUrl]?.url ?? null,
        })
      }

      cursor = page.has_more ? page.next_cursor : undefined
    } while (cursor)

    return cards
  }

  private statusValue(name: string) {
    return this.statusKind === 'status' ? { status: { name } } : { select: { name } }
  }

  async apply(action: Action): Promise<void> {
    const names = this.config.notion.properties

    if (action.kind === 'create') {
      await this.call('/pages', {
        method: 'POST',
        body: JSON.stringify({
          parent: { database_id: this.databaseId },
          properties: {
            [this.titleProp]: { title: [{ text: { content: action.title } }] },
            [names.status]: this.statusValue(action.status),
            [names.prUrl]: { url: action.prUrl },
            [names.syncKey]: { rich_text: [{ text: { content: action.key } }] },
            [names.date]: { date: { start: action.date } },
            ...(names.assignee && action.assigneeIds
              ? { [names.assignee]: { people: action.assigneeIds.map((id) => ({ id })) } }
              : {}),
          },
        }),
      })
      return
    }

    const properties: Record<string, unknown> = {}
    if (action.status !== undefined) properties[names.status] = this.statusValue(action.status)
    if (action.prUrl !== undefined) properties[names.prUrl] = { url: action.prUrl }

    await this.call(`/pages/${action.pageId}`, { method: 'PATCH', body: JSON.stringify({ properties }) })
  }

  /** 백필 전용. 카드 본문의 북마크·임베드 URL 을 긁는다. */
  async fetchBlockUrls(pageId: string): Promise<string[]> {
    const page = await this.call(`/blocks/${pageId}/children?page_size=100`, { method: 'GET' })
    const urls: string[] = []
    for (const block of page.results) {
      const url = block.bookmark?.url ?? block.embed?.url ?? block.link_preview?.url
      if (typeof url === 'string') urls.push(url)
    }
    return urls
  }

  /** 백필 전용. PR 링크와 동기화 키만 채운다. */
  async writeBackfill(pageId: string, prUrl: string, key: string): Promise<void> {
    const names = this.config.notion.properties
    await this.call(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          [names.prUrl]: { url: prUrl },
          [names.syncKey]: { rich_text: [{ text: { content: key } }] },
        },
      }),
    })
  }
}
