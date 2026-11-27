// fix-49 설계서 검수 — Showdown 965a535, gen9championsbssregmc. 사용법: node fix49-review-run.cjs <showdown 빌드 폴더>
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const F = 'gen9championsbssregmc';
const set = (sp, ab, item = '', moves = ['Splash'], extra = '') => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\nLevel: 50\n${extra}${moves.map(m => '- ' + m).join('\n')}`;
const SNOR = set('Snorlax', 'Thick Fat', '', ['Splash', 'Tackle']);
function mk(p1, p2, b1 = [SNOR], b2 = [SNOR], seed = [1, 2, 3, 4]) {
  const b = new Battle({formatid: F, seed});
  b.setPlayer('p1', {name: 'p1', team: Teams.import([p1, ...b1].join('\n\n'))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import([p2, ...b2].join('\n\n'))});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
  return b;
}
const RE = /^\|(switch|move|-ability|-weather|-fieldstart|-boost|-unboost|-immune|-fail|-start|-item|-enditem|-mega|-activate|-damage|-sidestart|-clearnegativeboost|-setboost)\|/;
const L = (b, n = 0) => b.log.slice(n).filter(l => RE.test(l) && !/\|Splash\|/.test(l)).map(l => l.slice(1).replace(/\|\[of\][^|]*/g, '').replace(/p([12])a: /g, 'p$1:')).join(' / ');
const bo = (b, s) => JSON.stringify(Object.fromEntries(Object.entries(b[s].active[0].boosts).filter(([, v]) => v))).replace(/"/g, "");
const it = (b, s) => b[s].active[0].item || '-';
const step = (b, c1, c2, label, post) => { const n = b.log.length; b.makeChoices(c1, c2); console.log(`  [${label}] ${L(b, n)}${post ? '  ⇒ ' + post(b) : ''}`); };
const W = b => `weather=${b.field.weather || '-'}(${b.field.weatherState.duration ?? ''}) src=${b.field.weatherState.source?.species?.name ?? '-'}`;

// 하양허브 보유 선공(Weavile, 박치기)이 위협 보유자를 때린 피해 — 허브 유무 비교
const ATK = h => set('Weavile', 'Pressure', h ? 'White Herb' : '', ['Tackle', 'Splash']);
const INT = set('Gyarados', 'Intimidate', '', ['Splash']);
console.log('===== 1. E8-36 하양허브 즉시 복구 범위 =====');
for (const h of [false, true]) {
  { const b = mk(INT, ATK(h)); const hp = b.p1.active[0].hp; console.log(`[H1 시작 herb=${h}] 시작 직후 p2 ${bo(b, 'p2')} item=${it(b, 'p2')}`);
    step(b, 'move 1', 'move 1', '턴1 박치기', b => `피해 ${hp - b.p1.active[0].hp} p2 ${bo(b, 'p2')} item=${it(b, 'p2')}`); }
  { const b = mk(SNOR, ATK(h), [INT]); const hp = b.p1.pokemon[1].hp;
    step(b, 'switch 2', 'move 1', `H2 교체 등장 herb=${h}`, b => `위협 보유자 피해 ${hp - b.p1.active[0].hp} p2 ${bo(b, 'p2')} item=${it(b, 'p2')}`); }
  { const b = mk(set('Manectric', 'Static', 'Manectite', ['Splash']), ATK(h)); const hp = b.p1.active[0].hp;
    step(b, 'move 1 mega', 'move 1', `H3 메가 등장(메가썬더볼트) herb=${h}`, b => `피해 ${hp - b.p1.active[0].hp} p2 ${bo(b, 'p2')} item=${it(b, 'p2')}`); }
}
{ const b = mk(set('Weavile', 'Pressure', '', ['Sticky Web', 'Splash']), SNOR, [SNOR], [set('Weavile', 'Pressure', 'White Herb', ['Tackle'])]);
  step(b, 'move 1', 'move 1', '턴1 끈적끈적네트');
  step(b, 'move 2', 'switch 2', 'H4(시험 8) 하양허브 보유 교체 등장 × 끈적끈적네트', b => `p2 ${bo(b, 'p2')} item=${it(b, 'p2')}`); }
{ const b = mk(set('Gyarados', 'Intimidate', 'White Herb'), set('Arcanine', 'Intimidate'));
  console.log(`[H5(시험 9) 시작 양쪽 위협, p1만 하양허브] ${L(b)}  ⇒ p1 ${bo(b, 'p1')} item=${it(b, 'p1')} / p2 ${bo(b, 'p2')} item=${it(b, 'p2')}`); }
{ const b = mk(set('Arcanine', 'Intimidate'), set('Gyarados', 'Intimidate', 'White Herb'));
  console.log(`[H5b 좌우 반전, p2만 하양허브] p1 ${bo(b, 'p1')} item=${it(b, 'p1')} / p2 ${bo(b, 'p2')} item=${it(b, 'p2')}`); }
{ const b = mk(SNOR, set('Snorlax', 'Thick Fat', 'White Herb', ['Substitute', 'Splash']), [INT]); step(b, 'move 1', 'move 1', '턴1 대타');
  step(b, 'switch 2', 'move 2', 'H6 위협 × 대타 × 하양허브', b => `p2 ${bo(b, 'p2')} item=${it(b, 'p2')}`); }
{ const b = mk(SNOR, set('Kingambit', 'Defiant', '', ['Substitute', 'Splash']), [INT]); step(b, 'move 1', 'move 1', '턴1 대타');
  step(b, 'switch 2', 'move 2', 'H7 위협 × 대타 × 오기', b => `p2 ${bo(b, 'p2')}`); }

console.log('\n===== 2. E8-38 감미로운꿀 =====');
const HY = set('Hydrapple', 'Supersweet Syrup', '', ['Splash']);
{ const b = mk(HY, SNOR, [SNOR]); console.log(`[SY1 시작] ${L(b)} ⇒ p2 ${bo(b, 'p2')}`);
  step(b, 'switch 2', 'move 1', '물러남'); b.p2.active[0].clearBoosts();
  step(b, 'switch 2', 'move 1', 'SY2 같은 포켓몬 재등장', b => `p2 ${bo(b, 'p2')}`); }
{ const b = mk(SNOR, SNOR, [HY]); step(b, 'switch 2', 'move 1', 'SY3 교체 등장(첫 등장)', b => `p2 ${bo(b, 'p2')}`); }
{ const b = mk(SNOR, set('Snorlax', 'Thick Fat', '', ['Substitute', 'Splash']), [HY]); step(b, 'move 1', 'move 1', '턴1 대타');
  step(b, 'switch 2', 'move 2', 'SY4 교체 등장 × 대타', b => `p2 ${bo(b, 'p2')}`); }
{ const b = mk(SNOR, set('Snorlax', 'Contrary'), [HY]); step(b, 'switch 2', 'move 1', 'SY5 심술꾸러기', b => `p2 ${bo(b, 'p2')}`); }
{ const b = mk(set('Porygon2', 'Trace'), HY, [SNOR], [SNOR]); console.log(`[SY6 트레이스가 감미로운꿀 복사] ${L(b)} ⇒ p1ab=${b.p1.active[0].ability} p2 ${bo(b, 'p2')}`); }

console.log('\n===== 3. E8-34 시작 장면 트레이스 × 날씨 =====');
{ const b = mk(set('Porygon2', 'Trace', 'Heat Rock'), set('Torkoal', 'Drought')); console.log(`[TW1 트레이스(빠름, 뜨거운바위) vs 가뭄(느림)] ${L(b)} ⇒ ${W(b)}`); }
{ const b = mk(set('Torkoal', 'Trace', 'Heat Rock'), set('Ninetales', 'Drought')); console.log(`[TW2 트레이스(느림, 뜨거운바위) vs 가뭄(빠름)] ${L(b)} ⇒ ${W(b)}`); }
{ const b = mk(set('Porygon2', 'Trace'), set('Torkoal', 'Drought', 'Heat Rock')); console.log(`[TW3 트레이스(빠름) vs 가뭄(느림, 뜨거운바위)] ${L(b)} ⇒ ${W(b)}`); }
{ const b = mk(set('Porygon2', 'Trace'), set('Indeedee', 'Psychic Surge')); console.log(`[TW4 트레이스 vs 사이코메이커] ${L(b)}`); }
{ const b = mk(SNOR, set('Pelipper', 'Drizzle', '', ['Splash']), [set('Porygon2', 'Trace')], [set('Torkoal', 'Drought')]);
  step(b, 'move 1', 'switch 2', '턴1 상대 가뭄 등장');
  step(b, 'move 1', 'switch 2', '턴2 상대 잔비 재등장(비)', W);
  step(b, 'switch 2', 'move 1', 'TW5 교체 등장 트레이스 vs 잔비(이미 비)', W); }
{ const b = mk(SNOR, set('Torkoal', 'Drought'), [set('Porygon2', 'Trace')], [set('Pelipper', 'Drizzle')]);
  step(b, 'move 1', 'switch 2', '턴1 상대 잔비 → 비');
  step(b, 'move 1', 'switch 2', '턴2 상대 가뭄 재등장 → 쾌청', W);
  step(b, 'switch 2', 'move 1', 'TW6 교체 등장 트레이스 vs 가뭄(이미 쾌청)', W); }
{ const b = mk(SNOR, set('Pelipper', 'Drizzle'), [set('Porygon2', 'Trace')], [set('Torkoal', 'Drought')]);
  step(b, 'move 1', 'switch 2', '턴1 상대 가뭄(쾌청)', W);
  step(b, 'switch 2', 'switch 2', '턴2 동시 교체: 트레이스 등장 + 상대 잔비 등장', b => `${W(b)} p1ab=${b.p1.active[0].ability}`); }

console.log('\n===== 4. E8-35 트레이스 대기 재시도 지점 =====');
const MIMI = set('Mimikyu', 'Disguise', '', ['Splash', 'Tackle']);
{ const b = mk(set('Porygon2', 'Trace', '', ['Splash', 'Tackle']), MIMI, [SNOR], [set('Gyarados', 'Intimidate', 'White Herb', ['Tackle'])]);
  step(b, 'move 1', 'switch 2', 'TRW1 대기 중 상대 교체(위협+하양허브)', b => `p1ab=${b.p1.active[0].ability} p1 ${bo(b, 'p1')} p2 ${bo(b, 'p2')} item=${it(b, 'p2')}`);
  const hp = b.p1.active[0].hp;
  step(b, 'move 1', 'move 1', 'TRW1 다음 턴 갸라도스 박치기', b => `피해 ${hp - b.p1.active[0].hp} p2 ${bo(b, 'p2')} item=${it(b, 'p2')}`); }
{ const b = mk(set('Porygon2', 'Trace', '', ['Splash', 'Tackle']), MIMI, [SNOR], [set('Gyarados', 'Intimidate', '', ['Tackle'])]);
  const hp0 = b.p1.active[0].hp;
  step(b, 'move 1', 'switch 2', 'TRW1b 대조(허브 없음)');
  const hp = b.p1.active[0].hp; step(b, 'move 1', 'move 1', 'TRW1b 박치기', b => `피해 ${hp - b.p1.active[0].hp}`); }
{ const b = mk(set('Porygon2', 'Trace', '', ['Splash']), set('Ditto', 'Imposter', '', ['Splash']));
  console.log(`[TRW2 트레이스 vs 괴짜(메타몽 변신)] ${L(b)} ⇒ p1ab=${b.p1.active[0].ability} p2ab=${b.p2.active[0].ability}`); }
{ const b = mk(set('Porygon2', 'Trace', '', ['Splash']), set('Mimikyu', 'Disguise', '', ['Skill Swap']));
  step(b, 'move 1', 'move 1', 'TRW3 대기 중 상대가 스킬스왑', b => `p1ab=${b.p1.active[0].ability} p2ab=${b.p2.active[0].ability}`); }
{ const b = mk(set('Porygon2', 'Trace', '', ['Worry Seed']), set('Zoroark-Hisui', 'Illusion', '', ['Splash']));
  console.log(`[TRW3 시작] p1ab=${b.p1.active[0].ability}`);
  step(b, 'move 1', 'move 1', 'TRW3 대기 중 트레이스 보유자가 상대에게 고민씨', b => `p1ab=${b.p1.active[0].ability} p2ab=${b.p2.active[0].ability}`); }
console.log('\n===== 5. E8-37·39 시작 순서 =====');
{ const b = mk(set('Politoed', 'Drizzle', 'Choice Scarf'), set('Ninetales', 'Drought'));
  console.log(`[SP1 잔비(원시 느림·스카프) vs 가뭄(원시 빠름)] raw ${b.p1.active[0].storedStats.spe} vs ${b.p2.active[0].storedStats.spe}, 보정 ${b.p1.active[0].getActionSpeed()} vs ${b.p2.active[0].getActionSpeed()} ⇒ ${W(b)}`); }
{ const b = mk(set('Ninetales', 'Drought'), set('Politoed', 'Drizzle', 'Choice Scarf'));
  console.log(`[SP1b 좌우 반전] ⇒ ${W(b)}`); }
{ const b = mk(set('Politoed', 'Drizzle'), set('Ninetales', 'Drought')); console.log(`[SP2 대조(스카프 없음)] ⇒ ${W(b)}`); }
let first = 0;
for (let s = 1; s <= 40; s++) { const b = mk(set('Snorlax', 'Intimidate', 'White Herb'), set('Snorlax', 'Trace'), [SNOR], [SNOR], [s, s + 1, s + 2, s + 3]);
  // 동속 위협 vs 트레이스: 위협이 먼저면 트레이스 보유자가 −1 받은 뒤 위협 복사 → p1 −1(허브로 복구) / 트레이스가 먼저면 위협 복사 → p1 −1 → 그 뒤 p1 위협
  if (b.log.findIndex(l => l.includes('|-ability|p1a') && l.includes('Intimidate')) < b.log.findIndex(l => l.includes('|-ability|p2a'))) first++; }
console.log(`[SP3 동속 위협(p1) vs 트레이스(p2)] 위협이 먼저 ${first}/40`);

console.log('\n===== 6. 추가: 동시 등장 × 하양허브 1회 소모 범위 =====');
const HERB = set('Weavile', 'Pressure', 'White Herb', ['Splash']);
{ const b = mk(set('Weavile', 'Pressure', '', ['Splash']), set('Snorlax', 'Thick Fat', '', ['Sticky Web', 'Splash']), [HERB], [INT]);
  step(b, 'move 1', 'move 1', '턴1 p2 끈적끈적네트');
  step(b, 'switch 2', 'switch 2', 'D1 동시 교체: p1 하양허브(네트) + p2 위협', b => `p1 ${bo(b, 'p1')} item=${it(b, 'p1')}`); }
{ const b = mk(set('Weavile', 'Pressure', '', ['Splash']), set('Snorlax', 'Thick Fat', '', ['Sticky Web', 'Explosion']), [HERB], [INT]);
  step(b, 'move 1', 'move 1', '턴1 p2 끈적끈적네트'); b.p1.active[0].sethp(1);
  step(b, 'move 1', 'move 2', '턴2 대폭발(양쪽 기절)');
  step(b, 'switch 2', 'switch 2', 'D2 기절 교체 동시 등장: p1 하양허브(네트) + p2 위협', b => `p1 ${bo(b, 'p1')} item=${it(b, 'p1')}`); }
{ const b = mk(set('Porygon2', 'Trace'), HY, [SNOR], [SNOR]); b.p2.active[0].clearBoosts();
  step(b, 'switch 2', 'move 1', '트레이스 물러남'); step(b, 'switch 2', 'move 1', 'SY7 트레이스 재등장 → 감미로운꿀 재복사', b => `p1ab=${b.p1.active[0].ability} p2 ${bo(b, 'p2')}`); }
