# scripts/

데이터·에셋 유지보수 도구. 레귤레이션 업데이트·밸런스 패치 때 반복해서 쓴다.

## gen-sprite-manifest.mjs — `npm run sprites`

`public/sprites/` 를 스캔해 `src/data/spriteManifest.json` 을 만든다.
키 = 공백 제거한 파일명(확장자 제외), 값 = `/sprites/...` URL.
스프라이트를 추가·이름변경·삭제한 뒤 반드시 실행한다.

## validate-data.mjs — `npm run validate:data`

`src/data/*.json` 정합성 게이트. `npm run build` 앞단에 걸려 있다.

1. **참조 무결성** — `learnset`·`abilities`·`hiddenAbility`·`megaEvolutions[].ability`·
   `megaEvolutions[].megaStone`·`formVariants[].abilities`·`stanceChangeForms.revertMoveId`·
   `natures.increased/decreased` 가 실제 존재하는 id/키를 가리키는지.
2. **스키마·상식** — 필수 필드(`genderCategory` 등), 타입 값(18종), `baseStats` 6키·0~255 범위,
   id 중복, `formVariants`/`sizeForms`/`cosmeticForms` 의 `standard:true` 개수(정확히 1개),
   메가폼 `form` 중복.
3. **스프라이트 역방향 체크** — 각 포켓몬(기본·메가·비표준 폼·성별)과 각 도구에 대응하는
   매니페스트 키가 있는지. 매니페스트에만 있고 디스크에 없는 스테일 항목도 잡는다.

1·2 위반은 **오류**(exit 1), 3 위반은 **경고**(이니셜 폴백이 있으므로 exit 0).
`--strict` 를 주면 경고도 exit 1.

에셋이 아직 없어 경고가 예상되는 항목은 `scripts/data-allowlist.json` 에 등록해 소음을 줄인다
(에셋을 실제로 추가하면 allowlist 에서도 지운다).

```
node scripts/validate-data.mjs           # 오류만 게이트
node scripts/validate-data.mjs --strict  # 경고도 게이트
```

## merge-staging.mjs

신규 포켓몬·기술·도구 스테이징 배치(검토용 JSON)를 `src/data/*.json` 끝에 병합한다. 레귤레이션
업데이트(예: M-C)처럼 새 종·기술을 한 번에 여러 개 들여올 때 쓴다 — 밸런스 패치(기존 항목의
수치·학습셋 수정)는 대상이 아니다(수동으로 고칠 것).

스테이징 폴더에 파일명에 `pokemon`/`moves`/`items`가 들어간 JSON을 놓는다(정확한 파일명은
안 가림):

- `*pokemon*.json` — `{ "pokemon": [...], "megaEvolutionAdditions"?: [{ "baseId": "...", ...메가진화 필드 }] }`
- `*moves*.json` — `{ "moves": [...] }`
- `*items*.json` — `{ "items": [...] }`

각 항목 객체의 `_`로 시작하는 키(`_readme`·`_flags` 등)는 스테이징 전용 메모라 병합 전 제거된다.
포켓몬 항목의 `_learnsetByForm`(폼 id → learnset)은 특별 취급 — standard 폼(또는 최상위
자신)의 learnset을 최상위 `learnset`으로, 나머지는 각 `formVariants` 항목의 `learnset`으로
풀어낸 뒤 제거한다(폼마다 학습셋이 다른 종을 표현할 스키마가 없어서 쓰는 편법).

id가 이미 있는 항목은 조용히 건너뛴다 — **재실행해도 안전**(이미 병합된 배치를 다시 돌려도
중복이 안 생긴다). 기존 파일 내용은 건드리지 않고 텍스트로 끝에 이어붙이거나(신규 항목) 대상
종의 `megaEvolutions` 배열 안에만 정밀하게 끼워 넣는 방식이라(`megaEvolutionAdditions`),
전체 파일을 다시 직렬화하지 않는다 — 이 파일들은 엔트리마다 한 줄/여러 줄 서식이 섞여 있어
`JSON.stringify` 왕복이 무관한 항목까지 재포맷해버리기 때문(격리된 사본으로 실측 확인).

```
node scripts/merge-staging.mjs <스테이징폴더> --dry-run   # 무엇이 추가될지만 미리 보기
node scripts/merge-staging.mjs <스테이징폴더>             # 실제로 씀
```

병합 후에는 `npm run validate:data`로 참조 무결성(learnset·특성 등)을 확인할 것 — 이 스크립트는
"새 항목을 파일에 추가"만 하고 내용 검증은 하지 않는다.

## normalize_sprites.py

`public/sprites/` 이미지를 카테고리별 규격으로 통일한다. **의존성: Pillow** (`pip install Pillow`).
Node 파이프라인과 분리돼 있어 `npm run build` 에는 안 걸린다 — 스프라이트를 수급할 때만 수동 실행.

| 카테고리 | 경로 | 규격 |
|---|---|---|
| 포켓몬 | `public/sprites/{1~9}세대/` | 128×128 RGBA WEBP |
| 메가진화 | `public/sprites/메가진화/` | 128×128 RGBA WEBP (`메가진화.webp` 심볼 제외) |
| 도구 | `public/sprites/도구/` | 160×160 RGBA WEBP |
| 메가스톤 | `public/sprites/도구/메가스톤/` | 40×40 RGBA PNG + 콘텐츠 채움율 75% |
| 타입 | `public/sprites/타입/` | SVG — 건드리지 않음 |

비율을 유지해 목표 크기 안에 맞추고 투명 캔버스 중앙에 배치한다. 확장자가 바뀌면 옛 파일은 지운다.

**메가스톤 콘텐츠 채움율**: 원본마다 내부 여백이 제각각(65~100%)이라, 불투명 영역의 긴 변이
캔버스의 75%가 되도록 다시 스케일해 중앙 배치한다(±6%p 벗어나면 이탈). 다른 카테고리는 원본 여백을 그대로 둔다.

```
python scripts/normalize_sprites.py                      # 전체 검사(이탈 목록, exit 1)
python scripts/normalize_sprites.py --fix                # 전체 검사 + 이탈분 변환
python scripts/normalize_sprites.py a.png b.png --fix     # 신규 파일만(경로에서 카테고리 추론)
python scripts/normalize_sprites.py x.png --category 포켓몬 --fix   # 트리 밖 파일은 --category 지정
```

`--fix` 후에는 `npm run sprites` 로 매니페스트를 재생성한다.
