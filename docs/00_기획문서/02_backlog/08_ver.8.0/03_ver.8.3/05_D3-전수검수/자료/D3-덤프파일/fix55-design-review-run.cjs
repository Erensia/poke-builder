// fix-55 검수: Showdown 965a535 — 교체 직후 설치물 기절 턴의 상대 행동·잔류·대체 시점
// node fix55-review-run.cjs  (pokemon-showdown 965a535을 /home/claude/ps 에 빌드)
const {Battle} = require('/home/claude/ps/dist/sim/battle.js');
const P = (species, moves, x = {}) => ({name: x.name || species, species, moves, ability: x.ability || 'noability', item: x.item || '', evs: {hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84}, level: 50, ...x});
const lax = (n, moves = ['tackle'], x = {}) => P('Snorlax', moves, {name: n, ...x});
const low = b => { b.p1.addSideCondition('stealthrock', b.p2.active[0]); b.p1.pokemon[1].hp = 1; };
function run(title, {p1, p2, steps}) {
  const b = new Battle({formatid: 'gen9customgame', seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {team: p1 || [lax('A'), lax('Spare1'), lax('C')]}); b.setPlayer('p2', {team: p2});
  b.makeChoices('default', 'default');
  let start = b.log.length;
  for (const s of steps) {
    if (typeof s === 'function') { s(b); continue; }
    if (s === 'mark') { start = b.log.length; continue; }
    try { b.makeChoices(s[0], s[1]); } catch (e) { console.log('  !choice error', s, e.message); break; }
  }
  console.log('\n=== ' + title);
  for (const l of b.log.slice(start)) if (!/^\|(t:|split|upkeep|)\|/.test(l) && l !== '|' && !l.startsWith('|request')) console.log('  ' + l);
  const s = x => `${x.side.id}:${x.name} ${x.hp}/${x.maxhp} st=${x.status || '-'} vol=[${Object.keys(x.volatiles)}] boosts=${JSON.stringify(Object.fromEntries(Object.entries(x.boosts).filter(([, v]) => v)))}`;
  console.log('  >> ' + s(b.p1.active[0]) + ' | ' + s(b.p2.active[0]) + ` | p1 side=[${Object.keys(b.p1.sideConditions)}] p2 side=[${Object.keys(b.p2.sideConditions)}] p1 slot=[${Object.keys(b.p1.slotConditions[0])}] request=${b.p1.requestState}/${b.p2.requestState}`);
  return b;
}
const T = (m) => [['switch 2', m], 'mark']; // 표준 장면 앞부분
const after = (b) => ['switch 3', ''];

// R-1 씨뿌리기: p1 A가 먼저 p2에 씨앗 → 교체·기절 → p2가 씨앗 피해를 받는가
run('R1 leechseed source slot fainted', {p1: [lax('A', ['leechseed']), lax('Spare1'), lax('C')], p2: [P('Mew', ['splash', 'recover'])],
  steps: [['move 1', 'move 1'], low, 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
// R-2 희망사항: p1 A가 T1 희망사항 → T2 끝 회복 시점에 슬롯 비어 있음
run('R2 wish lands on fainted slot', {p1: [lax('A', ['wish']), lax('Spare1'), lax('C')], p2: [P('Mew', ['splash'])],
  steps: [['move 1', 'move 1'], low, b => { b.p1.pokemon[2].hp = 50; }, 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
// R-3 미래예지: p2 T1 사용 → T3 끝 착탄, T3에 p1 교체·기절
run('R3 future sight lands on fainted slot', {p2: [P('Mew', ['futuresight', 'splash'])],
  steps: [['move 1', 'move 1'], ['move 1', 'move 2'], low, 'mark', ['switch 2', 'move 2'], ['switch 3', '']]});
// R-4 멸망의노래(all)
run('R4 perish song', {p2: [P('Mew', ['perishsong'])], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
// R-5 저주(고스트 사용자)
run('R5 curse by ghost', {p2: [P('Gengar', ['curse'])], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
// R-6 록온 / 문어굳히기 / 하품 / 날려버리기
for (const mv of ['lockon', 'octolock', 'yawn', 'whirlwind', 'defog', 'rapidspin', 'futuresight'])
  run('R6 ' + mv, {p2: [P('Mew', [mv])], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
// R-7 압정뿌리기·독압정·끈적끈적네트(상대 필드) → 대체가 턴 끝에 새 설치물을 밟는가
for (const mv of ['spikes', 'toxicspikes', 'stickyweb'])
  run('R7 ' + mv, {p2: [P('Mew', [mv])], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
// R-8 코트체인지(all)
run('R8 courtchange', {p2: [P('Mew', ['courtchange'])], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', '']]});
// R-9 자기 교체기: 배턴터치·썰렁개그 — 상대 슬롯이 비어 있어도 실행·턴 중 교체 요청?
for (const mv of ['batonpass', 'chillyreception', 'uturn', 'partingshot'])
  run('R9 ' + mv, {p2: [P('Mew', [mv]), P('Mew', ['splash'], {name: 'Mew2'})], steps: [low, 'mark', ['switch 2', 'move 1'], ['', 'switch 2'], ['switch 3', ''], ['switch 3', 'switch 2']]});
// R-10 대폭발(자기 기절 기술)·길동무
for (const mv of ['explosion', 'memento', 'destinybond'])
  run('R10 ' + mv, {p2: [P('Mew', [mv]), P('Mew', ['splash'], {name: 'Mew2'})], steps: [low, 'mark', ['switch 2', 'move 1'], ['switch 3', 'switch 2'], ['switch 3', '']]});
// R-11 행동 순서 관문: 잠듦 카운터·혼란 자해·PP·구애 고정·이전 턴 결과(분노의앞니류)
run('R11a sleep counter', {p2: [P('Mew', ['tackle'])], steps: [low, b => { b.p2.active[0].setStatus('slp'); b.p2.active[0].statusState.startTime = 3; b.p2.active[0].statusState.time = 3; }, 'mark', ['switch 2', 'move 1'], b => console.log('  [slp time after]', b.p2.active[0].statusState.time), ['switch 3', '']]});
run('R11b confusion', {p2: [P('Mew', ['tackle'])], steps: [low, b => { b.p2.active[0].addVolatile('confusion'); b.p2.active[0].volatiles.confusion.time = 5; }, 'mark', ['switch 2', 'move 1'], b => console.log('  [confusion time after]', b.p2.active[0].volatiles.confusion?.time), ['switch 3', '']]});
run('R11c choice/pp/lastmove', {p2: [P('Mew', ['tackle', 'splash'], {item: 'choicescarf'})], steps: [low, 'mark', ['switch 2', 'move 1'], b => { const m = b.p2.active[0]; console.log('  [pp]', m.moveSlots[0].pp, '/', m.moveSlots[0].maxpp, 'lastMove', m.lastMove?.id, 'moveThisTurnResult', m.moveThisTurnResult, 'moveLastTurnResult(next)', 'choicelock', m.volatiles.choicelock?.move); }, ['switch 3', '']]});
// R-3b 미래예지를 빈 자리에 써도 성공 → 2턴 뒤 그 자리의 대체가 맞는가
run('R3b future sight cast at fainted slot, lands on replacement', {p2: [P('Mew', ['futuresight', 'splash'])],
  steps: [low, ['switch 2', 'move 1'], ['switch 3', ''], 'mark', ['move 1', 'move 2'], ['move 1', 'move 2']]});
