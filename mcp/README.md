# mcp — astryx-contrib MCP 서버

`facebook/astryx` 기여에 특화된 stdio MCP 서버. 서버 이름은 `astryx-contrib`, 툴은 13개.
설치는 레포 루트의 `./install.sh` 로 한다 (루트 README 참고).

## 원칙

- **판단은 툴이 하지 않는다.** 이슈 판정, 번역, 리뷰 결론처럼 판단이 필요한 툴은 재료(수집한
  데이터)와 규칙, 그리고 응답 형식을 정한 `instruction` 블록을 돌려준다. 결론은 툴을 부른 모델이 쓴다.
- **GitHub 은 `gh` CLI 로 읽는다.** 토큰을 따로 두지 않는다. `gh auth login` 이 되어 있으면 된다.
- **astryx 체크아웃은 cwd 우선.** cwd 가 체크아웃이면 그 워크트리를 읽고, 아니면 `ASTRYX_REPO`.
  둘 다 아니면 GitHub 만 읽는 툴만 살고 나머지는 에러를 낸다.
- **Playwright 와 vitest 는 체크아웃의 것을 빌려 쓴다.** 이 패키지는 브라우저를 설치하지 않는다.

## 툴

### 이슈 탐색·선별

**`assess_issue_fit`** `{ issue }` — 이슈 본문·라벨·코멘트·타임라인을 모아 신호 표를 돌려준다.
작성자와 코멘터의 신분은 spec 레코드의 `owners`/`approved_by`(메인테이너), `author_association`,
머지 PR 수로 판정한다. 루트 `members.yml` 의 멤버가 fork 에 올린 열린 PR 본문에 이 이슈 번호가
있으면 "팀원 진행 중"으로 표시한다.

| 신호 | 판정 |
| --- | --- |
| `taken` 다른 사람의 열린 연결 PR 또는 assignee | 피하라 |
| `team-in-progress` 팀원의 fork PR 또는 열린 upstream PR | 피하라 |
| `needs-record-not-code` "until authority settles", `needs-scoping` | 코드가 아니라 레코드 |
| `maintainer-gave-direction` 마지막 메인테이너 코멘트가 방향을 지목 | 최적 |
| `maintainer-filed-bug` 메인테이너가 낸 `bug` | 우선 |
| `unverified-community-report` 신분 없음 + 반응 없음 + repro 없음 | 검증 비용 큼 |
| `closed-sibling` 같은 컴포넌트의 닫힌 이슈 | 종결 사유부터 읽어라 |
| `stale` 30일 이상 조용함 | 관심 낮음 |

**`validate_repro`** — 두 모드. `{ issue }` 는 이슈와 코멘트의 코드 블록(출처·언어)과
Storybook/샌드박스 링크를 뽑는다. `{ code, runner? }` 는 코드를
`packages/core/src/__repro__/repro-<hash>.test.tsx` 로 써서 체크아웃의 `vitest --project ui`
(jsdom + StyleX)로 돌리고 exit code·stdout·stderr 를 돌려준 뒤 파일을 지운다. 기본 60초, 초과 시
kill. `runner: 'node'` 면 루트의 `.repro-<hash>.mjs` 로 `node` 실행.

**`find_reference_pr`** `{ paths?, component?, query?, limit?, detail? }` — 같은 컴포넌트
디렉터리를 건드린 머지 PR(경로 검색이 없어서 `commits?path=` 로 찾는다)과 `gh search prs` 결과를
합쳐 랭킹한다. 점수: 변경 요청 없이 승인(+3), 대상 디렉터리 파일 비율(+2×), 작은 diff(+1), 회계
완결도(changeset/spec/doc/test/story 각 +0.5, 최대 2), 90일 이내(+1), 외부 기여자(+1).
`{ detail: <번호> }` 면 그 PR 의 diff 를 파일 역할별로 묶어 준다.

### 코드 이해

**`explain_component_internals`** `{ name }` — `core → lab → charts → richtext` 순으로 찾는다.
`ChatComposer` 처럼 서브컴포넌트 이름이면 `Chat/` 디렉터리를 열고 `focus` 로 표시한다.
`units`(impl 파일마다 doc/spec/test/SYNC 대상), `files`(역할), `styling`(inline 여부, 스타일 키,
토큰 import), `themeSlots`, `ownerHooks`(치트시트 트리거 포함), `a11y.bindings`,
`a11y.ariaSites`(aria/role/tabIndex 줄), `i18n`, `stories`, `records`, `scores`.

**`estimate_change_scope`** `{ name, issue?, keywords? }` — `mustTouch`(SYNC 헤더),
`accounting`(changeset, `authority: current` 스펙, `verified_by`, 패밀리 문서, doc.mjs, a11y
states, 스토리, RTL 레지스트리), `cheatSheetRows`(키워드·오너 훅으로 걸린 치트시트 행),
`estimate`(같은 디렉터리 머지 PR 중앙값: S ≤ 3파일·80줄, M ≤ 8파일·300줄, 그 외 L; 표본 3개 미만이면
`insufficient data`).

