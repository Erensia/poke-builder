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

## normalize_sprites.py

`public/sprites/` 이미지를 카테고리별 규격으로 통일한다. **의존성: Pillow** (`pip install Pillow`).
Node 파이프라인과 분리돼 있어 `npm run build` 에는 안 걸린다 — 스프라이트를 수급할 때만 수동 실행.

| 카테고리 | 경로 | 규격 |
|---|---|---|
| 포켓몬 | `public/sprites/{1~9}세대/` | 128×128 RGBA WEBP |
| 메가진화 | `public/sprites/메가진화/` | 128×128 RGBA WEBP (`메가진화.webp` 심볼 제외) |
| 도구 | `public/sprites/도구/` | 160×160 RGBA WEBP |
| 메가스톤 | `public/sprites/도구/메가스톤/` | 40×40 RGBA PNG |
| 타입 | `public/sprites/타입/` | SVG — 건드리지 않음 |

비율을 유지해 목표 크기 안에 맞추고 투명 캔버스 중앙에 배치한다. 확장자가 바뀌면 옛 파일은 지운다.

```
python scripts/normalize_sprites.py                      # 전체 검사(이탈 목록, exit 1)
python scripts/normalize_sprites.py --fix                # 전체 검사 + 이탈분 변환
python scripts/normalize_sprites.py a.png b.png --fix     # 신규 파일만(경로에서 카테고리 추론)
python scripts/normalize_sprites.py x.png --category 포켓몬 --fix   # 트리 밖 파일은 --category 지정
```

`--fix` 후에는 `npm run sprites` 로 매니페스트를 재생성한다.

> 참고(2026-09): 기존 `도구/` 32개가 90~100px 로 규격(160px)에서 벗어나 있다. 표시 크기는
> CSS 가 잡으므로 기능엔 문제없어 이번엔 그대로 뒀다. 일괄 정리하려면 `--fix` 를 돌리고
> 아이콘 여백이 커지지 않는지 확인할 것.
