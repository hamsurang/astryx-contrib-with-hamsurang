# astryx-contrib-with-hamsurang

함수랑이 `facebook/astryx`에 기여할 때 쓰는 도구 모음. 두 패키지가 한 workspace에 있고 서로
독립적으로 돈다.

| 패키지 | 무엇 | 어디서 도나 |
| --- | --- | --- |
| [`sync/`](sync/README.md) | GitHub PR 상태를 Notion 기여 보드에 10분마다 반영 | GitHub Actions |
| [`mcp/`](mcp/README.md) | astryx 기여에 특화된 MCP 서버 (이슈 선별 → 코드 이해 → 구현 → 셀프 리뷰 → 번역) | 각자 로컬의 Claude Code / Codex |

루트 `members.yml`은 둘 다 읽는다. sync는 카드 담당자 지정에, MCP는 "팀원이 이미 잡은 이슈"
감지에 쓴다.

## MCP 설치

전제: Node 22+, pnpm, git, `gh` 로그인, 그리고 Claude Code 또는 Codex CLI. astryx 체크아웃이
로컬에 있어야 한다.

```
git clone https://github.com/hamsurang/astryx-contrib-with-hamsurang.git
cd astryx-contrib-with-hamsurang
./install.sh --repo ~/path/to/astryx     # --repo 를 빼면 흔한 위치를 찾고, 없으면 물어본다
```

스크립트가 의존성 설치, 빌드, 위키 사전 클론, `claude mcp add` / `codex mcp add` 등록,
자가진단까지 한다. 두 번 돌려도 같은 결과다. 끝나면 astryx 체크아웃 안에서 Claude Code 를 켜고
`explain_component_internals` 같은 툴을 불러보라.

## 툴 한눈에

| 단계 | 툴 | 한 줄 |
| --- | --- | --- |
| 이슈 선별 | `assess_issue_fit` | 제기자 신분, 메인테이너 반응, repro, 연결 PR, 팀원 진행 여부, 형제 이슈를 근거 표로 |
| | `validate_repro` | 이슈의 코드 블록을 뽑고, 만든 테스트를 astryx 의 vitest 로 실제 실행 |
| | `find_reference_pr` | 같은 종류의 변경을 제일 잘 통과시킨 머지 PR 추천, `detail` 로 diff 를 역할별로 |
| 코드 이해 | `explain_component_internals` | 파일 역할, SYNC 대상, StyleX 위치, 테마 슬롯, 오너 훅, a11y 바인딩, aria 줄 위치 |
| | `estimate_change_scope` | 꼭 건드려야 할 파일, 회계 항목, 치트시트 행, 과거 PR 기반 크기 추정 |
| | `search` / `get_doc` / `rules_for_paths` | 레코드·위키·워크플로 문서 검색과 경로별 규칙 |
| 구현 | `inspect_a11y_tree` | 브라우저 접근성 트리·aria 스냅샷·Tab 순서, 콜백 계약 프로브 |
| | `pr_checklist` / `authoring_guide` | 변경 경로별 체크리스트, 컴포넌트·스펙 작성 가이드 |
| 셀프 리뷰 | `simulate_review` | 리뷰 봇의 축 중 diff 가 건드린 것, 같은 디렉터리의 과거 리뷰, 회계 검사 |
| 번역 | `translate_kr` | 이슈·PR·리뷰·코멘트를 스레드·작성자 신분·라벨과 함께, 한 줄씩 번역 지시 포함 |

판단이 필요한 툴은 재료와 규칙, 지시 블록만 돌려준다. 결론 문장은 툴을 부른 모델이 쓴다.

## 개발

```
pnpm install
pnpm typecheck          # 두 패키지 모두
pnpm test               # 두 패키지 모두, 네트워크 없음
pnpm -F mcp build       # dist/ 갱신 (등록된 서버가 이걸 읽는다)
```

CI(`.github/workflows/ci.yml`)는 PR 마다 위 둘을 돌린다. 보드 동기화 워크플로우는
`.github/workflows/sync.yml`.
