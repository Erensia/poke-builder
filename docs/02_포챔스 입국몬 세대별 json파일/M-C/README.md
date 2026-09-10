# 레귤레이션 M-C 스테이징

- **출처**: 사용자 제공 `C:\Users\kyongmin.kim\Downloads\M-C\` (2026-09-09)
- **상태**: `src/data/*.json` 미반영. learnset·특성이 덜 차서 아직 병합 불가.
- **시행일**: 2026-09-09~

## 파일

| 파일 | 내용 |
|---|---|
| `pokemon-mc-staging.json` | 신규 종 24개(`pokemon`) + 기존 종에 붙일 메가 1개(`megaEvolutionAdditions`, 앱솔-메가Z) |
| `moves-mc-staging.json` | 신규 기술 2개(베어가르기·대검돌격) |
| `items-mc-staging.json` | 신규 메가스톤 4개 |

필드는 `src/types/pokemon.ts`(`Pokemon`/`MegaEvolution`/`FormVariant`)·`move.ts`·`item.ts`를 따른다.
엔트리별 주의사항은 각 파일 `_readme` + 개별 `_flags` 참고.

## 폼 모델링 (사용자 확정 2026-09-09)

- **스트린더**: `formVariants` [하이한 모습(기준)/로우한 모습]. 종족값·타입 동일, 특성만 플러스↔마이너스. 선택형 UI.
- **에써르**: `formVariants` [수컷(기준)/암컷]. 종족값·특성·스프라이트 전부 상이. 선택형 UI.
  learnset은 암컷 폼 기준만 확보 — 수컷 폼 전용 기술 별도 확인 필요.
- **시비꼬**: `formVariants` [그린(기준)/블루/옐로/화이트 페더]. 종족값 동일, 숨겨진 특성만
  그린·블루=근성 / 옐로·화이트=우격다짐. 4색 겉모습도 달라 선택형 UI.
- **메가루카리오Z / 메가한카리아스Z**: `pokemon.json`에 이미 있음. 이미지 배선(+메가스톤 이미지)만 하면 됨.

## 병합 전 남은 작업

1. **abilities.json 신규 14종** — `src/data/validate-data.mjs` 드라이런에서 참조 오류로 잡힌다:
   강철정신 · 그래스메이커 · 넘치는씨 · 도주 · 리베로 · 사이코메이커 · 열교환 · 위기회피 ·
   잠복 · 주눅 · 파수견 · 펑크록 · 풀모피 · 해감액.
   설명 텍스트 필요. 일부(그래스메이커·리베로·열교환·펑크록·사이코메이커 등)는 엔진 훅도 필요할 수 있음.
2. **learnset 29종** — 보만다·갑주무사·드닐레이브·에써르 4종만 확보. 나머지는 `[]` 상태.
   M-C 기술표 공개 대기.
3. **스프라이트 배선** — `Downloads/M-C/` 이미지를 `public/sprites/`에 배치 →
   `python scripts/normalize_sprites.py <파일들> --fix` → `npm run sprites`.
   메가Z 2종 이미지 넣으면 `scripts/data-allowlist.json`에서 한카리아스나이트Z·루카리오나이트Z 제거.
4. **대검돌격 부가효과** — 피격 시 필중+피해 2배 볼라틸. `battleSimulator` 미구현 → 엔진 트랙.
5. **지닌도구 12종** (대파·울퉁불퉁멧·풍선·레드카드·조임밴드·탈출버튼·노말주얼·그라운드코트·시드 4종)
   — 현재 `items.json` 스키마로 표현 불가. `itemEffects.ts` + `battleSimulator.ts` 확장 = 별도 엔진 트랙.

## 드라이런 결과 (2026-09-09)

`scripts/validate-data.mjs` 기준 — 참조 오류 = 위 14종 특성뿐(learnset·타입·종족값·폼 구조는 이상 없음).
경고 = 스프라이트 미배선분 전부(예상됨).
