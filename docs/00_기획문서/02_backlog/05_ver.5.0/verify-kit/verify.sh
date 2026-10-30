#!/bin/bash
# 통합 검증(4.0 킷을 5.0 문서 폴더로 옮김 — 기준 출력은 4.0 종료 시점 엔진 기준, R3(AI 변경) 뒤에는 의도한 변화만 baseline/을 다시 기록한다)
# 4.0 통합 검증(리팩토링·디자인 PR마다 전부 통과해야 한다). 사용: bash verify.sh   — 킷 폴더 = 이 파일이 있는 폴더(기준 출력은 baseline/)
# 리팩토링 통합 검증 — 사용법: verify.sh [quick]   (quick = 정적 검증 + test:inference 해시만, UI 전용 변경용이 아니라 중간 점검용)
KIT="${KIT:-$(cd "$(dirname "$0")" && pwd)}"
cd "$(git -C "$KIT" rev-parse --show-toplevel)" || exit 2   # 저장소 루트(어느 PC에서든)
B="$KIT/baseline"
W="$KIT/verify-work"
rm -rf "$W"; mkdir -p "$W"
fail=0
step() { # 이름 명령...
  local name="$1"; shift
  if "$@" > "$W/$name.log" 2>&1; then echo "PASS  $name"; else echo "FAIL  $name  (로그: $W/$name.log)"; fail=1; fi
}
step tsc npx tsc -b
step oxlint bash -c 'npx oxlint src scripts | tail -1 | grep -q "0 warnings and 0 errors" || [ -z "$(npx oxlint src scripts 2>&1 | grep -E "error|warning" )" ]'
step build npm run build
[ "$1" = "quick" ] && { [ $fail = 0 ] && echo "== 정적 검증 통과" || echo "== 실패"; exit $fail; }
# 병렬 실행
( node scripts/battle-ai-scenarios.mjs > "$W/test-ai.log" 2>&1; echo $? > "$W/test-ai.rc" ) &
( node scripts/damage-formula-check.mjs > "$W/test-damage.log" 2>&1; echo $? > "$W/test-damage.rc" ) &
( node scripts/defense-inference-check.mjs > "$W/test-inference.log" 2>&1; echo $? > "$W/test-inference.rc" ) &
( cp "$KIT/matchup-hash.mjs" scripts/zz-matchup-hash.mjs; node scripts/zz-matchup-hash.mjs 600000 > "$W/matchup.out" 2>&1; rm -f scripts/zz-matchup-hash.mjs ) &
( node scripts/battle-ai-sim.mjs regress 200 > "$W/regress.out" 2>&1 ) &
( node scripts/battle-ai-sim.mjs regress 20000 > "$W/regress20000.out" 2>&1 ) &
( node scripts/battle-ai-sim.mjs greedy 120 > "$W/greedy120.out" 2>&1 ) &
( STATUS=1 node scripts/battle-ai-sim.mjs greedy 60 > "$W/status60.out" 2>&1 ) &
( node scripts/battle-ai-sim.mjs h2h 40 > "$W/h2h40.out" 2>&1 ) &
( node scripts/battle-ai-sim.mjs ai 60 > "$W/ai60.out" 2>&1 ) &
wait
chk() { # 이름 rc파일
  if [ "$(cat "$W/$2.rc")" = "0" ]; then echo "PASS  $1"; else echo "FAIL  $1  (로그: $W/$2.log)"; fail=1; fi
}
chk test:ai test-ai; chk test:damage test-damage; chk test:inference test-inference
grep -q "결합 결과 해시 10040ffa0108c9a3" "$W/test-inference.log" && echo "PASS  결합 결과 해시 10040ffa0108c9a3" || { echo "FAIL  결합 결과 해시 변경"; fail=1; }
grep -q '"hash":"f46af161cdf7688254dcd2e3ce3b5e65ac47481b0be51d44aeb583c9fa85433b"' "$W/regress.out" && echo "PASS  regress 200 해시 f46af161…" || { echo "FAIL  regress 해시 변경: $(tail -1 "$W/regress.out" | cut -c1-200)"; fail=1; }
if [ "$(grep -v "WebSocket server error" "$W/regress20000.out" | tail -1)" = "$(cat "$B/regress20000.out")" ]; then echo "PASS  regress 20000 로그 해시(시드 1~20000 전 턴 로그)"; else echo "FAIL  regress 20000 해시 변경: $(tail -1 "$W/regress20000.out" | cut -c1-200)"; fail=1; fi
if [ "$(grep -v "WebSocket server error" "$W/matchup.out" | tail -1)" = "$(cat "$B/matchup-hash600k.out")" ]; then echo "PASS  계산 함수 차분 해시(무작위 대결 60만 건)"; else echo "FAIL  계산 함수 차분 해시 변경: $(tail -1 "$W/matchup.out" | cut -c1-200)"; fail=1; fi
for f in greedy120 status60 h2h40; do
  grep -v "WebSocket server error" "$W/$f.out" > "$W/$f.clean"; if cmp -s "$W/$f.clean" "$B/$f.out"; then echo "PASS  $f 출력 동일"; else echo "FAIL  $f 출력 차이"; diff "$B/$f.out" "$W/$f.clean" | head -4 | cut -c1-200; fail=1; fi
done
norm() { grep -v "WebSocket server error" "$1" | sed -E 's/"avgTurnMs":[0-9.]+,"maxTurnMs":[0-9.]+/TIME/'; }
if [ "$(norm "$W/ai60.out")" = "$(norm "$B/ai60.out")" ]; then echo "PASS  ai60 출력 동일(시간 제외) · $(grep -o '"avgTurnMs":[0-9.]*,"maxTurnMs":[0-9.]*' "$W/ai60.out") (기준 $(grep -o '"avgTurnMs":[0-9.]*,"maxTurnMs":[0-9.]*' "$B/ai60.out"))"; else echo "FAIL  ai60 출력 차이"; fail=1; fi
[ $fail = 0 ] && echo "== 전체 통과" || echo "== 실패 있음"
exit $fail
