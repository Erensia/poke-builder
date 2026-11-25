// E8-a ① 피격 접촉 반응 묶음 — Showdown 965a535 (gen9championsbssregmc) 실행 대조. 사용법: node e8a1-run.cjs <빌드 폴더>
// p1 = 공격측(기본 칠색조 아님: Snorlax), p2 = 방어측(특성 X). 확률 특성은 시드 60개를 돌려 발동 횟수를 센다.
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves, item, extra = '') => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${extra}${moves.map(m => '- ' + m).join('\n')}`;
const BENCH = set('Snorlax', 'Thick Fat', ['Splash']);
const RE = /^\|(move|-damage|-immune|-status|-curestatus|-start|-end|-fail|-activate|-block|-boost|-unboost|-heal|-ability|-weather|-sidestart|-formechange|detailschange|-message|faint)\|/;
function make(user, foe, prep, seed = [1, 2, 3, 4]) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed});
	b.setPlayer('p1', {name: 'p1', team: Teams.import([user, BENCH].join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import([foe, BENCH].join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	return b;
}
function run(label, user, foe, prep, turns = 1) {
	const b = make(user, foe, prep);
	const n = b.log.length;
	for (let t = 0; t < turns; t++) b.makeChoices('move 1', 'default');
	const a = b.p1.active[0], d = b.p2.active[0];
	console.log(`[${label}]\n   ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1).replace(/\|\[from\]/g, '<').replace(/\|p[12]a: /g, '|')).join(' / ') +
		`\n   => p1 ${a.name} hp=${a.hp}/${a.maxhp} st=${a.status || '-'} boosts=${JSON.stringify(a.boosts).replace(/"|:0,?/g, '')} vol=${Object.keys(a.volatiles)} | p2 ${d.name} hp=${d.hp}/${d.maxhp} st=${d.status || '-'} boosts=${JSON.stringify(d.boosts).replace(/"|:0,?/g, '')} vol=${Object.keys(d.volatiles)} | atkSide=${Object.keys(b.p1.sideConditions)} weather=${b.field.weather || '-'}`);
}
// 확률 특성: 시드 60개 중 pred가 참인 횟수
function count(label, user, foe, pred, prep) {
	let hit = 0;
	for (let s = 1; s <= 60; s++) {
		const b = make(user, foe, prep, [s, s + 1, s + 2, s + 3]);
		b.makeChoices('move 1', 'default');
		if (pred(b)) hit++;
	}
	console.log(`[${label}] ${hit}/60`);
}
const S = (mv, ab = 'Thick Fat', item, extra) => set('Snorlax', ab, [mv, 'Splash'], item, extra);
const D = (ab, sp = 'Snorlax', item) => set(sp, ab, ['Splash', 'Splash'], item);
const low = b => { const d = b.p2.active[0]; d.sethp(1); };
const sub = b => b.p2.active[0].addVolatile('substitute');

console.log('===== A. 까칠한피부 (roughskin, 샘플 28) =====');
run('A1 접촉기(Tackle)', S('Tackle'), D('Rough Skin'));
run('A2 비접촉기(Earthquake)', S('Earthquake'), D('Rough Skin'));
run('A3 특수 접촉기(Draining Kiss)', S('Draining Kiss'), D('Rough Skin'));
run('A4 방어측 HP 1 → 쓰러뜨림(KO)', S('Tackle'), D('Rough Skin'), low);
run('A5 방어측 대타', S('Tackle'), D('Rough Skin'), sub);
run('A6 공격측 매직가드', S('Tackle', 'Magic Guard'), D('Rough Skin'));
run('A7 공격측 보호패드(Protective Pads)', S('Tackle', 'Thick Fat', 'Protective Pads'), D('Rough Skin'));
run('A8 다단 접촉(Fury Swipes)', S('Fury Swipes'), D('Rough Skin'));
run('A9 공격측 우격다짐(Sheer Force) + 접촉기', S('Tackle', 'Sheer Force'), D('Rough Skin'));
run('A10 공격측 최대 HP 7 근처 (maxhp/8 최소 1) — HP 1 공격측', S('Tackle'), D('Rough Skin'), b => b.p1.active[0].sethp(1));

