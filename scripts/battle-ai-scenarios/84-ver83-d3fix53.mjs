// 8.3 D3-fix-53 (E8-44 + 검수 R1~R6) 싱크로: 보유자가 공격측일 때 방어측 효과(접촉 반응·부리캐논·토치카)로 걸린 상태이상도
// 그 효과의 주인에게 되돌린다. 복사된 상태이상에는 대상의 회복 열매가 즉시 반응하고, 내던지기도 출처다(기존 방향).
// 설계 `8.3-D3-fix53-싱크로설계.md` §3, 검수 `…-검수.md`(R1~R6, Showdown 장면 `fix53-review-run.cjs`·`fix53-recheck-run.cjs`).
export default async function ({ server, data, mon, battle, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const mv = (x) => ({ kind: "move", move: data.getMove(x) });
  const NOP = "잠꼬대";
  const rnd = () => 0;
  const guard = (name, fn) => { try { const r = fn(); check(name, r === true, r === true ? "" : String(r)); } catch (e) { check(name, false, `예외: ${e.message}`); } };
  const SYNC = "싱크로";
  const BENCH = () => mon("잠만보", [NOP]);
  // a(p1) 싱크로 공격측이 am을, b가 bm을 쓴다. 결과: 다음 상태와 a의 행동 로그.
  const go = ({ aId = "잠만보", aItem = null, aAb = SYNC, bId = "잠만보", bAb = "두꺼운지방", bItem = null, bMoves = [NOP], am, bm = NOP, prep }) => {
    const st = battle([mon(aId, [am, NOP], aAb, aItem), BENCH()], [mon(bId, bMoves, bAb, bItem), BENCH()]);
    prep?.(st);
    const o = rt.runTurn(st, mv(am), mv(bm), rnd);
    const ns = o.nextState ?? o.partialResult;
    return { st: ns, act: o.result.actions.find((x) => x.actor === "a") };
  };
  const eq = (got, want) => JSON.stringify(got) === JSON.stringify(want) ? true : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`;
  const conds = (st) => [st.a.status.condition ?? null, st.b.status.condition ?? null];
  const withRandomStatuses = (list, fn) => { // 포자: 난수 0이 첫 후보를 고르므로 후보를 한 종으로 좁혀 장면을 고정한다
    const t = data.getAbility("포자").hitTrigger; const saved = t.inflictsRandomStatusOnAttacker;
    t.inflictsRandomStatusOnAttacker = list;
    try { return fn(); } finally { t.inflictsRandomStatusOnAttacker = saved; }
  };

  // 1 접촉 반응(정전기·불꽃몸·독가시) — 방어측도 같은 상태이상
  for (const [ab, want] of [["정전기", "paralysis"], ["불꽃몸", "burn"], ["독가시", "poison"]]) {
    guard(`D3-fix53 1: 싱크로 공격측 × 방어측 ${ab} + 아이언헤드 — 둘 다 ${want}`, () => eq(conds(go({ bAb: ab, am: "아이언헤드" }).st), [want, want]));
  }
  // 2·3 포자
  guard("D3-fix53 2: 포자(독) — 둘 다 독", () => withRandomStatuses(["poison"], () => eq(conds(go({ bAb: "포자", am: "아이언헤드" }).st), ["poison", "poison"])));
  guard("D3-fix53 2: 포자(마비) — 둘 다 마비", () => withRandomStatuses(["paralysis"], () => eq(conds(go({ bAb: "포자", am: "아이언헤드" }).st), ["paralysis", "paralysis"])));
  guard("D3-fix53 3: 포자(잠듦) — 보유자만 잠듦, 방어측 무상태", () => withRandomStatuses(["sleep"], () => eq(conds(go({ bAb: "포자", am: "아이언헤드" }).st), ["sleep", null])));
  // 4 하바네로분출(비접촉으로도 화상) — 메가스코빌런은 불꽃 타입이라 면역이므로 잠만보에 능력만 준다(규칙 시험)
  guard("D3-fix53 4: 하바네로분출 × 물의파동(비접촉) — 둘 다 화상", () => eq(conds(go({ bAb: "하바네로분출", am: "물의파동" }).st), ["burn", "burn"]));
  // 5 부리캐논: 선공 접촉기로 때리면 보유자가 화상 → 부리캐논 사용자에게도 화상
  guard("D3-fix53 5: 부리캐논 선공 접촉기 — 둘 다 화상", () => eq(conds(go({ bId: "왕큰부리", bMoves: ["부리캐논", NOP], am: "전광석화", bm: "부리캐논" }).st), ["burn", "burn"]));
  // 6 다단(더블어택 × 정전기): 방어측 마비 1회, 로그는 걸린 타에 1줄
  guard("D3-fix53 6: 더블어택 × 정전기 — 방어측 마비, 로그 이벤트 1회", () => {
    const { st, act } = go({ bAb: "정전기", am: "더블어택" });
    const n = (act.hits ?? []).filter((h) => h.abilityEvent?.sync).length;
    return st.b.status.condition === "paralysis" && n === 1 ? true : `b=${st.b.status.condition} syncEvents=${n}`;
  });
  // 7~10 막힘
  guard("D3-fix53 7: 방어측이 전기 타입(라이츄 정전기) — p1 마비, p2 무상태", () => eq(conds(go({ bId: "라이츄", bAb: "정전기", am: "아이언헤드" }).st), ["paralysis", null]));
  guard("D3-fix53 8: 방어측 이미 독 × 불꽃몸 — p1 화상, p2 독 유지", () => eq(conds(go({ bAb: "불꽃몸", am: "아이언헤드", prep: (s) => { s.b.status = { condition: "poison" }; } }).st), ["burn", "poison"]));
  guard("D3-fix53 9: 방어측 신비의부적 — p1 마비, p2 무상태", () => eq(conds(go({ bAb: "정전기", am: "아이언헤드", prep: (s) => { s.sideB.safeguardTurnsRemaining = 5; } }).st), ["paralysis", null]));
  guard("D3-fix53 10: 방어측 HP 1(기절) × 정전기 — p1 마비, 싱크로 로그 없음", () => {
    const { st, act } = go({ bAb: "정전기", am: "아이언헤드", prep: (s) => { s.b.currentHp = 1; } });
    return st.a.status.condition === "paralysis" && !st.b.status.condition && !act.synchronizedOnDefender ? true : JSON.stringify({ a: st.a.status.condition, b: st.b.status.condition, l: act.synchronizedOnDefender });
  });
  // 11 로그 필드
  guard("D3-fix53 11: 정전기 단타 — 로그 synchronizedOnDefender = 마비·싱크로·hitTrigger", () => {
    const { act } = go({ bAb: "정전기", am: "아이언헤드" }); const s = act.synchronizedOnDefender;
    return s && s.status === "paralysis" && s.abilityName === SYNC && s.source === "hitTrigger" ? true : JSON.stringify(s);
  });
  guard("D3-fix53 11: 부리캐논·토치카 — source가 beakBlast·protect", () => {
    const s1 = go({ bId: "왕큰부리", bMoves: ["부리캐논", NOP], am: "전광석화", bm: "부리캐논" }).act.synchronizedOnDefender;
    const s2 = go({ bMoves: ["토치카", NOP], am: "아이언헤드", bm: "토치카" }).act.synchronizedOnDefender;
    return s1?.source === "beakBlast" && s2?.source === "protect" ? true : JSON.stringify([s1, s2]);
  });
  // 12 회귀 — 방어측 보유자 방향(열매가 없을 때 불변)
  guard("D3-fix53 12: (기존 방향) 방어측 싱크로 × 전기자석파 — 둘 다 마비", () => eq(conds(go({ aAb: "두꺼운지방", bAb: SYNC, am: "전기자석파" }).st), ["paralysis", "paralysis"]));
  guard("D3-fix53 12: (기존 방향) 최면술 잠듦은 복사 안 함", () => eq(conds(go({ aAb: "두꺼운지방", bAb: SYNC, am: "최면술" }).st), [null, "sleep"]));
  // 13 R1 방어측 리샘열매 + 정전기: 복사 → 즉시 치료·열매 소모
  guard("D3-fix53 13: 방어측 리샘열매 + 정전기 — p1 마비, p2 복사 뒤 즉시 치료·열매 소모, 로그에 열매", () => {
    const { st, act } = go({ bAb: "정전기", bItem: "리샘열매", am: "아이언헤드" }); const s = act.synchronizedOnDefender;
    return st.a.status.condition === "paralysis" && !st.b.status.condition && st.b.itemConsumed && s?.curedItemName === "리샘열매" ? true : JSON.stringify({ a: st.a.status.condition, b: st.b.status.condition, c: st.b.itemConsumed, s });
  });
  // 14·15 R1·R3 왕큰부리 부리캐논 위력
  const beak = (bItem) => { const { st } = go({ bId: "왕큰부리", bItem, bMoves: ["부리캐논", NOP], am: "전광석화", bm: "부리캐논" }); return st; };
  guard("D3-fix53 14·15: 왕큰부리 부리캐논 — 열매 없으면 화상(위력 반감), 리샘열매면 치료돼 위력 정상", () => {
    const burned = beak(null), cured = beak("리샘열매");
    const lossBurn = burned.a.maxHp - burned.a.currentHp, lossCured = cured.a.maxHp - cured.a.currentHp;
    if (burned.b.status.condition !== "burn" || cured.b.status.condition) return `상태 b=${burned.b.status.condition}/${cured.b.status.condition}`;
    return lossBurn < lossCured * 0.75 ? true : `손실 화상 ${lossBurn} vs 열매 ${lossCured}`;
  });
  // 16 토치카
  guard("D3-fix53 16: 토치카 + 접촉기 — 둘 다 독", () => eq(conds(go({ bMoves: ["토치카", NOP], am: "아이언헤드", bm: "토치카" }).st), ["poison", "poison"]));
  // 17 R2 내던지기(기존 방향): 던진 쪽이 상대에게 걸린 상태이상을 되돌려 받는다
  for (const [item, want] of [["전기구슬", "paralysis"], ["독바늘", "poison"]]) {
    guard(`D3-fix53 17: (기존 방향) 내던지기 ${item} → 방어측 싱크로 — 둘 다 ${want}`, () => eq(conds(go({ aAb: "두꺼운지방", aItem: item, bAb: SYNC, am: "내던지기" }).st), [want, want]));
  }
  // 18 R1 (기존 방향) 공격측 리샘열매 + 전기자석파 → 방어측 싱크로: 공격측 즉시 치료
  guard("D3-fix53 18: (기존 방향) 공격측 리샘열매 + 전기자석파 → 방어측 싱크로 — 공격측 마비 즉시 치료·열매 소모", () => {
    const { st, act } = go({ aAb: "두꺼운지방", aItem: "리샘열매", bAb: SYNC, am: "전기자석파" });
    return st.b.status.condition === "paralysis" && !st.a.status.condition && st.a.itemConsumed && act.synchronizedAttackerCuredItemName === "리샘열매" ? true : JSON.stringify({ a: st.a.status.condition, b: st.b.status.condition, c: st.a.itemConsumed, n: act.synchronizedAttackerCuredItemName });
  });
  // 19 보유자 자신이 리샘열매: 복사는 일어난다(보유자 치료는 이 시험 범위 밖)
  guard("D3-fix53 19: 보유자 자신이 리샘열매 + 정전기 — 방어측 마비 복사는 일어남", () => go({ aItem: "리샘열매", bAb: "정전기", am: "아이언헤드" }).st.b.status.condition === "paralysis" ? true : "복사 없음");
  // 20 독 타입 보유자 상대(라플레시아 포자 독) — 복사 면역
  guard("D3-fix53 20: 라플레시아 포자(독) — p1 독, p2 무상태(면역)", () => withRandomStatuses(["poison"], () => eq(conds(go({ bId: "라플레시아", bAb: "포자", am: "아이언헤드" }).st), ["poison", null])));
}
