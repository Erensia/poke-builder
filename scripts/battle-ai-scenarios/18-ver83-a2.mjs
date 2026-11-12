// 8.3 A2 돌림노래(R1, Showdown 일치): 같은 턴에 앞서 쓰인 돌림노래가 있으면 뒤에 쓴 쪽 위력 2배(60→120, 누적 없음). 연속 턴 사용 보너스 없음.
// 선행 쪽이 못 움직이면(얼음 등) 2배 아님, 빗나가거나 면역이어도 2배, 교체돼도 2배, 호출 기술(잠꼬대)로 나온 뒤쪽은 1배.
// 설계 `8.3-A2-돌림노래설계.md` §7. (R1-f "방어에 막힘"은 싱글에서 선행 사용자의 대상이 후행 사용자라 방어를 고를 수 없어 시험하지 않는다.)
export default async function ({ server, data, ev, mon, battle, pts, opt, check }) {
  const rt = await server.ssrLoadModule("/src/lib/battle/runTurn.ts");
  const sta = await server.ssrLoadModule("/src/lib/statusConditions.ts");
  const move = (id) => ({ kind: "move", move: data.getMove(id) });
  const rng = () => 0.5;
  const dmg = (r, key) => r.result.actions.find((a) => a.actor === key)?.damage ?? 0;
  const ratio = (d, d0) => d / d0;
  const near2 = (d, d0) => d0 > 0 && ratio(d, d0) > 1.85 && ratio(d, d0) < 2.15;
  const stats = (spe) => pts({ spa: 32, hp: 32, spe });
  // 같은 종·같은 능력치(스피드만 다름)라 데미지를 직접 비교한다
  const fast = (moves = ["돌림노래", "칼춤"], item = null) => mon("잠만보", moves, null, item, stats(32));
  const slow = (moves = ["돌림노래", "칼춤"], item = null) => mon("잠만보", moves, null, item, stats(0));
  const play = (st, a, b) => rt.runTurn(st, move(a), move(b), rng);

  // 대조군: 앞에 돌림노래가 없을 때 후공(b)의 돌림노래 데미지 d0, 선공(a)의 d0
  const d0Later = dmg(play(battle([fast()], [slow()]), "칼춤", "돌림노래"), "b");
  const d0First = dmg(play(battle([fast()], [slow()]), "돌림노래", "칼춤"), "a");

  // R1-a 둘 다 돌림노래, 내(a)가 선공 → 후공(b) 위력 2배, 선공(a)은 60
  {
    const r = play(battle([fast()], [slow()]), "돌림노래", "돌림노래");
    check("8.3 A2 R1-a: 같은 턴 선행 돌림노래 → 후공 2배, 선공 60", near2(dmg(r, "b"), d0Later) && dmg(r, "a") === d0First, `선공=${dmg(r, "a")}/${d0First} 후공=${dmg(r, "b")}/${d0Later}`);
    // R1-d 순서: 우선도 0 그대로, 스피드로만 정해진다(앞당김 없음)
    check("8.3 A2 R1-d: 행동 순서는 스피드 그대로(싱글)", r.result.order[0] === "a" && r.result.order[1] === "b", String(r.result.order));
  }
  // R1-b 연속 두 턴에 a만 돌림노래 → 두 턴 데미지 같음(연속 보너스 없음)
  {
    const r1 = play(battle([fast()], [slow()]), "돌림노래", "칼춤");
    const r2 = play(r1.nextState, "돌림노래", "칼춤");
    check("8.3 A2 R1-b: 연속 턴 사용은 위력이 오르지 않음", dmg(r1, "a") > 0 && dmg(r1, "a") === dmg(r2, "a"), `${dmg(r1, "a")}/${dmg(r2, "a")}`);
  }
  // R1-c 상대(b)가 선공, 둘 다 돌림노래 → 뒤에 쓴 a가 2배
  {
    const aSlow = battle([slow()], [fast()]);
    const ctrl = dmg(play(aSlow, "돌림노래", "칼춤"), "a");
    const r = play(aSlow, "돌림노래", "돌림노래");
    check("8.3 A2 R1-c: 상대가 선공이면 뒤에 쓴 내가 2배", r.result.order[0] === "b" && near2(dmg(r, "a"), ctrl), `순서=${r.result.order} ${dmg(r, "a")}/${ctrl}`);
  }
  // R1-e 선행 상대가 얼음으로 못 움직임 → 내 돌림노래는 60
  {
    const st = battle([slow()], [fast()]);
    st.b.status = sta.inflictStatus(st.b.status, "freeze");
    const ctrl = dmg(play(battle([slow()], [fast()]), "돌림노래", "칼춤"), "a");
    const r = play(st, "돌림노래", "돌림노래");
    check("8.3 A2 R1-e: 선행 쪽이 행동 불능이면 2배 아님", dmg(r, "b") === 0 && dmg(r, "a") === ctrl && ctrl > 0, `상대=${dmg(r, "b")} 내=${dmg(r, "a")}/${ctrl}`);
  }
  // R1-g 선행 상대의 돌림노래가 빗나가도 2배 (명중 랭크 −6, 난수 고정으로 빗나감)
  {
    const st = battle([fast()], [slow()]);
    st.a.accuracyStages = { ...st.a.accuracyStages, accuracy: -6 };
    const r = play(st, "돌림노래", "돌림노래");
    const missed = r.result.actions.find((a) => a.actor === "a")?.hit === false;
    check("8.3 A2 R1-g: 선행 돌림노래가 빗나가도 후공 2배", missed && near2(dmg(r, "b"), d0Later), `빗나감=${missed} 후공=${dmg(r, "b")}/${d0Later}`);
  }
  // R1-h 선행 상대가 내 레드카드로 강제 교체돼도 내 돌림노래는 2배 (마커는 포켓몬이 아니라 배틀 상태)
  {
    const lead = battle([fast(), fast()], [slow(["돌림노래", "칼춤"], "레드카드")]);
    const r = play(lead, "돌림노래", "돌림노래");
    // 대조군: 예비 포켓몬이 처음부터 활성이고 상대는 칼춤 → 내 돌림노래(후공) 데미지
    const ctrl = dmg(play(battle([fast(), fast()], [slow()]), "칼춤", "돌림노래"), "b");
    check("8.3 A2 R1-h: 레드카드로 선행 상대가 교체돼도 2배", r.result.switches.length >= 1 && near2(dmg(r, "b"), ctrl), `교체=${r.result.switches.length} ${dmg(r, "b")}/${ctrl}`);
  }
  // R1-k 선행 상대 돌림노래 → 나는 잠듦+잠꼬대로 호출한 돌림노래: 1배
  {
    const st = battle([fast()], [slow(["잠꼬대", "돌림노래"])]);
    st.b.status = sta.inflictStatus(st.b.status, "sleep");
    const ctrl = battle([fast()], [slow(["잠꼬대", "돌림노래"])]);
    ctrl.b.status = sta.inflictStatus(ctrl.b.status, "sleep");
    const d0 = dmg(play(ctrl, "칼춤", "잠꼬대"), "b");
    const r = play(st, "돌림노래", "잠꼬대");
    check("8.3 A2 R1-k: 호출 기술(잠꼬대)로 나온 뒤쪽 돌림노래는 2배 아님", d0 > 0 && dmg(r, "b") === d0, `${dmg(r, "b")}/${d0}`);
  }
  // R1-l 선행 상대가 잠꼬대로 호출한 돌림노래 → 내 돌림노래는 2배
  {
    const st = battle([fast(["잠꼬대", "돌림노래"])], [slow()]);
    st.a.status = sta.inflictStatus(st.a.status, "sleep");
    const r = play(st, "잠꼬대", "돌림노래");
    check("8.3 A2 R1-l: 선행이 호출한 돌림노래도 후공을 2배로 만든다", dmg(r, "a") > 0 && near2(dmg(r, "b"), d0Later), `선행=${dmg(r, "a")} 후공=${dmg(r, "b")}/${d0Later}`);
  }
  // R1-m 선행 상대의 돌림노래가 고스트(나)에 면역이어도 내 돌림노래는 2배 (팬텀이 더 빠르므로 a의 스피드 랭크를 올려 a를 선공으로 고정)
  {
    const mk = () => {
      const st = battle([fast()], [mon("팬텀", ["돌림노래", "칼춤"], null, null, stats(0))]);
      st.a.stages = { ...st.a.stages, spe: 6 };
      return st;
    };
    const ctrl = dmg(play(mk(), "칼춤", "돌림노래"), "b");
    const r = play(mk(), "돌림노래", "돌림노래");
    check("8.3 A2 R1-m: 선행 돌림노래가 면역이어도 2배", dmg(r, "a") === 0 && near2(dmg(r, "b"), ctrl), `선행=${dmg(r, "a")} 후공=${dmg(r, "b")}/${ctrl}`);
  }

  // AI(R1-i/j): AI가 후공이고 상대가 돌림노래를 쓸 수 있으면 기대 위력이 오른다(처치 턴 감소), 선공이면 무관
  {
    const hits = (aMons, bMons) => opt(ev.evaluateOptions(battle(aMons, bMons), "a"), "돌림노래").hitsToKill.expected;
    const withEcho = hits([slow(["돌림노래"])], [fast(["돌림노래", "칼춤"])]);
    const noEcho = hits([slow(["돌림노래"])], [fast(["누르기", "칼춤"])]);
    check("8.3 A2 R1-i: AI 후공 + 상대가 돌림노래 보유 → 처치 턴 기대치 감소", withEcho < noEcho, `보유=${withEcho.toFixed(2)} 미보유=${noEcho.toFixed(2)}`);
    const firstWith = hits([fast(["돌림노래"])], [slow(["돌림노래", "칼춤"])]);
    const firstNo = hits([fast(["돌림노래"])], [slow(["누르기", "칼춤"])]);
    check("8.3 A2 R1-j: AI 선공이면 상대 돌림노래 유무와 무관", Math.abs(firstWith - firstNo) < 1e-9, `보유=${firstWith.toFixed(2)} 미보유=${firstNo.toFixed(2)}`);
  }
}
