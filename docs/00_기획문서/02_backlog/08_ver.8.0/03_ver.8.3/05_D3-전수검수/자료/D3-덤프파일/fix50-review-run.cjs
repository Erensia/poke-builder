// fix-50 설계서 검수 — 프레셔 PP 추가 차감 전수 실측. Showdown 965a535, gen9championsbssregmc.
// 사용법: node fix50-review-run.cjs <showdown 빌드 폴더> [--csv]
// 챔피언스 합법 기술 515종 각각을 프레셔 앱솔 상대로 1회 사용해 PP 감소량을 재고, 설계서 부록 A 분류(면제 79종 = −1, 나머지 −2)와 대조한다.
const PS = process.argv[2];
const {Battle, Teams, Dex} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc'; const dex = Dex.forFormat(Dex.formats.get(F));
const set = (sp, ab, item, moves) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\nLevel: 50\n${moves.map(m => '- ' + m).join('\n')}`;
const FOE = set('Absol', 'Pressure', '', ['Splash']);
const NOP = set('Absol', 'Justified', '', ['Splash']);
const EXEMPT_A = new Set(['Baneful Bunker', 'Clangorous Soul', 'Growth', "King's Shield", 'No Retreat', 'Power Shift', 'Protect', 'Spiky Shield', 'Stuff Cheeks', 'Wish', 'Acid Armor', 'Agility', 'Ally Switch', 'Amnesia', 'Aqua Ring', 'Baton Pass', 'Belly Drum', 'Bulk Up', 'Calm Mind', 'Charge', 'Coil', 'Copycat', 'Cosmic Power', 'Cotton Guard', 'Destiny Bond', 'Detect', 'Double Team', 'Dragon Dance', 'Endure', 'Focus Energy', 'Follow Me', 'Healing Wish', 'Ingrain', 'Iron Defense', 'Magnet Rise', 'Minimize', 'Moonlight', 'Morning Sun', 'Nasty Plot', 'Power Trick', 'Quiver Dance', 'Rage Powder', 'Recover', 'Recycle', 'Rest', 'Revival Blessing', 'Rock Polish', 'Roost', 'Shed Tail', 'Shell Smash', 'Shelter', 'Shift Gear', 'Slack Off', 'Sleep Talk', 'Soft-Boiled', 'Stockpile', 'Substitute', 'Swallow', 'Swords Dance', 'Synthesis', 'Tidy Up',
  'Aurora Veil', 'Light Screen', 'Magnetic Flux', 'Quick Guard', 'Reflect', 'Safeguard', 'Tailwind', 'Wide Guard',
  'Dragon Cheer', 'Aromatic Mist', 'Coaching', 'Helping Hand', 'Howl', 'Life Dew', 'Milk Drink', 'Acupressure', 'Heal Bell', 'Sticky Web']);
function measure(user, move, foe = FOE, prep) {
  const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {name: 'p1', team: Teams.import(set(user, 'Synchronize', '', [move]))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import(foe)});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
  if (prep) prep(b);
  const s = b.p1.active[0].moveSlots[0]; const p0 = s.pp;
  try { b.makeChoices('move 1', 'move 1'); } catch (e) { return {err: e.message.slice(0, 40)}; }
  return {drop: p0 - s.pp, log: b.log.slice(-12).join(' ')};
}
const ms = dex.moves.all().filter(m => !m.isNonstandard && !m.isZ && !m.isMax);
console.log(`합법 기술 ${ms.length}종, 부록 A ${EXEMPT_A.size}종 (부록 A 중 합법 아님: ${[...EXEMPT_A].filter(n => !ms.some(m => m.name === n)).join(', ') || '없음'})`);
const rows = [], mism = [], odd = [];
for (const m of ms) {
  const r = measure('Mew', m.name); const r0 = measure('Mew', m.name, NOP);
  const extra = r.err || r0.err ? null : r.drop - r0.drop;
  const designExtra = EXEMPT_A.has(m.name) ? 0 : 1;
  rows.push([m.name, m.target, m.flags.mustpressure ? 1 : 0, r0.drop, r.drop, extra]);
  if (extra === null || r0.drop !== 1) odd.push(`${m.name}(${m.target}) base=${r0.drop ?? r0.err} pressure=${r.drop ?? r.err}`);
  else if (extra !== designExtra) mism.push(`${m.name}(${m.target}) 실측 추가 ${extra} / 설계 ${designExtra}`);
}
console.log(`\n[설계 분류와 실측 불일치] ${mism.length}건\n  ` + mism.join('\n  '));
console.log(`\n[기본 PP 감소가 1이 아니거나 오류 — 별도 확인] ${odd.length}건\n  ` + odd.join('\n  '));
// 동적 대상: 저주(고스트/비고스트)
console.log('\n[저주] 비고스트(뮤) 추가', measure('Mew', 'Curse').drop - measure('Mew', 'Curse', NOP).drop, '/ 고스트(팬텀) 추가', measure('Gengar', 'Curse').drop - measure('Gengar', 'Curse', NOP).drop);
// 호출 계열: 잠꼬대
const sleep = b => { const p = b.p1.active[0]; p.setStatus('slp'); p.statusState.time = 3; p.statusState.startTime = 3; };
for (const [lab, calls] of [['상대 대상(깨물어부수기)', ['Sleep Talk', 'Crunch']], ['자기 대상(칼춤)', ['Sleep Talk', 'Swords Dance']], ['상대 진영 설치(스텔스록)', ['Sleep Talk', 'Stealth Rock']], ['상대 진영 끈적끈적네트', ['Sleep Talk', 'Sticky Web']]]) {
  for (const foe of [FOE, NOP]) {
    const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
    b.setPlayer('p1', {name: 'p1', team: Teams.import(set('Mew', 'Synchronize', '', calls))});
    b.setPlayer('p2', {name: 'p2', team: Teams.import(foe)});
    if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
    sleep(b); const s = b.p1.active[0].moveSlots; const p0 = s.map(x => x.pp);
    b.makeChoices('move 1', 'move 1');
    console.log(`[잠꼬대 → ${lab} vs ${foe === FOE ? '프레셔' : '대조'}] 잠꼬대 슬롯 −${p0[0] - s[0].pp}, 호출 기술 슬롯 −${p0[1] - s[1].pp}`);
  }
}
// 호출 계열: 흉내쟁이 — 상대가 먼저 쓴 기술을 따라 함
for (const [lab, foeMove] of [['상대 대상(깨물어부수기)', 'Crunch'], ['자기 대상(칼춤)', 'Swords Dance']]) {
  for (const ab of ['Pressure', 'Justified']) {
    const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
    b.setPlayer('p1', {name: 'p1', team: Teams.import(set('Snorlax', 'Thick Fat', '', ['Copycat']))});
    b.setPlayer('p2', {name: 'p2', team: Teams.import(set('Absol', ab, '', [foeMove]))});
    if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
    const s = b.p1.active[0].moveSlots[0]; const p0 = s.pp; b.makeChoices('move 1', 'move 1');
    console.log(`[흉내쟁이 → ${lab} vs ${ab}] 흉내쟁이 슬롯 −${p0 - s.pp}  ${b.log.filter(l => l.startsWith('|move|p1a')).join(' ')}`);
  }
}
// 행동 불능·대상 없음
{ const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {name: 'p1', team: Teams.import(set('Snorlax', 'Thick Fat', '', ['Tackle']))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import(set('Absol', 'Pressure', '', ['Fake Out']))});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
  const s = b.p1.active[0].moveSlots[0]; const p0 = s.pp; b.makeChoices('move 1', 'move 1'); console.log(`[풀죽음으로 행동 불능] PP −${p0 - s.pp}`); }
if (process.argv.includes('--csv')) for (const r of rows) console.log('CSV,' + r.join(','));
