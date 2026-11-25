// E4b-13 실행 대조 (2026-11-20 검수 채팅, Showdown 965a535). 사용: node e4b13-run.js
// 주의: |split 때문에 -damage 줄이 비공개·공개 2줄로 찍히므로 피해 횟수는 /2
const PS = '/home/claude/ref/pokemon-showdown';
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, item, ab, moves) => `${sp} @ ${item}\nAbility: ${ab}\n` + moves.map(m => '- ' + m).join('\n');
const BENCH = '\n\nSnorlax @ Leftovers\nAbility: Thick Fat\n- Splash';
for (const D of [5, 6]) {
  const b = new Battle({formatid: 'gen9championsbssregmc', seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {team: Teams.import(set('Snorlax', 'Leftovers', 'Thick Fat', ['Bind', 'Splash']) + BENCH)});
  b.setPlayer('p2', {team: Teams.import(set('Blissey', 'Leftovers', 'Natural Cure', ['Splash']) + BENCH)});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
  const t = b.p2.active[0];
  const rc = b.randomChance.bind(b), rnd = b.random.bind(b);
  b.randomChance = () => true;                                  // 명중 고정
  b.random = (m, n) => (m === 5 && n === 7 ? D : rnd(m, n));    // 지속 굴림 고정
  let n = b.log.length;
  b.makeChoices('move 1', 'move 1');
  b.randomChance = rc; b.random = rnd;
  const bindDmg = ls => ls.filter(l => /^\|-damage\|p2a: /.test(l) && /partiallytrapped|Bind/.test(l)).length / 2;
  console.log(`\n=== 굴림 ${D} ===`);
  console.log(`T1(걸린 턴): 걸림=${b.log.slice(n).some(l => /-activate\|p2a.*Bind/.test(l))} | 턴종료 속박피해=${bindDmg(b.log.slice(n))} | 남은 dur=${t.volatiles.partiallytrapped?.duration}`);
  let dmg = bindDmg(b.log.slice(n)), trap = 0;
  for (let turn = 2; turn <= 10; turn++) {
    const trapped = !!b.p2.activeRequest?.active?.[0]?.trapped;
    if (!trapped && !t.volatiles.partiallytrapped) { console.log(`T${turn}: 선택시 trapped=false → 교체 가능`); break; }
    if (trapped) trap++;
    n = b.log.length; b.makeChoices('move 2', 'move 1');
    const ls = b.log.slice(n), d = bindDmg(ls); dmg += d;
    console.log(`T${turn}: 선택시 trapped=${trapped} | 턴종료 속박피해=${d} | 해제로그=${ls.some(l => /^\|-end\|p2a.*partiallytrapped/.test(l)) ? 'Y' : '-'} | 남은 dur=${t.volatiles.partiallytrapped?.duration ?? '없음'}`);
  }
  console.log(`합계: 속박 피해 ${dmg}회 / 가둠(교체 불가 선택) ${trap}회`);
}