console.log('===== B. 독가시·정전기·헤롱헤롱바디 — 특수 접촉기 포함 여부 (샘플 1·3·1) =====');
for (const [ab, st] of [['Poison Point', 'psn'], ['Static', 'par']]) {
	count(`B1 ${ab} vs 물리 접촉기(Tackle)`, S('Tackle'), D(ab), b => b.p1.active[0].status === st);
	count(`B2 ${ab} vs 특수 접촉기(Draining Kiss)`, S('Draining Kiss'), D(ab), b => b.p1.active[0].status === st);
	count(`B3 ${ab} vs 비접촉기(Earthquake)`, S('Earthquake'), D(ab), b => b.p1.active[0].status === st);
	count(`B4 ${ab} vs 접촉기 + 방어측 KO`, S('Tackle'), D(ab), b => b.p1.active[0].status === st, low);
	count(`B5 ${ab} vs 접촉기 + 공격측 보호패드`, S('Tackle', 'Thick Fat', 'Protective Pads'), D(ab), b => b.p1.active[0].status === st);
}
count('B6 Static vs 전기 타입 공격측(Raichu Tackle)', set('Raichu', 'Static', ['Tackle', 'Splash']), D('Static'), b => b.p1.active[0].status === 'par');
const G = (g, ab, mv) => `Snorlax (${g})
Ability: ${ab}
- ${mv}
- Splash`;
const attracted = b => !!b.p1.active[0].volatiles.attract;
count('B7 Cute Charm 이성 + Tackle', G('M', 'Thick Fat', 'Tackle'), G('F', 'Cute Charm', 'Splash'), attracted);
count('B8 Cute Charm 동성 + Tackle', G('M', 'Thick Fat', 'Tackle'), G('M', 'Cute Charm', 'Splash'), attracted);
count('B9 Cute Charm 이성 + 특수 접촉기(Draining Kiss)', G('M', 'Thick Fat', 'Draining Kiss'), G('F', 'Cute Charm', 'Splash'), attracted);

console.log('===== C. 깨어진갑옷 (weakarmor, 샘플 1) =====');
run('C1 물리(Tackle)', S('Tackle'), D('Weak Armor'));
run('C2 특수(Water Gun)', S('Water Gun'), D('Weak Armor'));
run('C3 물리 + KO', S('Tackle'), D('Weak Armor'), low);
run('C4 다단 물리(Bullet Seed)', S('Bullet Seed'), D('Weak Armor'));
run('C5 물리 + 대타', S('Tackle'), D('Weak Armor'), sub);

console.log('===== D. 독치장 (toxicdebris, 샘플 7) =====');
run('D1 물리(Tackle)', S('Tackle'), D('Toxic Debris'));
run('D2 특수(Water Gun)', S('Water Gun'), D('Toxic Debris'));
run('D3 이미 2겹', S('Tackle'), D('Toxic Debris'), b => { b.p1.addSideCondition('toxicspikes', b.p2.active[0]); b.p1.addSideCondition('toxicspikes', b.p2.active[0]); });
run('D4 물리 + 대타', S('Tackle'), D('Toxic Debris'), sub);
run('D5 다단 물리(Bullet Seed) — 몇 겹', S('Bullet Seed'), D('Toxic Debris'));

console.log('===== E. 모래뿜기 (sandspit, 샘플 1) =====');
run('E1 Water Gun', S('Water Gun'), D('Sand Spit'));
run('E2 대타', S('Water Gun'), D('Sand Spit'), sub);
run('E3 KO', S('Water Gun'), D('Sand Spit'), low);
run('E4 이미 비(Rain)', S('Water Gun'), D('Sand Spit'), b => b.field.setWeather('raindance', b.p2.active[0]));

console.log('===== F. 미끈미끈 (gooey, 샘플 1) =====');
run('F1 접촉기', S('Tackle'), D('Gooey'));
run('F2 특수 접촉기', S('Draining Kiss'), D('Gooey'));
run('F3 공격측 클리어바디', S('Tackle', 'Clear Body'), D('Gooey'));
run('F4 공격측 변덕(Contrary)', S('Tackle', 'Contrary'), D('Gooey'));
run('F5 공격측 미러아머', S('Tackle', 'Mirror Armor'), D('Gooey'));
run('F6 접촉기 + KO', S('Tackle'), D('Gooey'), low);
run('F7 대타', S('Tackle'), D('Gooey'), sub);

console.log('===== G. 저주받은바디 (cursedbody, 샘플 5) =====');
count('G1 Tackle → disable', S('Tackle'), D('Cursed Body'), b => !!b.p1.active[0].volatiles.disable);
count('G2 Water Gun(비접촉) → disable', S('Water Gun'), D('Cursed Body'), b => !!b.p1.active[0].volatiles.disable);
count('G3 대타 → disable', S('Tackle'), D('Cursed Body'), b => !!b.p1.active[0].volatiles.disable, sub);
count('G4 KO → disable', S('Tackle'), D('Cursed Body'), b => !!b.p1.active[0].volatiles.disable, low);
count('G5 공격측 불면 아님·아로마베일(Aroma Veil)', S('Tackle', 'Aroma Veil'), D('Cursed Body'), b => !!b.p1.active[0].volatiles.disable);
count('G6 공격측 멘탈허브(Mental Herb)', S('Tackle', 'Thick Fat', 'Mental Herb'), D('Cursed Body'), b => !!b.p1.active[0].volatiles.disable);

console.log('===== H. 전기로바꾸기 (electromorphosis, 샘플 1) =====');
run('H1 Tackle', S('Tackle'), D('Electromorphosis'));
run('H2 Water Gun', S('Water Gun'), D('Electromorphosis'));
run('H3 KO', S('Tackle'), D('Electromorphosis'), low);
run('H4 대타', S('Tackle'), D('Electromorphosis'), sub);

console.log('===== I. 정의의마음 (justified, 샘플 3) =====');
run('I1 악 물리(Crunch)', S('Crunch'), D('Justified'));
run('I2 악 특수(Dark Pulse)', S('Dark Pulse'), D('Justified'));
run('I3 비악(Tackle)', S('Tackle'), D('Justified'));
run('I4 악 + 대타', S('Crunch'), D('Justified'), sub);
run('I5 악 변화기(Taunt)', S('Taunt'), D('Justified'));

