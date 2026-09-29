export type PrState = 'OPEN' | 'CLOSED' | 'MERGED'

export type Member = { login: string; name?: string; notionUserId?: string }

export type Config = {
  upstream: string
  forkRepoName: string
  notion: {
    properties: { status: string; prUrl: string; syncKey: string; date: string; assignee?: string }
    status: { teamReview: string; maintainerReview: string; merged: string; closed: string }
  }
  titleFormat: string
  members: Member[]
}

export type PullRequest = {
  key: string
  login: string
  displayName: string | null
  title: string
  url: string
  repo: string
  isUpstream: boolean
  state: PrState
  createdAt: string
}

export type Card = {
  pageId: string
  key: string | null
  status: string | null
  prUrl: string | null
}

export type Action =
  | { kind: 'create'; key: string; title: string; status: string; prUrl: string; date: string; assigneeIds?: string[] }
  | { kind: 'update'; pageId: string; key: string; status?: string; prUrl?: string }

export type PlanResult = { actions: Action[]; warnings: string[] }
