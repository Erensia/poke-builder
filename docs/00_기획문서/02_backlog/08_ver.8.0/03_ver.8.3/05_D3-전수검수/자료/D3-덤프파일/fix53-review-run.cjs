// fix-53 (E8-44 싱크로) — 보유자가 공격측일 때 방어측 효과로 걸린 상태이상의 복사. Showdown 965a535 (gen9championsbssregmc) 실행 대조. 사용법: node fix53-review-run.cjs <빌드 폴더>
// p1 = 싱크로 보유자(공격측), p2 = 방어측. 확률 특성은 첫 시드(1~80)에서 p1이 상태이상에 걸리는 장면을 찾아 그 실행을 출력한다.
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves, item) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
const SN = (ab, moves = ['Splash'], item, sp = 'Snorlax') => set(sp, ab, moves, item);
const BENCH = SN('Thick Fat');
const RE = /^\|(move|-damage|-status|-curestatus|-immune|-fail|-activate|-ability|-start|faint|cant|-miss)\|/;
function make(p1, p2, seed) {
	const b = new Battle({formatid: 'gen9championsbssregmc', seed});
	b.setPlayer('p1', {name: 'p1', team: Teams.import(p1.join('\n\n'))});
	b.setPlayer('p2', {name: 'p2', team: Teams.import(p2.join('\n\n'))});
	if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
	return b;
}
const fmt = (b, n) => b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1).replace(/\|\[from\]/g, '<').replace(/\|p[12]a: /g, '|')).join(' / ');
// choices: 턴별 [p1, p2] 입력. 첫 턴들은 준비(예: p2 Safeguard), 마지막 턴에서 pred 판정.
function first(label, p1, p2, pred, {prep, turns = [['move 1', 'move 1']]} = {}) {
	for (let sd = 1; sd <= 80; sd++) {
		const b = make(p1, p2, [sd, sd + 1, sd + 2, sd + 3]);
		if (prep) prep(b);
		let n = b.log.length;
		for (let t = 0; t < turns.length; t++) { n = b.log.length; b.makeChoices(turns[t][0], turns[t][1]); }
		if (pred(b)) {
			const a = b.p1.active[0], d = b.p2.active[0];
			console.log(`--- ${label} (seed ${sd})\n   ${fmt(b, n)}\n   => p1 ${a.name} hp=${a.hp}/${a.maxhp} st=${a.status || '-'} | p2 ${d.name} hp=${d.hp}/${d.maxhp} st=${d.status || '-'}`);
			return;
		}
	}
	console.log(`--- ${label} : 80개 시드 중 반응 없음`);
}
const SY = (mv = ['Iron Head', 'Splash']) => SN('Synchronize', mv);
const hit = b => !!b.p1.active[0].status;

console.log('===== R. 보유자(p1 공격측)가 방어측 효과로 걸린 상태이상 → 방어측에 복사? =====');
first('R1 정전기(Static) — 접촉', [SY(), BENCH], [SN('Static'), BENCH], hit);
first('R2 불꽃몸(Flame Body)', [SY(), BENCH], [SN('Flame Body'), BENCH], hit);
first('R3 독가시(Poison Point)', [SY(), BENCH], [SN('Poison Point'), BENCH], hit);
first('R4 포자(Effect Spore) — 독·마비는 복사, 잠듦은 복사 안 함', [SY(), BENCH], [SN('Effect Spore'), BENCH], hit);
first('R4b 포자 — 잠듦이 걸린 장면(복사 안 함)', [SY(), BENCH], [SN('Effect Spore'), BENCH], b => b.p1.active[0].status === 'slp');
first('R5 하바네로분출(Spicy Spray) — 비접촉 기술(Water Gun)로도 화상', [SY(['Water Gun', 'Splash']), BENCH], [SN('Spicy Spray'), BENCH], hit);
first('R6 부리캐논(Beak Blast) — p2가 부리캐논, p1 선공 접촉기', [SN('Synchronize', ['Iron Head', 'Splash']), BENCH], [SN('Thick Fat', ['Beak Blast', 'Splash']), BENCH], hit);
first('R7 방어측이 이 타로 기절(HP 1) — 정전기는 발동해도 복사 불가', [SY(), BENCH], [SN('Static'), BENCH], b => b.p2.active[0].fainted && !!b.p1.active[0].status, {prep: b => b.p2.active[0].sethp(1)});
first('R8 방어측이 전기 타입(Raichu 정전기) — 마비 복사 면역', [SY(), BENCH], [set('Raichu', 'Static', ['Splash']), BENCH], hit);
first('R9 방어측 편에 신비의부적(Safeguard, 1턴째에 건다) — 복사 차단', [SY(), BENCH], [SN('Static', ['Safeguard', 'Splash']), BENCH], b => !!b.p1.active[0].status, {turns: [['move 2', 'move 1'], ['move 1', 'move 2']]});
first('R10 방어측이 이미 상태이상(독) — 불꽃몸 화상 복사 실패', [SY(), BENCH], [SN('Flame Body'), BENCH], b => b.p1.active[0].status === 'brn', {prep: b => b.p2.active[0].setStatus('psn')});
first('R11 다단 접촉(Fury Swipes) × 정전기 — 첫 타 마비 후 복사', [SY(['Fury Swipes', 'Splash']), BENCH], [SN('Static'), BENCH], hit);
first('R12 둘 다 싱크로+보유자가 접촉 반응으로 독 — 방어측은 독가시(Poison Point)·싱크로 아님 (참고 R3와 동일)', [SY(), BENCH], [SN('Poison Point'), BENCH], hit);
