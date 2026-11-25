// fix-45 검수 추가 실행 (Showdown 965a535, gen9championsbssregmc) — 사용법: node fix45-review-run.cjs <PS 경로>
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves) => `${sp}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
const BENCH = set('Snorlax', 'Thick Fat', ['Splash']);
const ESP = set('Espeon', 'Magic Bounce', ['Splash']), PLAIN = set('Umbreon', 'Synchronize', ['Splash']);
const RE = /^\|(move|drag|-immune|-status|-start|-sidestart|-boost|-unboost|-fail|-activate)\|/;
function run(label, user, foe, prep) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import([user, BENCH].join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import([foe, BENCH].join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	const n = b.log.length; b.makeChoices('move 1', 'move 1');
	const a = b.p1.active[0], d = b.p2.active[0];
	console.log(`[${label}]\n   ` + b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1)).join(' / ') +
		`\n   => p1 ${a.name} vol=${Object.keys(a.volatiles)} def=${a.boosts.def} side=${Object.keys(b.p1.sideConditions)} | p2 ${d.name} sub=${!!d.volatiles.substitute}`);
}
const subP1 = b => b.p1.active[0].addVolatile('substitute');
const subP2 = b => b.p2.active[0].addVolatile('substitute');
// A. 반사 후 사용자 쪽 면역(대타 외) — Showdown은 사용자 쪽 TryHit/면역을 다시 본다
run('풀 타입 사용자 수면가루', set('Venusaur', 'Chlorophyll', ['Sleep Powder']), ESP);
run('방음 사용자 싫은소리', set('Kommo-o', 'Soundproof', ['Screech']), ESP);
run('황금몸 사용자 이상한빛', set('Gholdengo', 'Good as Gold', ['Confuse Ray']), ESP);
run('초식 사용자 씨뿌리기', set('Gogoat', 'Sap Sipper', ['Leech Seed']), ESP);
// B. 소리 아닌 bypasssub 기술 — 반사돼도/직접 써도 대타를 무시
for (const mv of ['Taunt', 'Torment', 'Disable']) {
	run(`${mv} 반사, 사용자 대타`, set('Hippowdon', 'Sand Stream', [mv]), ESP, subP1);
	run(`${mv} 직접, 대상 대타(대조)`, set('Hippowdon', 'Sand Stream', [mv]), PLAIN, subP2);
}
// C. 반사하는 쪽만 대타 — 반사가 대타보다 먼저
for (const mv of ['Whirlwind', 'Stealth Rock', 'Taunt', 'Screech']) {
	run(`${mv}, 매직미러 쪽 대타`, set('Hippowdon', 'Sand Stream', [mv]), ESP, subP2);
}