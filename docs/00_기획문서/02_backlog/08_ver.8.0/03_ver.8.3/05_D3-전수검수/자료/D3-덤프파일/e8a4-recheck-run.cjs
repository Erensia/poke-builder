// E8 ④ 엔진 대조 후 재확인(프레셔 대상 종류·트레이스 날씨·하양허브 시작 장면·동률) — Showdown 965a535. 사용법: node e8a4-recheck-run.cjs <showdown 빌드 폴더>
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const set = (sp, ab, item = '', moves = ['Splash']) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\nLevel: 50\n${moves.map(m => '- ' + m).join('\n')}`;
const SN = set('Snorlax', 'Thick Fat');
function mk(p1, p2) { const b = new Battle({formatid: F, seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {name: 'p1', team: Teams.import([p1, SN].join('\n\n'))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import([p2, SN].join('\n\n'))});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default'); return b; }
const PR = set('Absol', 'Pressure', '', ['Splash']);
for (const mv of ['Sticky Web', 'Imprison', 'Counter', 'Swords Dance', 'Reflect', 'Light Screen', 'Substitute', 'Protect', 'Recover', 'Tailwind', 'Stealth Rock', 'Haze', 'Trick Room', 'Tackle']) {
  const b = mk(set('Snorlax', 'Thick Fat', '', [mv]), PR); b.p1.active[0].sethp(100); const s = b.p1.active[0].moveSlots[0]; const p0 = s.pp; b.makeChoices('move 1', 'move 1');
  console.log(`[${mv} target=${b.dex.moves.get(mv).target}] PP ${p0}→${s.pp} (−${p0 - s.pp})`); }
// 트레이스: 날씨 없는 장면에서 모래날림 복사
{ const b = mk(set('Porygon2', 'Trace'), set('Hippowdon', 'Sand Stream')); console.log('[트레이스 vs 모래날림] weather=' + b.field.weather + ' src=' + b.field.weatherState.source?.name); }
{ const b = mk(set('Porygon2', 'Trace'), set('Indeedee', 'Psychic Surge')); console.log('[트레이스 vs 사이코메이커] terrain=' + b.field.terrain); }
// 하양허브 시작 장면 vs 교체 등장
{ const b = mk(set('Gyarados', 'Intimidate'), set('Snorlax', 'Thick Fat', 'White Herb')); console.log('[시작 장면 위협 vs 하양허브] atk=' + b.p2.active[0].boosts.atk + ' item=' + (b.p2.active[0].item || '-')); }
// 동률 스피드: 같은 종 잔비/가뭄 시드별 결과
let sun = 0; for (let s = 1; s <= 40; s++) { const b = new Battle({formatid: F, seed: [s, s + 1, s + 2, s + 3]});
  b.setPlayer('p1', {name: 'p1', team: Teams.import([set('Snorlax', 'Drought'), SN].join('\n\n'))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import([set('Snorlax', 'Drizzle'), SN].join('\n\n'))});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default'); if (b.field.weather === 'sunnyday') sun++; }
console.log(`[동률 가뭄(p1) vs 잔비(p2)] 쾌청 ${sun}/40`);
