// fix-46 검수 실행 (Showdown 965a535, gen9championsbssregmc) — 사용법: node fix46-review-run.cjs <PS 경로>
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves, item) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
const BENCH = set('Snorlax', 'Thick Fat', ['Splash']);
const RE = /^\|(move|-immune|-status|-curestatus|-start|-end|-fail|-activate|-block|-heal|-ability|-message)\|/;
function run(label, user, foe, prep, turns = 1) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import([user, BENCH].join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import([foe, BENCH].join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	const n = b.log.length;
	for (let t = 0; t < turns; t++) b.makeChoices(t === 0 ? 'move 1' : 'move 2', 'default');
	const a = b.p1.active[0], d = b.p2.active[0];
	console.log(`[${label}]\n   ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1)).join(' / ') +
		`\n   => p1 ${a.name} hp=${a.hp}/${a.maxhp} st=${a.status || '-'} ab=${a.ability} | p2 ${d.name} st=${d.status || '-'} vol=${Object.keys(d.volatiles)}`);
}
const half = b => { const a = b.p1.active[0]; a.sethp(Math.floor(a.maxhp / 2)); };
const P2 = (mv = 'Splash') => set('Umbreon', 'Synchronize', [mv, 'Splash']);

console.log('===== A. 잠자기 =====');
const rest = ab => set('Snorlax', ab, ['Rest']);
run('A1 풀피', rest('Thick Fat'), P2());
run('A2 풀피+화상', rest('Thick Fat'), P2(), b => b.p1.active[0].setStatus('brn'));
run('A3 절반+화상(대조)', rest('Thick Fat'), P2(), b => { half(b); b.p1.active[0].setStatus('brn'); });
for (const ab of ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Purifying Salt'])
	run(`A4 절반+${ab}`, rest(ab), P2(), half);
run('A5 절반+일렉트릭필드(접지)', rest('Thick Fat'), P2(), b => { half(b); b.field.setTerrain('electricterrain', b.p2.active[0]); });
run('A6 절반+일렉트릭필드(비접지 비행)', set('Skarmory', 'Sturdy', ['Rest']), P2(), b => { half(b); b.field.setTerrain('electricterrain', b.p2.active[0]); });
run('A7 절반+미스트필드(접지)', rest('Thick Fat'), P2(), b => { half(b); b.field.setTerrain('mistyterrain', b.p2.active[0]); });
run('A8 절반+상대 소란', rest('Thick Fat'), P2(), b => { half(b); b.p2.active[0].addVolatile('uproar'); });
run('A9 절반+리프가드 쾌청', set('Leafeon', 'Leaf Guard', ['Rest']), P2(), b => { half(b); b.field.setWeather('sunnyday', b.p2.active[0]); });
run('A10 절반+자기편 신비의부적(대조)', rest('Thick Fat'), P2(), b => { half(b); b.p1.addSideCondition('safeguard', b.p1.active[0]); });
run('A11 절반+플라워베일 풀 타입(자기 자신)', set('Florges', 'Flower Veil', ['Rest']), P2(), b => { half(b); b.p1.active[0].setType(['Grass']); });
run('A12 수면 중 잠꼬대→잠자기', set('Snorlax', 'Thick Fat', ['Sleep Talk', 'Rest']), P2(), b => { half(b); b.p1.active[0].setStatus('slp'); });

console.log('===== B. 하품 (3턴: 하품 → 튀어오르기 ×2) =====');
const YAWN = set('Slowbro', 'Oblivious', ['Yawn', 'Splash']);
const tgt = (ab, sp = 'Umbreon') => set(sp, ab, ['Splash', 'Splash']);
for (const ab of ['Insomnia', 'Purifying Salt', 'Sweet Veil', 'Vital Spirit'])
	run(`B1 vs ${ab}`, YAWN, tgt(ab), null, 1);
run('B2 vs 신비의부적', YAWN, tgt('Synchronize'), b => b.p2.addSideCondition('safeguard', b.p2.active[0]), 1);
run('B3 vs 미스트필드(접지)', YAWN, tgt('Synchronize'), b => b.field.setTerrain('mistyterrain', b.p2.active[0]), 1);
run('B4 vs 일렉트릭필드(접지)', YAWN, tgt('Synchronize'), b => b.field.setTerrain('electricterrain', b.p2.active[0]), 1);
run('B5 vs 리프가드 쾌청', YAWN, tgt('Leaf Guard', 'Leafeon'), b => b.field.setWeather('sunnyday', b.p2.active[0]), 1);
run('B6 vs 플라워베일 풀 타입', YAWN, tgt('Flower Veil', 'Florges'), b => b.p2.active[0].setType(['Grass']), 1);
run('B7 vs 소란 중(3턴)', YAWN, tgt('Synchronize'), b => b.p2.active[0].addVolatile('uproar'), 3);
run('B8 틀깨기 하품 vs 불면(3턴)', set('Excadrill', 'Mold Breaker', ['Yawn', 'Splash']), tgt('Insomnia'), null, 3);
run('B9 틈새포착 하품 vs 신비의부적(3턴)', set('Dragapult', 'Infiltrator', ['Yawn', 'Splash']), tgt('Synchronize'), b => b.p2.addSideCondition('safeguard', b.p2.active[0]), 3);

console.log('===== C. 상태이상 변화기 =====');
run('C1 틀깨기 도깨비불 vs 열교환', set('Excadrill', 'Mold Breaker', ['Will-O-Wisp']), tgt('Thermal Exchange', 'Baxcalibur'));
run('C2 틀깨기 맹독 vs 정화의소금', set('Excadrill', 'Mold Breaker', ['Toxic']), tgt('Purifying Salt', 'Garganacl'));
run('C3 틈새포착 도깨비불 vs 신비의부적', set('Dragapult', 'Infiltrator', ['Will-O-Wisp']), tgt('Synchronize'), b => b.p2.addSideCondition('safeguard', b.p2.active[0]));
run('C4 전기자석파 vs 땅 타입', set('Jolteon', 'Volt Absorb', ['Thunder Wave']), tgt('Sand Stream', 'Hippowdon'));
run('C5 도깨비불 vs 미스트필드', set('Jolteon', 'Volt Absorb', ['Will-O-Wisp']), tgt('Synchronize'), b => b.field.setTerrain('mistyterrain', b.p2.active[0]));
run('C6 맹독 vs 파스텔베일', set('Jolteon', 'Volt Absorb', ['Toxic']), tgt('Pastel Veil', 'Galarian Ponyta'));
run('C7 독압정 계열 아님: 독독(독찌르기 아님) 독 타입 사용자 vs 강철', set('Toxapex', 'Regenerator', ['Toxic']), tgt('Sturdy', 'Skarmory'));

console.log('===== D. 특성 획득 시 치료 (스킬스왑) =====');
const swap = st => set('Porygon2', 'Download', ['Skill Swap']);
for (const [st, ab, sp] of [['tox', 'Purifying Salt', 'Garganacl'], ['brn', 'Purifying Salt', 'Garganacl'], ['tox', 'Immunity', 'Snorlax'], ['brn', 'Thermal Exchange', 'Baxcalibur']])
	run(`D ${st} 상태 사용자가 ${ab} 획득`, swap(), tgt(ab, sp), b => { b.p1.active[0].setStatus(st); if (st === 'slp') b.p1.active[0].statusState.time = 5; });

console.log('===== E. 하품이 걸린 뒤 신비의부적/미스트필드 =====');
for (const [label, fn] of [['신비의부적', b => b.p2.addSideCondition('safeguard', b.p2.active[0])], ['미스트필드', b => b.field.setTerrain('mistyterrain', b.p2.active[0])], ['일렉트릭필드', b => b.field.setTerrain('electricterrain', b.p2.active[0])]]) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import([YAWN, BENCH].join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import([tgt('Synchronize'), BENCH].join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	const n = b.log.length;
	b.makeChoices('move 1', 'move 1'); fn(b); b.makeChoices('move 2', 'move 1');
	console.log(`[E 하품 후 ${label}]\n   ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1)).join(' / ') + `\n   => p2 st=${b.p2.active[0].status || '-'}`);
}