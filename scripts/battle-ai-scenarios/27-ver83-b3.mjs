// 8.3 B3 효과 문구 ↔ 필드 값 대조 점검(scripts/move-effect-audit.mjs, validate-data가 경고로 쓴다): 문구의 숫자(확률·분수·타수·랭크)가 기술 필드와 다르면 걸러낸다.
// 순수 함수라 합성 기술 객체로 규칙(K1a·K1b·K1c·K2·K3·K4)·허용 목록을 시험하고, 마지막에 실제 moves.json 전수가 허용 목록 적용 뒤 경고 0건인지 본다.
// 설계 `8.3-B3-미배선감사설계.md`, 검수 `8.3-B3-미배선감사설계-검수.md`
import { readFileSync } from "node:fs";
export default async function ({ check }) {
  let audit = null;
  try { audit = await import(new URL("../move-effect-audit.mjs", import.meta.url)); } catch (e) { console.log("[B3] 모듈 로드 실패:", e.message); }
  const json = JSON.stringify;
  const kinds = (m) => { try { return audit.auditMoveEffect(m).map((x) => x.kind); } catch (e) { return ["오류: " + e.message]; } };
  const none = (m) => json(kinds(m)) === "[]";
  const has = (m, k) => kinds(m).includes(k);
  const dmg = { category: "physical", power: 80 };

  // ── B3-a: K1a 확률 값 불일치(아이언헤드 모양) ──
  check("8.3 B3-a: 문구 20% 확률 ↔ chance 30 → K1a", has({ ...dmg, effect: "단단한 머리로 공격한다. 20%의 확률로 상대를 풀죽게 만든다.", inflictsVolatile: [{ volatile: "flinch", target: "opponent", chance: 30 }] }, "K1a"));

  // ── B3-b: K1a 통과(합 규칙·일치) ──
  check("8.3 B3-b: chance 3개 합이 문구와 같으면(트라이어택 모양) 경고 없음", none({ ...dmg, effect: "세 가지 속성으로 공격한다. 20% 확률로 마비, 화상, 얼음 중 하나가 된다.", inflictsStatus: [{ status: "paralysis", chance: 6.67 }, { status: "burn", chance: 6.67 }, { status: "freeze", chance: 6.67 }] }));
  check("8.3 B3-b: 문구 30% ↔ chance 30 → 경고 없음", none({ ...dmg, effect: "공격한다. 30% 확률로 상대를 화상 상태로 만든다.", inflictsStatus: [{ status: "burn", chance: 30 }] }));

  // ── B3-c: K1b 확률 문구인데 필드 없음 / 다른 확률 필드(inflictsRandomStatus·randomDoublePower)는 통과 ──
  check("8.3 B3-c: 30% 확률 문구인데 chance류 필드가 없으면 K1b", has({ ...dmg, effect: "공격한다. 30% 확률로 상대를 독 상태로 만든다." }, "K1b"));
  check("8.3 B3-c: inflictsRandomStatus.chance 30이면 경고 없음(페이탈클로 모양)", none({ ...dmg, effect: "공격한다. 30% 확률로 상대를 독, 마비, 잠듦 중 하나의 상태로 만든다.", inflictsRandomStatus: { chance: 30, statuses: ["poison", "paralysis", "sleep"] } }));
  check("8.3 B3-c: randomDoublePower 30이면 경고 없음(변덕레이저 모양)", none({ ...dmg, effect: "광선을 발사한다. 30%의 확률로 위력이 2배가 된다.", randomDoublePower: 30 }));

  // ── B3-d: K1c 문구에 없는 확률 필드(찬물끼얹기 모양), B3-d2: 확정 효과 chance 100은 제외 ──
  check("8.3 B3-d: chance 30인데 문구에 확률 표현이 없으면 K1c", has({ ...dmg, power: 50, effect: "차가운 물을 끼얹어서 공격한다. 상대의 공격을 1랭크 떨어뜨린다.", statChanges: [{ target: "opponent", stat: "atk", delta: -1 }], inflictsStatus: [{ status: "burn", chance: 30 }] }, "K1c"));
  check("8.3 B3-d2: chance 100(확정 효과)은 문구에 확률이 없어도 경고 없음(킬러스핀의 독 모양)", none({ ...dmg, power: 30, effect: "회전해서 상대를 공격한다. 상대를 독 상태로 만든다.", inflictsStatus: [{ status: "poison", chance: 100 }] }));

  // ── B3-e: K2 분수 불일치(양날박치기 모양) ──
  check("8.3 B3-e: recoilFraction 0.333 ↔ 문구 ½ → K2", has({ ...dmg, power: 150, effect: "박치기를 한다. 자신도 대상에게 준 피해의 ½만큼 반동 피해를 받는다.", recoilFraction: 1 / 3 }, "K2"));

  // ── B3-f: K2 통과 ──
  for (const [label, text, key, val] of [["절반", "준 데미지의 절반만큼 HP를 회복한다.", "drainFraction", 0.5], ["½", "준 피해의 ½만큼 회복한다.", "drainFraction", 0.5], ["¼", "HP의 ¼을 회복한다.", "healsFraction", 0.25], ["50%만큼", "준 데미지의 50%만큼 자신의 HP를 회복한다.", "drainFraction", 0.5], ["3/4", "준 데미지의 3/4만큼 회복한다.", "drainFraction", 0.75], ["1/3", "피해의 1/3만큼 반동을 받는다.", "recoilFraction", 1 / 3]])
    check(`8.3 B3-f: 문구 ${label} ↔ ${key} ${val.toFixed(3)} → 경고 없음`, none({ ...dmg, effect: text, [key]: val }));
  check("8.3 B3-f: 문구에 분수 표현이 아예 없으면 경고 없음(생명의물방울 모양)", none({ category: "status", power: null, effect: "신비한 물을 흩뿌려서 같은 편의 HP를 회복한다.", healsFraction: 0.25 }));

  // ── B3-g: K3 타수 ──
  check("8.3 B3-g: 문구 2~5회 ↔ 필드 2~3 → K3", has({ ...dmg, power: 25, effect: "연속으로 때린다. 2~5회 연속으로 공격한다.", minHits: 2, maxHits: 3 }, "K3"));
  check("8.3 B3-g: 문구 최대 10회 ↔ maxHits 5 → K3", has({ ...dmg, power: 20, effect: "최대 10회 연속으로 공격한다.", minHits: 1, maxHits: 5, multiHitPowers: [20, 20, 20, 20, 20] }, "K3"));
  check("8.3 B3-g: 3회 연속 · maxHits 3 + multiHitPowers(minHits 1) → 경고 없음(트리플악셀 모양)", none({ ...dmg, power: 20, effect: "3회 연속으로 킥을 날려 공격한다. 맞을 때마다 위력이 올라간다.", minHits: 1, maxHits: 3, multiHitPowers: [20, 40, 60] }));
  check("8.3 B3-g: 최대 10회 · maxHits 10 + multiHitPowers → 경고 없음(찍찍베기 모양)", none({ ...dmg, power: 20, effect: "빗나갈 때까지 최대 10회 연속으로 공격한다.", minHits: 1, maxHits: 10, multiHitPowers: new Array(10).fill(20) }));
  check("8.3 B3-g: 2회 연속 · min/maxHits 2 → 경고 없음", none({ ...dmg, power: 35, effect: "꼬리로 때린다. 2회 연속으로 데미지를 준다.", minHits: 2, maxHits: 2 }));
  check("8.3 B3-g: '쓸 수 없'이 있는 '2회 연속'은 건너뜀(트집·거대해머 모양)", none({ category: "physical", power: 160, effect: "휘둘러서 공격한다. 2회 연속으로 쓸 수 없다.", cannotUseConsecutively: true }));

  // ── B3-h: K4 랭크(대상·크기·스탯·방향) ──
  const drop = (over) => ({ category: "status", power: null, effect: "상대의 공격을 1랭크 떨어뜨린다.", statChanges: [{ target: "opponent", stat: "atk", delta: -1 }], ...over });
  check("8.3 B3-h: 대상 틀림(문구 상대 / 필드 self) → K4", has(drop({ statChanges: [{ target: "self", stat: "atk", delta: -1 }] }), "K4"));
  check("8.3 B3-h: 크기 틀림(문구 1랭크 / 필드 −2) → K4", has(drop({ statChanges: [{ target: "opponent", stat: "atk", delta: -2 }] }), "K4"));
  check("8.3 B3-h: 스탯 틀림(문구 공격 / 필드 방어) → K4", has(drop({ statChanges: [{ target: "opponent", stat: "def", delta: -1 }] }), "K4"));
  check("8.3 B3-h: 방향 틀림(문구 떨어뜨린다 / 필드 +1) → K4", has(drop({ statChanges: [{ target: "opponent", stat: "atk", delta: 1 }] }), "K4"));
  check("8.3 B3-h: 일치(대상·크기·스탯·방향)면 경고 없음", none(drop({})));
  check("8.3 B3-h: '공격과 스피드' 복합 스탯도 둘 다 있으면 경고 없음, 하나가 빠지면 K4", none({ category: "status", power: null, effect: "자신의 공격과 스피드를 1랭크 올린다.", statChanges: [{ target: "self", stat: "atk", delta: 1 }, { target: "self", stat: "spe", delta: 1 }] })
    && has({ category: "status", power: null, effect: "자신의 공격과 스피드를 1랭크 올린다.", statChanges: [{ target: "self", stat: "atk", delta: 1 }] }, "K4"));

  // ── B3-i: 허용 목록(auditMoves) ──
  const bad = { name: "가짜기술", ...dmg, effect: "20% 확률로 풀죽게 한다.", inflictsVolatile: [{ volatile: "flinch", target: "opponent", chance: 30 }] };
  const ok = { name: "정상기술", ...dmg, effect: "공격한다." };
  const run = (moves, allow) => { try { return audit.auditMoves(moves, allow); } catch (e) { return { errors: ["오류: " + e.message], warnings: [] }; } };
  { const r0 = run([bad, ok], {}), r1 = run([bad, ok], { 가짜기술: "의도된 불일치" });
    check("8.3 B3-i: 허용 목록에 있으면 경고에서 빠진다(없으면 경고 1건 이상)", r0.warnings.length > 0 && r1.warnings.length === 0 && r1.errors.length === 0, json({ r0: r0.warnings.length, r1 })); }
  { const r = run([bad, ok], { 가짜기술: "  " }); check("8.3 B3-i: 사유가 비어 있는 허용 항목은 오류(사유 누락 메시지)", r.errors.length === 1 && r.errors[0].includes("사유"), json(r)); }
  { const r = run([bad, ok], { 가짜기술: "사유", 정상기술: "안 걸리는데 허용됨" }); check("8.3 B3-i: 더 이상 걸리지 않는 허용 항목은 stale 경고", r.warnings.some((w) => w.includes("정상기술") && w.includes("stale")) && r.errors.length === 0, json(r)); }

  // ── B3-j: 입력 불변 ──
  { const frozen = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && frozen(v)); return Object.freeze(o); };
    let threw = false, r = [];
    try { r = audit.auditMoveEffect(frozen(JSON.parse(json(bad)))); } catch { threw = true; }
    check("8.3 B3-j: 얼린(수정 불가) 기술 객체로도 점검이 돈다(입력을 바꾸지 않는다)", !threw && r.length > 0); }

  // ── B3-m: 실제 moves.json 전수 — 허용 목록 적용 뒤 경고 0건(허용 목록에는 의도된 3건만) ──
  { const moves = Object.values(JSON.parse(readFileSync(new URL("../../src/data/moves.json", import.meta.url), "utf8")));
    const allow = JSON.parse(readFileSync(new URL("../data-allowlist.json", import.meta.url), "utf8")).moveEffectAudit ?? {};
    const r = run(moves, allow);
    check(`8.3 B3-m: 실제 moves.json ${moves.length}건 — 허용 목록(${Object.keys(allow).join("·") || "없음"}) 적용 뒤 경고·오류 0건`, r.warnings.length === 0 && r.errors.length === 0 && json(Object.keys(allow).sort()) === json(["끈적끈적네트", "데코레이션", "킹실드"]), json(r).slice(0, 300)); }
}
