// fix-21 검수 실행 대조 (2026-11-20, Showdown 965a535). node fix21-run.js
const PS = '/home/claude/ref/pokemon-showdown';
const {Battle, Teams, TeamValidator} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const set = (sp, item, ab, moves) => `${sp} @ ${item}\nAbility: ${ab}\n` + moves.map(m => '- ' + m).join('\n');
const BENCH = '\n\nSnorlax @ Leftovers\nAbility: Thick Fat\n- Splash';
function run(label, atk, def, D) {
  const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {team: Teams.import(atk + BENCH)});
  b.setPlayer('p2', {team: Teams.import(def + BENCH)});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
  const t = b.p2.active[0], rc = b.randomChance.bind(b), rnd = b.random.bind(b);
  b.randomChance = () => true; b.random = (m, n) => (m === 5 && n === 7 && D ? D : rnd(m, n));
  let n = b.log.length; b.makeChoices('move 1', 'move 1'); b.randomChance = rc; b.random = rnd;
  const dur0 = t.volatiles.partiallytrapped ? t.volatiles.partiallytrapped.duration + 1 : '없음';
  const hits = ls => ls.filter(l => /^\|-damage\|p2a: .*partiallytrapped/.test(l)).length / 2;
  let dmg = hits(b.log.slice(n)), trap = 0, endLog = '', free = '';
  for (let turn = 2; turn <= 12; turn++) {
    const tr = !!b.p2.activeRequest?.active?.[0]?.trapped;
    if (!t.volatiles.partiallytrapped && !tr) { free = `T${turn}`; break; }
    if (tr) trap++;
    n = b.log.length; b.makeChoices('move 2', 'move 1');
    const ls = b.log.slice(n); dmg += hits(ls);
    const e = ls.find(l => /^\|-end\|p2a.*partiallytrapped/.test(l)); if (e) endLog = `T${turn}: ${e}`;
  }
  console.log(`[${label}] 걸린 지속=${dur0} 피해=${dmg} 가둠=${trap} 해방=${free} 해제로그=${endLog || '(없음)'}`);
}
const ATK = it => set('Snorlax', it, 'Thick Fat', ['Bind', 'Splash']);
run('기본 D5', ATK('Leftovers'), set('Blissey', 'Leftovers', 'Natural Cure', ['Splash']), 5);
run('매직가드 D5', ATK('Leftovers'), set('Clefable', 'Leftovers', 'Magic Guard', ['Splash']), 5);
run('조임밴드 D5', ATK('Binding Band'), set('Blissey', 'Leftovers', 'Natural Cure', ['Splash']), 5);
run('조임발톱', ATK('Grip Claw'), set('Blissey', 'Leftovers', 'Natural Cure', ['Splash']), 0);
const v = TeamValidator.get(F); const ok = it => !(v.validateTeam(Teams.import(`Snorlax @ ${it}\nAbility: Thick Fat\n- Body Slam`)) || []).some(e => e.includes(it));
for (const it of ['Grip Claw', 'Binding Band', 'Shed Shell']) console.log(`[합법성] ${it}: ${ok(it) ? '사용 가능' : '사용 불가'}`);
// 고스트: 노말 기술 조이기는 무효 → 불꽃소용돌이로
const FS = set('Snorlax', 'Leftovers', 'Thick Fat', ['Fire Spin', 'Splash']);
run('고스트 불꽃소용돌이 D5', FS, set('Gengar', 'Leftovers', 'Cursed Body', ['Splash']), 5);
run('기준 불꽃소용돌이 D5', FS, set('Blissey', 'Leftovers', 'Natural Cure', ['Splash']), 5);