# Poke-Builder

Pokémon Champions 파티 빌더 — 6슬롯 파티를 구성하고 타입 상성을 확인하며, 결정력·내구력 매치업과 여러 턴짜리 배틀타워 시뮬레이션까지 판정하는 웹 앱.

- **배포**: [poke-builder-two.vercel.app](https://poke-builder-two.vercel.app/) — Vercel에 `main` 브랜치 자동 배포
- **저장소**: [github.com/Erensia/poke-builder](https://github.com/Erensia/poke-builder)
- **현재 버전**: ver.1.7 — 상세는 [문서](#문서) 참고

## 주요 기능

- **6슬롯 파티 편성**: 기술 4개·특성·도구 배치, 실제 스프라이트 이미지(메가·폼·성별 자동 반영), 이름 붙인 파티/빌드 프리셋 저장·불러오기, 드래그앤드랍 순서 변경
- **타입 상성 매트릭스**: 파티 6마리 × 공격 타입 18종 방어 배율을 한눈에, 파티 전체 취약/강점 자동 판정
- **성격·능력포인트 편집**: 챔피언스 전용 실수치 공식, 슬라이더 UI로 스탯 배분
- **결정력 & 내구력 매치업**: 랭크·날씨·필드·스크린·특성·다단히트까지 반영해 확정 1타~3타 이상 판정, 난수(85~100)별 데미지를 상대 HP %로 표기(범위 + 16개 펼치기)
- **배틀타워(다중 턴 시뮬레이션)**: 우선도·명중/회피·급소·상태이상·반동·2턴 차지기·날씨/필드 등 전투 로직 전반을 반영한 턴제 대전, 6빌드→3선출 & 교체(중복 배치 방지, 드래그앤드롭 순서 변경, 압축 카드 뷰), 배틀비디오(최근 3전 다시보기)
- **배틀타워 AI(어려움 난이도)**: 상대 편을 컴퓨터가 조작 — 기술·교체·메가진화를 "HP 교환" 점수식 하나로 비교해 선택. 유턴류·회복·랭크업·배턴터치·상태이상·벽·설치기·날씨/필드/트릭룸·도발/앙코르·방어류(엔진 한 턴 시뮬레이션)까지 판단. ver.1.8부터 파티 단위 평가 — 남은 포켓몬끼리의 대면표로 교환 뒤 수 싸움까지 계산(미니맥스)
- **상대 진영 설치 기술 6종**·**강제 교체 기술 4종**: 스텔스록·압정뿌리기 등 / 드래곤테일·울부짖기 등
- **사이드 메뉴**: 포켓몬 도감(전국도감 순 정렬, 루가루암 등 폼 변종은 폼 탭으로 종족값·특성·기술 전환)·카드형 기술표·도구 도감
- **레귤레이션 M-C 대응**: 신규 포켓몬 26종 + 전용 기술·특성·지닌 도구를 엔진에 배선
- **글래스모피즘 UI + 모바일 대응(≤760px)**: 반투명·블러 기반 디자인 토큰, 사이드바 드로어, 모달 하단 시트화, 검색창 하단 고정, 입력 확대 방지
- **로컬 자동 저장**: 편성 내용이 `localStorage`에 자동 저장, 새로고침해도 복원
- **한국어 조사 자동 처리**: 로그·모달 문구의 조사를 받침 기반으로 자동 판별

## 데이터 규모

- 포켓몬 252종 — 메가진화 가능 76종 / 메가폼 81개(일부 종은 메가폼 2개)
- 기술 511개 (우선도·랭크 변화·다단히트 정보 포함)
- 특성 216개
- 도구 166종 (메가스톤 포함)
- 성격 21종
- 스프라이트: `public/sprites/` — `npm run sprites`로 `src/data/spriteManifest.json` 재생성

## 기술 스택

React 19 + TypeScript + Vite 8. 별도 백엔드 없이 로컬 JSON 데이터 + `localStorage`로 동작하는 순수 정적 SPA. `@/`는 `src/`를 가리키는 경로 별칭(ver.1.5). 린트는 oxlint, 테스트 러너는 없음 — 엔진·AI 검증은 Vite `ssrLoadModule`로 `src/`를 직접 불러오는 스크립트(`npm run test:ai`·`npm run sim:ai`, ver.1.7)로 한다.

## 시작하기

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # 데이터 검증 + tsc -b + vite build → dist/
npm run lint     # oxlint
npm run sprites  # public/sprites/ 스캔 → src/data/spriteManifest.json 재생성
npm run test:ai  # 배틀 AI·엔진 규칙 시나리오(실패 시 exit 1)
npm run sim:ai -- regress   # 엔진 동작 불변 확인용 로그 해시(모드: regress|ai|greedy|h2h|diag)
```

## 배포 & 개발 워크플로

`main` 브랜치가 Vercel 프로덕션에 자동 배포된다(제로 설정, 프레임워크 프리셋 자동 감지). `dev`에서 항목별 브랜치를 파서 PR로 `dev`에 머지하고, 주기적으로 `dev`를 `main`에 병합한다. 기획·백로그 문서만 고치는 변경은 브랜치/PR 없이 직접 커밋한다. 상시 브랜치는 `main`·`dev` 둘뿐 — 머지된 작업 브랜치는 로컬·원격 모두 삭제한다.

## 폴더 구조

```
src/
├─ types/        Pokemon, Move, Ability, Item, Party, Nature, Matchup, BattleStats, Status, Weather, Field 등 도메인 타입
├─ data/         pokemon.json, moves.json, abilities.json, items.json, natures.json, typeChart.json, spriteManifest.json
├─ lib/          데이터 조회·타입 상성·실수치/결정력/내구력 계산·특성/랭크/명중/턴순서 판정·도구 효과·
│                조사 자동 판별·로컬 저장(storage.ts, 팩토리 기반)
│  └─ battle/    다중 턴 배틀 시뮬레이터(ver.1.5에 8개 파일로 분리) — state/switching/
│                hitResolution/preHitEffects/mirroredEffects/resolveAction/runTurn/finishTurn.ts
│                (battleSimulator.ts는 공개 표면만 재export하는 얇은 배럴로 유지)
│     └─ ai/     배틀 AI(ver.1.7) — evaluator(옵션 평가)·decision(HP 교환 점수식)·opponentMoveModel
│                (상대 기술 확률 모델)·statusMoveEffects·protectMoves·moveDamage 등
├─ hooks/        useParty · useMatchup · useBattleSetup · usePartyPresets · useSlotPresets · useBattleVideos
└─ components/   PartyBoard, MatchupPage, PokedexPage, MoveDexPage(카드형 UI), ItemDexPage, 각종 PickerModal 등
                 BattleLogPage(+ BattleSetupScreen/BattleSelectScreen/BattleBoard 화면 분리),
                 BattleTurnLog(+ 로그 계열별 렌더러 9종 분리)
public/sprites/  포켓몬·메가진화·도구·타입 스프라이트 (spriteManifest.json 생성 소스)
scripts/         데이터·에셋 유지보수 도구 — scripts/README.md 참고
```

## 문서

기획·백로그 문서는 `docs/00_기획문서/`에 있다. 버전별 배포 내역:

- [post-1.0-backlog.md](docs/00_기획문서/post-1.0-backlog.md) — ver.1.0.x: 타입 상성 매트릭스 개편, 6슬롯 빌더 + 3선출 화면, 배틀타워 메가진화 버튼
- [1.1-backlog.md](docs/00_기획문서/1.1-backlog.md) — ver.1.1: 실제 스프라이트 배선, 전체 모바일 대응, 배틀 로그 문구 전면 정비
- [1.2-backlog.md](docs/00_기획문서/1.2-backlog.md) — ver.1.2: 이미지·아이콘 확대, 레귤레이션 M-C 대응(신규 26종 + 엔진 배선), 엔진 버그 수정 다수
- [1.3-backlog.md](docs/00_기획문서/1.3-backlog.md) — ver.1.3: 엔진 미배선 기술 전수 감사·수정, 파티 D&D + 기술 필터, 도감 전국도감 순 정렬, 배틀비디오 신설
- [1.4-backlog.md](docs/00_기획문서/1.4-backlog.md) — ver.1.4: M-C 밸런스 패치, 방어류 오적용 버그 수정, 데이터 변경이력 문서화
- [1.5-backlog.md](docs/00_기획문서/1.5-backlog.md) — ver.1.5: 코드 리팩토링(기능 변경 없음) — `battleSimulator.ts`(6,884줄)를 `lib/battle/` 8개 파일로 분리, `resolveAction`(~3,400줄)을 421줄로 축소, `BattleTurnLog`/`BattleLogPage` 컴포넌트 분리, 훅/저장소 중복 제거, `@/` 경로 별칭 도입
- [1.6-backlog.md](docs/00_기획문서/1.6-backlog.md) — ver.1.6: 전면 글래스모피즘 UI 개편 + 기술표 카드형 전환, 모바일 UX 버그 5건, 배틀타워 편성/선출 UI 개선 4건, 엔진 버그 다수 수정(필드 지속시간·덮어쓰기, 위기회피/괴짜/변신/메가스톤 표기, 반동 미적용·오버킬 시 부풀려지던 버그)
- [1.7-backlog.md](docs/00_기획문서/1.7-backlog.md) — ver.1.7: 배틀타워 AI(어려움 난이도 — HP 교환 점수식, 변화기·방어류 판단, 설계 문서는 [배틀AI 기획/](docs/00_기획문서/배틀AI%20기획/)), 매치업 난수별 데미지 표기, 엔진 버그 수정(곡예 시드 소모, 같은 날씨 재설치 실패, 썰렁개그 교체, 공격기 랭크 변화는 명중 시에만), max-params 경고 정리
- [1.8-backlog.md](docs/00_기획문서/1.8-backlog.md) — ver.1.8(진행 중): 도감 특성 문구 정비 + 갈지자걸음·총대장 엔진 배선(트랙 J, 완료), 도감 폼 탭 — 폼별 종족값·특성·기술 표기(트랙 K, 완료), AI 파티 단위 평가 ①(대면표 + 미니맥스, 그리디 상대 458 → 485승), ②(효과를 이어지는 대면에 남기기 — 구현, 기본값 끔), 변화기 판단 확장 A1(흑안개·혼란·헤롱헤롱·씨뿌리기·하품·희망사항·신비의부적·아쿠아링/뿌리박기·배북 + 배북 HP 비용 버그 수정), A2(대타출동·잠꼬대·울부짖기/날려버리기·추억의선물 + 추억의선물·미스트버스트 자기 기절 버그 수정), 트랙 M1(엔진 미구현 변화기 — 트릭·바꿔치기·아픔나누기·순풍·생명의물방울·꿀꺽·리사이클 + 구애 잠금 엔진 이관), 트랙 M2(자기암시·원한·봉인·트집·흉내쟁이·경혈찌르기·파워셰어), 트랙 M3(스킬스왑·동료만들기·역할·위액·고민씨·물붓기·미러타입 + 마이페이스·둔감·정신력 면역 + 교체 시 특성·타입 원복), 트랙 M4(원더룸·매직룸·중력·전자부유·떨어뜨리기 접지 + 접지 판정·도구 무효 공통화, 트릭룸 재사용 시 해제), 트랙 M5(데미지 0이던 데미지 기술 9개 — 내던지기·일렉트릭볼·하드프레스·분노의앞니·일격기·목숨걸기 + AI 자폭류 희생 평가), 트랙 M6(검은눈빛·블록·페어리록·치유소원·부식가스·록온·자기장조작·아름다운허물 + 집단구타 데미지 수정 + 효과 없는 기술 자동 검사), 트랙 L(성묘 — 쓰러진 동료 수만큼 위력), 변화기 판단 Tier 2-A(파워스왑·가드스왑·가드셰어·스피드스왑·파워트릭·뒤집어엎기·치료방울·변신·코트체인지), Tier 2-B(멸망의노래·회생의기도·다과회·문어굳히기 + 다과회 양쪽 열매 수정), Tier 2-C(꼬리자르기·썰렁개그 교체 평가 + 눈·모래바람 방어 1.5배 누락 수정)
- [데이터변경이력.md](docs/데이터변경이력.md) — 기존 항목 수치·학습셋 변경(밸런스 패치) 기록. ver.1.4부터 시작

ver.1.0 이전(Phase 1~8) 회고·기획 문서도 같은 폴더에 있다 — 초기 아키텍처 결정과 단계별 개발 이력이 궁금하면 참고.