console.log('===== J. 지구력 (stamina, 샘플 5) =====');
run('J1 Tackle', S('Tackle'), D('Stamina'));
run('J2 다단(Bullet Seed)', S('Bullet Seed'), D('Stamina'));
run('J3 KO', S('Tackle'), D('Stamina'), low);
run('J4 대타', S('Tackle'), D('Stamina'), sub);
run('J5 고정 데미지(Seismic Toss)', S('Seismic Toss'), D('Stamina'));
run('J6 방어측 변덕(Contrary)', S('Tackle'), set('Snorlax', 'Contrary', ['Splash', 'Splash']));

console.log('===== K. 탈 (disguise, 샘플 16) — Mimikyu (노말 기술은 고스트라 면역이니 쓰지 않는다) =====');
const M = (item) => set("Mimikyu", "Disguise", ["Splash", "Splash"], item);
run("K1 Water Gun(특수)", S("Water Gun"), M());
run("K2 Water Gun ×2턴(두 번째는 Busted)", S("Water Gun"), M(), null, 2);
run("K3 다단(Bullet Seed)", S("Bullet Seed"), M());
run("K4 부가효과(Nuzzle: 100% 마비)", S("Nuzzle"), M());
run("K5 급소 확정(Frost Breath)", S("Frost Breath"), M());
run("K6 고정 데미지(Night Shade)", S("Night Shade"), M());
run("K7 틀깨기(Mold Breaker) Water Gun", S("Water Gun", "Mold Breaker"), M());
run("K8 Shadow Ball", S("Shadow Ball"), M());
run("K10 대타 + Water Gun", S("Water Gun"), M(), sub);
run("K11 날씨 데미지(모래바람) — 탈은 막지 않는다", S("Splash"), M(), b => b.field.setWeather("sandstorm", b.p1.active[0]));
run("K15 약점(Flash Cannon)", S("Flash Cannon"), M());
run("K16 반동기(Double-Edge가 아닌 Brave Bird) vs 탈", S("Brave Bird"), M());
run("K17 흡수기(Giga Drain) vs 탈", S("Giga Drain"), M(), b => b.p1.active[0].sethp(100));
run("K18 접촉 + 접촉반응 특성은 따로(공격측 Static인 Pikachu vs 탈: 탈이 막아도 공격측 자신의 반응은 없다)", S("Water Gun"), M());
run("K19 능력치 하락 부가(Bubble Beam 확률) 대신 100% 하락(Mud-Slap 명중 하락)", S("Mud-Slap"), M());
run("K20 선공 변화: 탈 파괴 후 1/8 HP를 쓰러지는 HP 1에서(방어측 HP 1)", S("Water Gun"), M(), b => { b.p2.active[0].sethp(1); });
console.log('===== L. 매직가드 (magicguard, 샘플 2) — 방어측이 아니라 공격측이 매직가드일 때의 피해 범위 =====');
const MG = (mv, item) => S(mv, 'Magic Guard', item);
run('L1 Life Orb 반동', MG('Tackle', 'Life Orb'), D('Thick Fat'));
run('L2 Double-Edge 반동', MG('Double-Edge'), D('Thick Fat'));
run('L3 High Jump Kick 빗나감(방어측 Ghost)', MG('High Jump Kick'), D('Thick Fat', 'Gengar'));
run('L4 혼란 자해', MG('Tackle'), D('Thick Fat'), b => b.p1.active[0].addVolatile('confusion'));
run('L5 독 상태', MG('Splash'), D('Thick Fat'), b => b.p1.active[0].setStatus('psn'));
run('L6 모래바람', MG('Splash'), D('Thick Fat'), b => b.field.setWeather('sandstorm', b.p2.active[0]));
run('L7 스텔스록', MG('Splash'), D('Thick Fat'), b => b.p1.addSideCondition('stealthrock', b.p2.active[0]));
run('L8 대타 만들기 비용', MG('Substitute'), D('Thick Fat'));
run('L9 씨뿌리기 피해', MG('Splash'), D('Thick Fat'), b => b.p1.active[0].addVolatile('leechseed', b.p2.active[0]));
run('L10 파괴광선류 반동 없음 / 자폭(Explosion)', MG('Explosion'), D('Thick Fat'));
run('L11 Struggle 반동(PP 0 불가) — Recoil 기술(Brave Bird)', MG('Brave Bird'), D('Thick Fat'));
run('L12 끈기 소금 Salt Cure(Garganacl)가 매직가드에게', set('Garganacl', 'Purifying Salt', ['Salt Cure', 'Splash']), set('Snorlax', 'Magic Guard', ['Splash', 'Splash']));
run('L13 까칠한피부 vs 매직가드(A6 재확인)', S('Tackle', 'Magic Guard'), D('Rough Skin'));
run('L14 Future Sight 피해는 매직가드가 막지 않는다', S('Future Sight'), D('Magic Guard'), null, 3);
