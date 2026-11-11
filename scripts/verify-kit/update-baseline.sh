#!/bin/bash
# 기준값 갱신(8.2 T2) — 8.3처럼 엔진·AI 출력이 의도대로 바뀐 뒤에만 쓴다.
# 사용: bash verify.sh 를 먼저 끝까지 돌려 verify-work/ 를 채운 다음  bash update-baseline.sh [--dry]
#   verify-work 의 출력으로 baseline/ 5개 파일과 verify.sh 의 해시 2개(regress 200·test:inference 결합)를 다시 쓴다.
#   verify.sh 가 FAIL 로 보고한 항목이 "의도한 변화"인지는 사람이 먼저 확인한다 — 이 스크립트는 판단하지 않는다.
KIT="$(cd "$(dirname "$0")" && pwd)"; W="$KIT/verify-work"; B="$KIT/baseline"; V="$KIT/verify.sh"
dry=0; [ "$1" = "--dry" ] && dry=1
for f in regress.out regress20000.out matchup.out greedy120.out status60.out h2h40.out ai60.out test-inference.log; do
  [ -s "$W/$f" ] || { echo "verify-work/$f 없음 — 먼저 bash verify.sh 를 끝까지 돌릴 것"; exit 2; }
done
clean() { grep -v "WebSocket server error" "$1"; }
reg=$(grep -o '"hash":"[0-9a-f]\{64\}"' "$W/regress.out" | head -1 | cut -d'"' -f4)
inf=$(grep -o '결합 결과 해시 [0-9a-f]*' "$W/test-inference.log" | head -1 | awk '{print $4}')
[ -n "$reg" ] && [ -n "$inf" ] || { echo "해시를 못 읽음(regress=$reg, inference=$inf)"; exit 2; }
echo "regress 200 해시  $(grep -o 'a4f6ca69[0-9a-f]*\|"hash":"[0-9a-f]*"' "$V" | head -1) → $reg"
echo "test:inference    $(grep -o '결합 결과 해시 [0-9a-f]*' "$V" | head -1 | awk '{print $4}') → $inf"
[ $dry = 1 ] && { echo "--dry: 쓰지 않음"; exit 0; }
clean "$W/regress20000.out" | tail -1 > "$B/regress20000.out"
clean "$W/matchup.out" | tail -1 > "$B/matchup-hash600k.out"
for f in greedy120 status60 h2h40; do clean "$W/$f.out" > "$B/$f.out"; done
norm() { clean "$1" | sed -E 's/"avgTurnMs":[0-9.]+,"maxTurnMs":[0-9.]+/TIME/'; }
[ "$(norm "$W/ai60.out")" = "$(norm "$B/ai60.out")" ] || cp "$W/ai60.out" "$B/ai60.out"   # 시간만 다르면 그대로 둔다
old=$(grep -o '"hash":"[0-9a-f]\{64\}"' "$V" | head -1 | cut -d'"' -f4)
oldi=$(grep -o '결합 결과 해시 [0-9a-f]*' "$V" | head -1 | awk '{print $4}')
sed -i "s/$old/$reg/g; s/${old:0:8}…/${reg:0:8}…/g; s/$oldi/$inf/g" "$V"
echo "갱신 완료 — git diff 로 baseline/·verify.sh 확인 후 커밋(같은 PR에 AI 변경과 함께)"
