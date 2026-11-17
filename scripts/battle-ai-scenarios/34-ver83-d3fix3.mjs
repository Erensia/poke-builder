// 8.3 D3-fix-3 기술 PP 25건 정정(Showdown champions `965a535` 대조): 엔진 `pp`는 실제 최대 PP = champions 공식 `(기본 PP ÷ 5 + 1) × 4`(기본 PP 20 초과는 20으로 깎음).
// 정정 후 모든 기술의 pp는 8·12·16·20 중 하나(예외: 회생의기도 1·날개치기 35 — 허용 목록). champions가 PP를 재정의한 출전 가능 기술 9건은 본가 PP로 공식을 다시 적용하면 틀어지므로 회귀로 고정한다.
// 설계 `8.3-D3-fix3-PP정정설계.md`, 검수 `8.3-D3-fix3-PP정정설계-검수.md`
import { readFileSync } from "node:fs";
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const M = (n) => data.getMove(n);
  const mv = (n) => ({ kind: "move", move: M(n) });

  // ── 데이터: 정정 25건 ──
  const FIXED = { 트릭룸: 8, 니들가드: 8, 거대해머: 8, 가드셰어: 12, 뱀눈초리: 20, 마지막일침: 20, 비축하기: 20, 트릭: 12, 우드해머: 16, 킬러스핀: 16, 가위자르기: 8,
    대지의파동: 12, 메탈버스트: 12, 성묘: 12, 앙갚음: 12, 천추지한: 12, DD래리어트: 12, 레이징불: 12, 변신: 12, 셸블레이드: 12, 셸암즈: 12, 스피드스왑: 12, 업어후리기: 12, 작아지기: 12, 페어리록: 12 };
  { const bad = Object.entries(FIXED).filter(([n, pp]) => M(n)?.pp !== pp).map(([n, pp]) => `${n} ${M(n)?.pp}→${pp}`);
    check(`D3-fix3 데이터: 정정 25건 pp가 Showdown maxPP와 같다(${Object.keys(FIXED).length}건)`, Object.keys(FIXED).length === 25 && bad.length === 0, bad.slice(0, 6).join(", ")); }
  // champions가 PP를 재정의한 출전 가능 기술 — 방어·킹실드·토치카·부리캐논·모래바람·설경·힘흡수·희망사항 8, 깜짝베기 20(본가 공식이면 방어 12·깜짝베기 16)
  { const OVERRIDE = { 방어: 8, 킹실드: 8, 토치카: 8, 부리캐논: 8, 모래바람: 8, 설경: 8, 힘흡수: 8, 희망사항: 8, 깜짝베기: 20 };
    const bad = Object.entries(OVERRIDE).filter(([n, pp]) => M(n)?.pp !== pp).map(([n, pp]) => `${n} ${M(n)?.pp}→${pp}`);
    check("D3-fix3 데이터(회귀): champions PP 재정의 9건 — 방어류·모래바람·설경·힘흡수·희망사항 8, 깜짝베기 20", bad.length === 0, bad.join(", ")); }
  check("D3-fix3 데이터: 회생의기도 pp 1 유지(noPPBoosts)", M("회생의기도").pp === 1);
  const all = Object.values(JSON.parse(readFileSync(new URL("../../src/data/moves.json", import.meta.url), "utf8")));
  { const outside = all.filter((m) => ![8, 12, 16, 20].includes(m.pp)).map((m) => `${m.name}:${m.pp}`).sort();
    check("D3-fix3 데이터: 모든 기술의 pp가 8·12·16·20 안 — 예외는 날개치기·회생의기도 2건뿐", json(outside) === json(["날개치기:35", "회생의기도:1"].sort()), outside.join(", ")); }

  // ── K6 점검(scripts/move-effect-audit.mjs) ──
  let audit = null; try { audit = await import(new URL("../move-effect-audit.mjs", import.meta.url)); } catch { /* 아래 검사가 실패로 드러낸다 */ }
  const kinds = (m) => { try { return audit.auditMoveEffect(m).map((f) => f.kind); } catch (e) { return ["오류: " + e.message]; } };
  check("D3-fix3 K6: pp 10(환산 누락)은 K6, 8·12·16·20은 K6 없음", !!audit && kinds({ name: "가짜", pp: 10 }).includes("K6") && [8, 12, 16, 20].every((pp) => !kinds({ name: "가짜", pp }).includes("K6")), json([10, 12].map((pp) => kinds({ name: "가짜", pp }))));
  check("D3-fix3 K6: pp 필드가 없는 합성 기술(다른 점검용 시험 기술)은 건드리지 않는다", !!audit && !kinds({ name: "가짜" }).includes("K6"), json(kinds({ name: "가짜" })));
  { const allow = JSON.parse(readFileSync(new URL("../data-allowlist.json", import.meta.url), "utf8")).moveEffectAudit ?? {};
    const r = audit ? audit.auditMoves(all, allow) : { warnings: ["모듈 로드 실패"], errors: [] };
    check("D3-fix3 K6: 실제 기술 전체 — 허용 목록(회생의기도·날개치기 포함, 사유 필수) 적용 뒤 경고·오류 0건", r.warnings.length === 0 && r.errors.length === 0 && !!allow["회생의기도"] && !!allow["날개치기"], json(r).slice(0, 200)); }

  // ── 동작 ──
  const bulky = pts({ hp: 32, def: 32, spd: 32 }), strong = pts({ atk: 32, spe: 32 });
  { const st = battle([mon("한카리아스", ["가위자르기", "트릭룸"], null, null, strong)], [mon("잠만보", ["도우미"], null, null, bulky)]);
    check("D3-fix3 동작: 배틀 시작 remainingPp = 새 pp(가위자르기 8·트릭룸 8)", st.a.remainingPp["가위자르기"] === 8 && st.a.remainingPp["트릭룸"] === 8, json(st.a.remainingPp)); }
  { // 과사열매(레프): PP 0이 되는 사용에서 회복 후 PP = min(0 + 10, 최대) — 가위자르기(최대 8)는 정확히 8(Showdown min(현재 PP + 10, 최대 PP))
    const st = battle([mon("한카리아스", ["가위자르기"], null, "과사열매", strong)], [mon("잠만보", ["도우미"], null, null, bulky)]);
    st.a.remainingPp["가위자르기"] = 1;
    const o = rt.runTurn(st, mv("가위자르기"), mv("도우미"), () => 0.5);
    check("D3-fix3 동작: 과사열매 — 가위자르기 PP 0에서 회복 후 정확히 8", o.nextState.a.remainingPp["가위자르기"] === 8 && !o.nextState.a.currentItemId, json({ pp: o.nextState.a.remainingPp["가위자르기"], item: o.nextState.a.currentItemId })); }
  { // 소진: 트릭룸 PP 1 → 사용 후 0, 과사열매 없음
    const st = battle([mon("한카리아스", ["트릭룸"], null, null, strong)], [mon("잠만보", ["도우미"], null, null, bulky)]);
    st.a.remainingPp["트릭룸"] = 1;
    const o = rt.runTurn(st, mv("트릭룸"), mv("도우미"), () => 0.5);
    check("D3-fix3 동작: 트릭룸 마지막 1을 쓰면 PP 0", o.nextState.a.remainingPp["트릭룸"] === 0, json(o.nextState.a.remainingPp)); }
}
