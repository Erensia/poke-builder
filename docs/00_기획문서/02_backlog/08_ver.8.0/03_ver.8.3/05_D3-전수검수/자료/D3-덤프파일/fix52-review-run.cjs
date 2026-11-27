// fix-52 (E8-42·43 오기·승기) — 상대발/자기발 능력치 하락 출처별 Showdown 965a535 (gen9championsbssregmc) 실행 대조. 사용법: node fix52-review-run.cjs <빌드 폴더>
// p1 = 공격측(기본 칼춤 없는 Snorlax), p2 = 오기(Defiant) 보유자(기본). 출력은 보유자의 랭크와 오기 발동 횟수(-ability|Defiant 줄 수).
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves, item, extra = '') => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${extra}${moves.map(m => '- ' + m).join('\n')}`;
const SN = (ab, moves = ['Splash'], item, sp = 'Snorlax') => set(sp, ab, moves, item);
const BENCH = SN('Thick Fat');
const bs = o => JSON.stringify(o).replace(/"|:0,?/g, '').replace(/,}/g, '}');
function run(label, p1, p2, turns = 1, prep, picks = []) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed: [1, 2, 3, 4]});
	b.setPlayer('p1', {name: 'p1', team: Teams.import(p1.join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import(p2.join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	if (prep) prep(b);
	const out = [];
	for (let t = 0; t < turns; t++) {
		const n = b.log.length;
		b.makeChoices(picks[t]?.[0] ?? 'move 1', picks[t]?.[1] ?? 'move 1');
		let g = 0; while (b.requestState === 'switch' && g++ < 3) b.makeChoices('switch 2', 'default');
		const log = b.log.slice(n);
		const trig = log.filter(l => /\|-ability\|p[12]a: [^|]*\|(Defiant|Competitive)\|/.test(l)).length;
		out.push(`T${t + 1} 발동 ${trig}회`);
	}
	const a = b.p1.active[0], d = b.p2.active[0];
	console.log(`[${label}] ${out.join(' · ')}\n   => p1 ${a.name} hp=${a.hp}/${a.maxhp} b=${bs(a.boosts)} | p2 ${d.name} hp=${d.hp}/${d.maxhp} b=${bs(d.boosts)}`);
}
for (const [ab, tag] of [['Defiant', '오기'], ['Competitive', '승기']]) {
	console.log(`===== ${tag} =====`);
	const H = SN(ab, ['Splash', 'Substitute']);
	run(`${tag} M1 문어굳히기(Octolock) 2턴 — 턴 끝 def·spd −1마다`, [SN('Thick Fat', ['Octolock', 'Splash']), BENCH], [H, BENCH], 2);
	run(`${tag} M2 추억의선물(Memento) — atk·spa −2 한 기술`, [SN('Thick Fat', ['Memento', 'Splash']), BENCH], [H, BENCH]);
	run(`${tag} M3 독실(Venom Drench) — 독 상태 보유자, atk·spa·spe −1`, [SN('Thick Fat', ['Venom Drench', 'Splash']), BENCH], [H, BENCH], 1, b => b.p2.active[0].setStatus('psn'));
	run(`${tag} M4 진흙뿌리기(Mud-Slap) — 명중률 −1`, [SN('Thick Fat', ['Mud-Slap', 'Splash']), BENCH], [H, BENCH]);
	run(`${tag} M5 간지르기(Tickle) — atk·def −1`, [SN('Thick Fat', ['Tickle', 'Splash']), BENCH], [H, BENCH]);
	run(`${tag} M6 시럽봄(Syrup Bomb) 2턴 — 스피드 −1씩(턴 끝)`, [SN('Thick Fat', ['Syrup Bomb', 'Splash']), BENCH], [H, BENCH], 2);
}
console.log('===== 공격측 보유자 =====');
for (const [ab, tag] of [['Defiant', '오기'], ['Competitive', '승기']]) {
	run(`${tag} A1 미러아머(Mirror Armor) 방어측에게 겁나는얼굴 — 반사된 spe −2`, [SN(ab, ['Scary Face', 'Splash']), BENCH], [set('Corviknight', 'Mirror Armor', ['Splash']), BENCH]);
	run(`${tag} A2 껍질깨기(Shell Smash) 자기 사용 — def·spd −1, 공·특공·스 +2 (발동 없음)`, [SN(ab, ['Shell Smash', 'Splash']), BENCH], [BENCH, BENCH]);
	run(`${tag} A3 엄청난힘(Superpower) 자기 반동 + 방어측 미끈미끈(Gooey) 접촉 반응`, [SN(ab, ['Superpower', 'Splash']), BENCH], [SN('Gooey'), BENCH]);
}
