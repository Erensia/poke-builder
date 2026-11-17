// 8.3 D3-fix-2 접촉 표기 정정(Showdown champions `965a535` 대조): 트림·불새·대격분·바늘미사일은 비접촉, 지구던지기는 접촉, 날개치기 makesContact 채움.
// 접촉이 바뀌면 달라지는 것: 접촉 반응(까칠한피부·울퉁불퉁멧·원격), 복슬복슬·파동의방호(방어 ×2), 단단한발톱(×1.3), 방어류 막힘 반응, 관통드릴 관통.
// 지구던지기는 고정 데미지라 위력·데미지 보정형(복슬복슬·파동의방호·단단한발톱·×0.25)을 건너뛰고 명중 후 반응형만 받는다(엔진 `fixedDamage` 분기, Showdown getDamage와 같다).
// 설계 `8.3-D3-fix2-접촉표기설계.md`, 검수 `8.3-D3-fix2-접촉표기설계-검수.md`
import { readFileSync } from "node:fs";
export default async function ({ server, data, mon, battle, pts, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const json = JSON.stringify;
  const mv = (n) => ({ kind: "move", move: data.getMove(n) });
  const M = (n) => data.getMove(n);
  const IDLE = "도우미"; // 아무 일도 안 하는 변화기
  const bulky = pts({ hp: 32, def: 32, spd: 32 });
  const strong = pts({ atk: 32, spa: 32, spe: 32 });
  const NONCONTACT = ["트림", "불새", "대격분", "바늘미사일"];

  // ── 데이터 ──
  check("D3-fix2 데이터: 트림·불새·대격분·바늘미사일 = 비접촉(필드·태그)", NONCONTACT.every((n) => M(n).makesContact === false && (M(n).tags ?? []).includes("비접촉") && !(M(n).tags ?? []).includes("접촉")), json(NONCONTACT.map((n) => [n, M(n).makesContact, M(n).tags])));
  check("D3-fix2 데이터: 지구던지기 = 접촉(필드·태그)", M("지구던지기").makesContact === true && (M("지구던지기").tags ?? []).includes("접촉"), json([M("지구던지기").makesContact, M("지구던지기").tags]));
  check("D3-fix2 데이터: 날개치기 makesContact true", M("날개치기").makesContact === true);
  { const all = JSON.parse(readFileSync(new URL("../../src/data/moves.json", import.meta.url), "utf8"));
    const bad = all.filter((m) => { const t = m.tags ?? []; return (t.includes("접촉") || t.includes("비접촉")) && (m.makesContact ?? false) !== t.includes("접촉"); }).map((m) => m.name);
    check("D3-fix2 데이터: tags 접촉/비접촉 ↔ makesContact 어긋난 기술 0건", bad.length === 0, json(bad));
    let audit = null; try { audit = await import(new URL("../move-effect-audit.mjs", import.meta.url)); } catch { /* 아래 검사가 실패로 드러낸다 */ }
    const fake = { name: "가짜", effect: "", tags: ["접촉"], makesContact: false };
    check("D3-fix2 K5: auditMoveEffect가 접촉 태그 ↔ 필드 불일치를 K5로 잡는다", !!audit && audit.auditMoveEffect(fake).some((f) => f.kind === "K5") && audit.auditMoveEffect({ ...fake, makesContact: true }).every((f) => f.kind !== "K5"), json(audit?.auditMoveEffect(fake)));
    check("D3-fix2 K5: 실제 기술 전체에서 K5 0건", !!audit && all.every((m) => audit.auditMoveEffect(m).every((f) => f.kind !== "K5")), "") }

  // ── 공통 실행기: 지정한 횟수만큼 같은 행동으로 턴을 돌린다(불새는 2턴 기술) ──
  const ATK = "한카리아스", DEF = "잠만보";
  const go = ({ move, aAbility = null, bAbility = null, bItem = null, bMove = IDLE, turns = 1, guardOnLast = false, atkPts = strong }) => {
    let st = battle([mon(ATK, [move], aAbility, null, atkPts)], [mon(DEF, [bMove], bAbility, bItem, bulky)]);
    const hpA = st.a.currentHp, hpB = st.b.currentHp, maxA = st.a.maxHp;
    let act = null;
    for (let i = 1; i <= turns; i++) {
      const bm = guardOnLast && i < turns ? IDLE : bMove; // 방어류는 막을 턴(마지막)에만 쓴다
      const o = rt.runTurn(st, mv(move), mv(bm), () => 0.5);
      act = (o.result ?? o.partialResult).actions.find((x) => x.actor === "a");
      st = o.nextState;
    }
    return { act, n: st, lossA: hpA - st.a.currentHp, dealt: hpB - st.b.currentHp, maxA };
  };
  // 충전 기술은 2턴째가 공격 턴이다. 불새는 현재 엔진에 chargeTurn이 없어 1턴 기술로 돈다(Showdown은 2턴 — 백로그 한계, 이 PR 범위 밖). 고쳐지면 2턴으로 자동 전환된다.
  const turnsOf = (move) => (M(move).chargeTurn ? 2 : 1);
  const both = (move, over = {}) => go({ move, turns: turnsOf(move), ...over });
  const guarded = (move, guard, over = {}) => go({ move, turns: turnsOf(move), bMove: guard, guardOnLast: true, ...over });

  // ── 접촉 반응(까칠한피부) ──
  for (const mvName of NONCONTACT) { const r = both(mvName, { bAbility: "까칠한피부" }); check(`D3-fix2 접촉 반응: ${mvName} vs 까칠한피부 → 사용자 피해 없음(비접촉)`, r.dealt > 0 && r.lossA === 0, json({ dealt: r.dealt, loss: r.lossA })); }
  { const r = both("지구던지기", { bAbility: "까칠한피부" });
    check("D3-fix2 접촉 반응: 지구던지기 vs 까칠한피부 → 사용자 최대 HP 1/8 피해(고정 데미지여도 발동)", r.dealt === 50 && r.lossA === Math.floor(r.maxA / 8), json({ dealt: r.dealt, loss: r.lossA, maxA: r.maxA })); }
  { const r = both("지구던지기", { bItem: "울퉁불퉁멧" });
    check("D3-fix2 접촉 반응: 지구던지기 vs 울퉁불퉁멧 → 사용자 최대 HP 1/6 피해", r.lossA === Math.floor(r.maxA / 6), json({ loss: r.lossA, maxA: r.maxA })); }
  { const r = both("바늘미사일", { bAbility: "까칠한피부" }), r2 = both("바늘미사일", { bItem: "울퉁불퉁멧" });
    check("D3-fix2 접촉 반응(연속기): 바늘미사일 vs 까칠한피부·울퉁불퉁멧 → 타수와 무관하게 반응 없음", r.lossA === 0 && r2.lossA === 0 && r.act.hits.length > 1, json({ hits: r.act.hits.length, a: r.lossA, b: r2.lossA })); }
  { const r = both("지구던지기", { aAbility: "원격", bAbility: "까칠한피부" });
    check("D3-fix2 원격: 지구던지기 + 원격 vs 까칠한피부 → 반응 없음", r.dealt === 50 && r.lossA === 0, json({ dealt: r.dealt, loss: r.lossA })); }

  // ── 복슬복슬·파동의방호(방어 ×2, 접촉 한정) ──
  for (const ab of ["복슬복슬", "파동의방호"]) for (const mvName of ["트림", "불새", "바늘미사일"]) {
    const w = both(mvName, { bAbility: ab }), n = both(mvName);
    check(`D3-fix2 ${ab}: ${mvName}(비접촉)은 절반이 되지 않는다 — 특성 없는 상대와 같은 데미지`, w.dealt === n.dealt && w.dealt > 0, `${w.dealt} / ${n.dealt}`);
  }
  { const w = both("대격분", { bAbility: "복슬복슬" }), n = both("대격분");
    check("D3-fix2 복슬복슬: 대격분 vs 복슬복슬 → 불꽃 ×2만 적용(접촉 ×0.5 없음) — 특성 없는 상대의 약 2배", n.dealt > 0 && w.dealt >= 1.9 * n.dealt && w.dealt <= 2.1 * n.dealt, `${w.dealt} / ${n.dealt}`);
    const p = both("대격분", { bAbility: "파동의방호" });
    check("D3-fix2 파동의방호: 대격분 vs 파동의방호 → 절반 없음(특성 없는 상대와 같음)", p.dealt === n.dealt, `${p.dealt} / ${n.dealt}`); }
  for (const ab of ["복슬복슬", "파동의방호"]) { const r = both("지구던지기", { bAbility: ab }); check(`D3-fix2 ${ab}: 지구던지기 vs ${ab} → 50 그대로(고정 데미지는 보정 단계를 건너뜀)`, r.dealt === 50, `${r.dealt}`); }
  { const w = go({ move: "아이언헤드", bAbility: "복슬복슬" }), n = go({ move: "아이언헤드" });
    check("D3-fix2 복슬복슬: 대조 — 접촉기(아이언헤드)는 여전히 절반", w.dealt < n.dealt && w.dealt > 0, `${w.dealt} / ${n.dealt}`); }

  // ── 단단한발톱(접촉기 위력 ×1.3) ──
  for (const mvName of ["불새", "바늘미사일"]) { const w = both(mvName, { aAbility: "단단한발톱" }), n = both(mvName);
    check(`D3-fix2 단단한발톱: ${mvName}(비접촉)은 ×1.3을 받지 않는다 — 특성 없는 사용자와 같은 데미지`, w.dealt === n.dealt && w.dealt > 0, `${w.dealt} / ${n.dealt}`); }
  { const r = both("지구던지기", { aAbility: "단단한발톱" });
    check("D3-fix2 단단한발톱: 지구던지기 + 단단한발톱 → 50 그대로(고정 데미지)", r.dealt === 50, `${r.dealt}`);
    const w = go({ move: "아이언헤드", aAbility: "단단한발톱" }), n = go({ move: "아이언헤드" });
    check("D3-fix2 단단한발톱: 대조 — 접촉기(아이언헤드)는 여전히 ×1.3", w.dealt > n.dealt, `${w.dealt} / ${n.dealt}`); }

  // ── 방어류(막혔을 때의 접촉 반응) ──
  for (const mvName of ["트림", "불새", "대격분", "바늘미사일"]) { const r = guarded(mvName, "니들가드");
    check(`D3-fix2 방어류: ${mvName} vs 니들가드 → 막힘, 사용자 피해 없음(비접촉)`, r.act.blockedByProtectMoveName === "니들가드" && r.dealt === 0 && r.lossA === 0, json({ br: r.act.blockedByProtectMoveName, dealt: r.dealt, loss: r.lossA })); }
  { const r = guarded("지구던지기", "킹실드");
    check("D3-fix2 방어류: 지구던지기 vs 킹실드 → 막힘, 사용자 공격 −1", r.act.blockedByProtectMoveName === "킹실드" && r.dealt === 0 && r.n.a.stages.atk === -1, json({ br: r.act.blockedByProtectMoveName, atk: r.n.a.stages.atk }));
    const n = guarded("지구던지기", "니들가드");
    check("D3-fix2 방어류: 지구던지기 vs 니들가드 → 막힘, 사용자 최대 HP 1/8 피해", n.act.blockedByProtectMoveName === "니들가드" && n.lossA === Math.floor(n.maxA / 8), json({ loss: n.lossA, maxA: n.maxA }));
    const t = guarded("지구던지기", "토치카");
    check("D3-fix2 방어류: 지구던지기 vs 토치카 → 막힘, 사용자 독", t.act.blockedByProtectMoveName === "토치카" && t.n.a.status.condition === "poison", json(t.n.a.status)); }

  // ── 방어 관통(관통드릴: 접촉기만 방어류를 뚫는다 — 시험 전용 조합, 실전에는 없다) ──
  for (const mvName of NONCONTACT) { const r = guarded(mvName, "방어", { aAbility: "관통드릴" });
    check(`D3-fix2 방어 관통: ${mvName} + 관통드릴 vs 방어 → 막힘(비접촉)`, r.act.blockedByProtectMoveName === "방어" && r.dealt === 0, json({ br: r.act.blockedByProtectMoveName, dealt: r.dealt })); }
  { const r = guarded("지구던지기", "방어", { aAbility: "관통드릴" });
    check("D3-fix2 방어 관통: 지구던지기 + 관통드릴 vs 방어 → 막히지 않고 50(×0.25 없음, B9 규칙)", !r.act.blockedByProtectMoveName && r.dealt === 50, json({ br: r.act.blockedByProtectMoveName, dealt: r.dealt })); }
}