**`search`** `{ query, limit?, source? }` — 레포 레코드·위키·워크플로 문서 한 인덱스.
아키텍처 치트시트·컨벤션·폴더 구조는 `source: 'wiki'`. **`get_doc`**, **`rules_for_paths`**,
**`pr_checklist`**, **`authoring_guide`**, **`refresh`** 는 기존 그대로.

### 구현

**`inspect_a11y_tree`** `{ story, baseUrl?, mode?, selector?, control?, surface?, nested? }` —
`tree`(기본): CDP 전체 접근성 트리(role, name, nameFrom, states, 상호작용 노드의 DOM 셀렉터),
aria 스냅샷, Tab 12회 포커스 순서. `probe`: 기존 `probe-callback.mjs` 와 같은 히트 테스트·클릭·
Enter·Space·중클릭·취소 프레스 단계별 로그. Storybook 이 떠 있어야 한다.

```
pnpm storybook                                        # dev, http://localhost:6006
python3 -m http.server -d apps/storybook/dist 6127    # 빌드 서빙, baseUrl 로 넘긴다
```

스토리 id 는 `core-button--primary` 형식. `<baseUrl>/index.json` 에서 찾는다.
main 베이스라인과 비교하려면 두 포트에서 각각 부르고 결과를 대조한다.

### 셀프 리뷰

**`simulate_review`** `{ base?, head?, pr? }` — 로컬 diff(기본 `upstream/main...HEAD`) 또는
upstream PR. `hunks`, `axesFired`(`data/review-rules.yml` 규칙 중 경로·역할·키워드·누락으로
발화한 것, 리뷰어 문장과 예시 PR 번호), `pastReviews`(`data/reviews/robohands.jsonl` 에서 같은
디렉터리를 건드린 PR 의 봇 리뷰), `accounting`(changeset, prettier, 변경 파일의 테스트, 안 건드린
SYNC 대상, 스펙 드리프트, main 이 같은 파일을 움직였는지). claim 은 `PR_DRAFT.md` → 마지막
커밋 메시지 순.

### 번역

**`translate_kr`** `{ url }` 또는 `{ text }` — 이슈/PR URL 에 `#issuecomment-`,
`#pullrequestreview-`, `#discussion_r` 앵커가 있으면 그 코멘트가 `target`. 스레드 전체(코멘트·
리뷰·인라인), 작성자 신분(프로필 + 머지 PR 수), 쓰인 라벨과 안 쓰인 라벨, 형제 이슈, 마지막 push
이후의 리뷰(staleness)를 `context` 로 붙인다.

## 환경변수

| 이름 | 기본 | 뜻 |
| --- | --- | --- |
| `ASTRYX_REPO` | cwd | astryx 체크아웃. cwd 가 체크아웃이면 cwd 우선 |
| `ASTRYX_WIKI_DIR` | `~/.cache/astryx-contrib/wiki` | 위키 클론 |
| `ASTRYX_CACHE_DIR` | `~/.cache/astryx-contrib` | PR·사용자·라벨 캐시 (하루) |
| `ASTRYX_UPSTREAM` | `facebook/astryx` | 읽는 레포 |
| `ASTRYX_MEMBERS` | `<레포 루트>/members.yml` | 팀원 명단 |
| `ASTRYX_REVIEW_DATA` | `mcp/data` | 리뷰 규칙과 코퍼스 |

## 데이터와 스크립트

- `data/review-rules.yml` — 리뷰 축. 손으로 큐레이션한다. 새 패턴을 발견하면 행을 추가하고 PR 번호를
  적는다. 트리거는 `always`, `paths`(글롭), `roles`, `keywords`, `missing`.
- `data/reviews/robohands.jsonl` — 봇 리뷰 코퍼스 (PR 번호, 시각, 상태, 커밋, 본문, 파일 목록).
  커밋되어 있으니 설치 시 다시 긁지 않는다.
- `scripts/collect-reviews.mjs` — 코퍼스 증분 수집. `node scripts/collect-reviews.mjs --limit 400`.
  봇은 예전엔 "[Reviewed by Robohands]" 서명, 지금은 `astracat-bot[bot]` 계정이라 둘 다 잡는다.
- `scripts/a11y-probe.mjs` — `inspect_a11y_tree` 가 별도 프로세스로 띄우는 Playwright 스크립트.

## 개발

```
pnpm test          # fixture 만으로 돈다 (test/fixtures/repo, wiki, gh, reviewdata)
pnpm typecheck
pnpm build         # dist/server.js — 등록된 서버가 이걸 읽으니 고치면 다시 빌드
node dist/server.js --check    # 인덱스가 뜨는지 자가진단
```

GitHub 을 읽는 툴은 `gh` 호출을 `GhRunner` 로 감싸고 테스트에서는 `test/ghReplay.ts` 가
`test/fixtures/gh/*.json` 을 돌려준다. 실제 체크아웃 스모크는
`ASTRYX_REPO=/path/to/astryx pnpm vitest run test/smoke-real.test.ts`.
