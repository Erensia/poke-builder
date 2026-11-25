// E8-a ④ 등장 시 효과(샘플 16종) — Showdown 965a535, gen9championsbssregmc. 사용법: node e8a4.cjs <showdown 빌드 폴더>
const PS = process.argv[2];
const {Battle, Teams, Dex} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc'; const dex = Dex.forFormat(Dex.formats.get(F));
const set = (sp, ab, item = '', moves = ['Splash']) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\nLevel: 50\n${moves.map(m => '- ' + m).join('\n')}`;
const SNOR = set('Snorlax', 'Thick Fat', '', ['Splash', 'Tackle']);
function mk(p1, p2, b1 = [SNOR], b2 = [SNOR]) {
  const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {name: 'p1', team: Teams.import([p1, ...b1].join('\n\n'))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import([p2, ...b2].join('\n\n'))});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
  return b;
}
const RE = /^\|(switch|move|-ability|-weather|-fieldstart|-fieldend|-boost|-unboost|-immune|-fail|-start|-end|-item|-enditem|-mega|-activate|-block|-miss|-damage|faint|cant)\|/;
const L = (b, n = 0) => b.log.slice(n).filter(l => RE.test(l) && !/\|Splash\|/.test(l) && !/\/100/.test(l)).map(l => l.slice(1).replace(/\|\[of\][^|]*/g, '').replace(/p([12])a: /g, 'p$1:')).join(' / ');
const W = b => `weather=${b.field.weather || '-'}(${b.field.weatherState.duration ?? ''}) terrain=${b.field.terrain || '-'}(${b.field.terrainState.duration ?? ''})`;
const bo = (b, s) => JSON.stringify(b[s].active[0].boosts).replace(/"|[a-z]+:0,?/g, '').replace(/,}/, '}');
const ex = (label, b, extra = '') => console.log(`[${label}] ${L(b)}${extra ? '  ⇒ ' + extra : ''}`);
const step = (b, c1, c2, label, post) => { const n = b.log.length; b.makeChoices(c1, c2); console.log(`  [${label}] ${L(b, n)}${post ? '  ⇒ ' + post(b) : ''}`); };
console.log('합법 도구:', ['Heat Rock', 'Damp Rock', 'Smooth Rock', 'Icy Rock', 'Terrain Extender', 'Grassy Seed', 'Psychic Seed', 'Electric Seed', 'Mental Herb', 'Adrenaline Orb', 'White Herb'].map(i => `${i}:${dex.items.get(i).isNonstandard ? 'X' : 'O'}`).join(' '));

console.log('\n===== W. 날씨 (가뭄·잔비·모래날림·눈퍼뜨리기) =====');
{ const b = mk(set('Torkoal', 'Drought'), set('Pelipper', 'Drizzle')); ex('W1 동시 등장: 가뭄(느림) vs 잔비(빠름)', b, W(b)); }
{ const b = mk(set('Pelipper', 'Drizzle'), set('Torkoal', 'Drought')); ex('W1b 동시 등장: 잔비(빠름) vs 가뭄(느림)', b, W(b)); }
{ const b = mk(set('Tyranitar', 'Sand Stream'), set('Abomasnow', 'Snow Warning')); ex('W1c 모래날림 vs 눈퍼뜨리기', b, W(b));
  for (let t = 1; t <= 5; t++) step(b, 'move 1', 'move 1', `턴${t}`, W); }
for (const [it, ab, sp] of [['Smooth Rock', 'Sand Stream', 'Hippowdon'], ['Heat Rock', 'Drought', 'Torkoal'], ['Damp Rock', 'Drizzle', 'Pelipper'], ['Icy Rock', 'Snow Warning', 'Abomasnow']]) {
  const b = mk(set(sp, ab, it), SNOR); console.log(`[W2 ${ab}+${it}] ${W(b)}`); }
{ const b = mk(set('Hippowdon', 'Sand Stream'), SNOR, [set('Tyranitar', 'Sand Stream')]);
  step(b, 'move 1', 'move 1', '턴1', W); step(b, 'switch 2', 'move 1', '턴2 같은 날씨 특성 재등장', W); }
{ const b = mk(set('Charizard', 'Blaze', 'Charizardite Y', ['Splash']), set('Pelipper', 'Drizzle'));
  step(b, 'move 1 mega', 'move 1', 'W4 메가리자몽Y 메가진화(비 → 가뭄)', W); }
{ const b = mk(set('Tyranitar', 'Sand Stream', 'Tyranitarite', ['Splash']), SNOR, [SNOR], [set('Pelipper', 'Drizzle')]);
  step(b, 'move 1', 'switch 2', '턴1 상대 잔비로 덮음', W); step(b, 'move 1 mega', 'move 1', 'W5 메가마기라스(같은 특성) 메가진화', W); }
{ const b = mk(set('Tyranitar', 'Sand Stream', 'Tyranitarite', ['Splash']), SNOR);
  step(b, 'move 1 mega', 'move 1', 'W6 메가마기라스: 이미 모래바람(턴수 갱신?)', W); }

console.log('\n===== T. 필드 (그래스·사이코·일렉트릭메이커) =====');
{ const b = mk(set('Rillaboom', 'Grassy Surge'), set('Indeedee', 'Psychic Surge')); ex('T1 그래스(느림) vs 사이코(빠름) 동시', b, W(b)); }
{ const b = mk(set('Rillaboom', 'Grassy Surge', 'Terrain Extender'), SNOR); ex('T2 필드연장', b, W(b)); }
{ const b = mk(set('Rillaboom', 'Grassy Surge'), SNOR, [set('Rillaboom', 'Grassy Surge')]);
  for (let t = 1; t <= 2; t++) step(b, 'move 1', 'move 1', `턴${t}`, W); step(b, 'switch 2', 'move 1', '턴3 같은 필드 재등장', W);
  for (let t = 4; t <= 6; t++) step(b, 'move 1', 'move 1', `턴${t}`, W); }
{ const b = mk(set('Indeedee', 'Psychic Surge'), set('Snorlax', 'Thick Fat', 'Psychic Seed')); ex('T3 사이코메이커 vs 상대 사이코시드', b, `p2 ${bo(b, 'p2')} item=${b.p2.active[0].item || '-'}`); }
{ const b = mk(set('Indeedee', 'Psychic Surge', '', ['Splash']), set('Weavile', 'Pressure', '', ['Quick Attack'])); step(b, 'move 1', 'move 1', 'T4 사이코필드 vs 상대 전광석화'); }
{ const b = mk(set('Raichu', 'Static', 'Raichunite X', ['Splash']), set('Pelipper', 'Drizzle')); step(b, 'move 1 mega', 'move 1', 'T5 메가라이츄X 메가진화(일렉트릭메이커)', W); }

console.log('\n===== I. 위협 =====');
const I = set('Gyarados', 'Intimidate', '', ['Splash']);
for (const [lab, foe] of [['일반', SNOR], ['정신력', set('Lucario', 'Inner Focus')], ['오기', set('Kingambit', 'Defiant')], ['승기', set('Milotic', 'Competitive')], ['미러아머', set('Corviknight', 'Mirror Armor')], ['클리어바디', set('Metagross', 'Clear Body')], ['주눅', set('Snorlax', 'Rattled')], ['파수견', set('Mabosstiff', 'Guard Dog')], ['둔감', set('Slowbro', 'Oblivious')], ['마이페이스', set('Slowbro', 'Own Tempo')], ['배짱', set('Kangaskhan', 'Scrappy')], ['상대도 위협', set('Arcanine', 'Intimidate')], ['화이트허브', set('Snorlax', 'Thick Fat', 'White Herb')]]) {
  const b = mk(I, foe); ex(`I1 위협 vs ${lab}`, b, `p1 ${bo(b, 'p1')} p2 ${bo(b, 'p2')} p2item=${b.p2.active[0].item || '-'}`); }
{ const b = mk(SNOR, set('Snorlax', 'Thick Fat', '', ['Substitute', 'Splash']), [I]); step(b, 'move 1', 'move 1', '턴1 상대 대타'); step(b, 'switch 2', 'move 2', 'I2 위협 등장 vs 대타', b => `p2 ${bo(b, 'p2')}`); }
{ const b = mk(set('Manectric', 'Static', 'Manectite', ['Splash']), SNOR); step(b, 'move 1 mega', 'move 1', 'I3 메가썬더볼트 메가진화', b => `p2 ${bo(b, 'p2')}`); }
{ const b = mk(set('Scrafty', 'Intimidate', 'Scraftinite', ['Splash']), SNOR); ex('I4 등장', b, `p2 ${bo(b, 'p2')}`); step(b, 'move 1 mega', 'move 1', 'I4 메가스크래기(같은 위협) 메가진화', b => `p2 ${bo(b, 'p2')}`); }
{ const b = mk(set('Gyarados', 'Intimidate', 'Gyaradosite', ['Splash']), SNOR); ex('I5 갸라도스 등장', b, `p2 ${bo(b, 'p2')}`); step(b, 'move 1 mega', 'move 1', 'I5 메가갸라도스(위협→틀깨기)', b => `p2 ${bo(b, 'p2')} p1ab=${b.p1.active[0].ability}`); }
{ const b = mk(I, SNOR); b.p2.active[0].boosts.atk = -6; const n = b.log.length; b.makeChoices('move 1', 'move 1'); }
{ const b = mk(SNOR, set('Snorlax', 'Thick Fat', '', ['Splash', 'Belly Drum']), [I]); step(b, 'move 1', 'move 1', '턴1');
  b.p2.active[0].boosts.atk = -6; step(b, 'switch 2', 'move 1', 'I6 위협 vs 이미 공격 −6', b => `p2 ${bo(b, 'p2')}`); }

console.log('\n===== P. 프레셔 =====');
const pp = (b, s, i = 0) => b[s].active[0].moveSlots[i].pp;
const PR = set('Absol', 'Pressure', '', ['Splash', 'Protect']);
for (const [lab, mv] of [['데미지 기술', 'Tackle'], ['상대 대상 변화기', 'Growl'], ['자기 대상 변화기', 'Swords Dance'], ['상대 진영 설치기', 'Spikes'], ['필드 기술', 'Rain Dance'], ['빗나감', 'Hypnosis']]) {
  const b = mk(set('Snorlax', 'Thick Fat', '', [mv]), PR); const before = pp(b, 'p1'); b.makeChoices('move 1', 'move 1'); console.log(`[P1 ${lab}(${mv})] PP ${before}→${pp(b, 'p1')}`); }
{ const b = mk(set('Snorlax', 'Thick Fat', '', ['Tackle']), PR); const before = pp(b, 'p1'); b.makeChoices('move 1', 'move 2'); console.log(`[P2 방어에 막힘] PP ${before}→${pp(b, 'p1')}`); }

console.log('\n===== R. 리베로·변환자재 =====');
const PRO = set('Greninja', 'Protean', '', ['Ice Beam', 'Dark Pulse', 'Swords Dance']);
const ty = b => b.p1.active[0].getTypes().join('/');
{ const b = mk(PRO, SNOR); step(b, 'move 1', 'move 1', 'R1 1회째 냉동빔', ty); step(b, 'move 2', 'move 1', 'R1 2회째 악의파동', ty); step(b, 'move 3', 'move 1', 'R1 변화기 칼춤', ty); }
{ const b = mk(set('Greninja', 'Protean', '', ['Swords Dance', 'Ice Beam']), SNOR); step(b, 'move 1', 'move 1', 'R2 첫 기술이 변화기(칼춤)', ty); step(b, 'move 2', 'move 1', 'R2 다음 냉동빔', ty); }
{ const b = mk(PRO, SNOR, [SNOR]); step(b, 'move 1', 'move 1', '턴1', ty); step(b, 'switch 2', 'move 1', '교체'); step(b, 'switch 2', 'move 1', '복귀', ty); step(b, 'move 2', 'move 1', 'R3 교체 후 복귀 첫 기술', ty); }
{ const b = mk(PRO, set('Snorlax', 'Thick Fat', '', ['Protect'])); step(b, 'move 1', 'move 1', 'R4 상대 방어에 막힘', ty); }
{ const b = mk(set('Greninja', 'Protean', '', ['Ice Beam']), set('Gengar', 'Cursed Body')); b.p1.active[0].moveSlots[0].pp; step(b, 'move 1', 'move 1', 'R5 (참고) 대조', ty); }
{ const b = mk(set('Greninja', 'Protean', '', ['Hydro Pump', 'Ice Beam']), SNOR); step(b, 'move 1', 'move 1', 'R6 자기 타입 기술(하이드로펌프)', ty); step(b, 'move 2', 'move 1', 'R6 다음 냉동빔', ty); }
{ const b = mk(set('Greninja', 'Protean', 'Greninjite', ['Ice Beam', 'Dark Pulse']), SNOR); step(b, 'move 1', 'move 1', '턴1 냉동빔', ty); step(b, 'move 2 mega', 'move 1', 'R7 메가개굴닌자(같은 변환자재) 후 악의파동', ty); }
{ const b = mk(set('Cinderace', 'Libero', '', ['Sleep Talk', 'Ice Punch']), SNOR); b.p1.active[0].setStatus('slp'); b.p1.active[0].statusState.time = 5; b.p1.active[0].statusState.startTime = 5; step(b, 'move 1', 'move 1', 'R8 리베로 잠꼬대→냉동펀치', ty); }

console.log('\n===== S. 총대장 =====');
for (const k of [0, 1, 3, 5, 6]) { const b = mk(SNOR, SNOR, [set('Kingambit', 'Supreme Overlord', '', ['Splash', 'Kowtow Cleave'])]); b.p1.totalFainted = k;
  const n = b.log.length; b.makeChoices('switch 2', 'move 1'); const h0 = b.p2.active[0].hp; b.makeChoices('move 2', 'move 1'); console.log(`[S1 기절 ${k} 후 등장] fallen=${b.p1.active[0].abilityState.fallen ?? 0} 깨트리기 피해=${h0 - b.p2.active[0].hp} ${L(b, n).slice(0, 160)}`); }
{ const b = mk(SNOR, SNOR, [set('Kingambit', 'Supreme Overlord')]); b.p1.totalFainted = 1; b.makeChoices('switch 2', 'move 1'); b.p1.totalFainted = 3; b.makeChoices('move 1', 'move 1'); console.log(`[S2 등장 후 기절 증가] fallen=${b.p1.active[0].abilityState.fallen}`); }

console.log('\n===== TR. 트레이스 =====');
const TRc = set('Porygon2', 'Trace');
for (const [lab, foe] of [['위협', set('Gyarados', 'Intimidate')], ['모래날림', set('Hippowdon', 'Sand Stream')], ['탈', set('Mimikyu', 'Disguise')], ['트레이스', set('Porygon2', 'Trace')], ['괴짜', set('Ditto', 'Imposter')], ['일루전', set('Zoroark-Hisui', 'Illusion')], ['배틀스위치', set('Aegislash', 'Stance Change')]]) {
  const b = mk(TRc, foe); ex(`TR1 트레이스 vs ${lab}`, b, `p1ab=${b.p1.active[0].ability} p1 ${bo(b, 'p1')} p2 ${bo(b, 'p2')} ${W(b)}`); }
{ const b = mk(TRc, set('Mimikyu', 'Disguise'), [SNOR], [set('Gyarados', 'Intimidate')]); step(b, 'move 1', 'switch 2', 'TR2 못 베낀 뒤 상대 교체(위협)', b => `p1ab=${b.p1.active[0].ability} p2 ${bo(b, 'p2')}`); }
{ const b = mk(set('Alakazam', 'Inner Focus', 'Alakazite', ['Splash']), set('Gyarados', 'Intimidate')); step(b, 'move 1 mega', 'move 1', 'TR3 메가후딘 메가진화', b => `p1ab=${b.p1.active[0].ability} p2 ${bo(b, 'p2')}`); }

console.log('\n===== MB. 틀깨기 =====');
for (const [lab, foe, mv] of [['부유', set('Rotom-Wash', 'Levitate'), 'Earthquake'], ['옹골참', set('Sturdy', 'Sturdy'), 'Tackle'], ['탈', set('Mimikyu', 'Disguise'), 'Crunch'], ['미러아머(위협 아님)', set('Corviknight', 'Mirror Armor'), 'Tackle']]) {
  if (lab === '옹골참') continue;
  const b = mk(set('Excadrill', 'Mold Breaker', '', [mv]), foe); const n = b.log.length; b.makeChoices('move 1', 'move 1'); console.log(`[MB1 틀깨기 ${mv} vs ${lab}] ${L(b)}`); }
{ const b = mk(set('Excadrill', 'Mold Breaker', '', ['Earthquake']), set('Sturdy-', 'Sturdy').replace('Sturdy-', 'Forretress')); b.p2.active[0].sethp(b.p2.active[0].maxhp); b.p1.active[0].boosts.atk = 6; b.makeChoices('move 1', 'move 1'); console.log(`[MB2 틀깨기 vs 옹골참(풀피, 공+6 지진)] p2hp=${b.p2.active[0].hp}`); }

console.log('\n===== FW·FR. 예지몽·통찰 =====');
{ const b = mk(set('Hypno', 'Forewarn'), set('Garchomp', 'Rough Skin', 'Choice Scarf', ['Earthquake', 'Outrage', 'Dragon Claw'])); ex('FW 예지몽', b); }
{ const b = mk(set('Gothitelle', 'Frisk'), set('Garchomp', 'Rough Skin', 'Choice Scarf')); ex('FR 통찰', b); }
