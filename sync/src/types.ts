export type PrState = 'OPEN' | 'CLOSED' | 'MERGED'

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | null

export type Member = { login: string; name?: string; notionUserId?: string }

export type Config = {
  upstream: string
  forkRepoName: string
  notion: {
    properties: { status: string; prUrl: string; syncKey: string; date: string; assignee?: string }
    status: { teamReview: string; maintainerReview: string; merged: string; closed: string }
    icons?: { approved: string; changesRequested: string; pending: string }
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
  reviewDecision: ReviewDecision
  createdAt: string
}

export type Card = {
  pageId: string
  key: string | null
  status: string | null
  prUrl: string | null
  icon: string | null
}

export type Action =
  | {
      kind: 'create'
      key: string
      title: string
      status: string
      prUrl: string
      date: string
      assigneeIds?: string[]
      icon?: string
    }
  | { kind: 'update'; pageId: string; key: string; status?: string; prUrl?: string; icon?: string }

export type PlanResult = { actions: Action[]; warnings: string[] }
