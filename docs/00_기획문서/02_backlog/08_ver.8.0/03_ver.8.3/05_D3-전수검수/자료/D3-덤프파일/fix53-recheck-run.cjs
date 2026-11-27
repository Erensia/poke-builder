// fix-53 검수 추가 장면: Showdown 965a535 (gen9championsbssregmc). 사용법: node fix53-recheck-run.cjs <ps 폴더>
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves, item) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
const SN = (ab, moves = ['Splash'], item, sp = 'Snorlax') => set(sp, ab, moves, item);
const BENCH = SN('Thick Fat');
const RE = /^\|(move|-status|-curestatus|-immune|-fail|-activate|-enditem|cant|-fieldstart)\|/;
function make(p1, p2, seed) {
  const b = new Battle({formatid: 'gen9championsbssregmc', seed});
  b.setPlayer('p1', {name: 'p1', team: Teams.import(p1.join('\n\n'))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import(p2.join('\n\n'))});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
  return b;
}
const fmt = (b, n) => b.log.slice(n).filter(l => RE.test(l)).map(l => l.slice(1).replace(/\|\[from\]/g, '<').replace(/\|p[12]a: /g, '|')).join(' / ');
function first(label, p1, p2, pred, {prep, turns = [['move 1', 'move 1']]} = {}) {
  for (let sd = 1; sd <= 200; sd++) {
    const b = make(p1, p2, [sd, sd + 1, sd + 2, sd + 3]);
    prep?.(b);
    let n = 0;
    for (const [c1, c2] of turns) { n = b.log.length; b.makeChoices(c1, c2); }
    if (pred(b)) {
      const a = b.p1.active[0], d = b.p2.active[0];
      console.log(`--- ${label} (seed ${sd})\n   ${fmt(b, n)}\n   => p1 ${a.name} st=${a.status || '-'} item=${a.item || '-'} | p2 ${d.name} st=${d.status || '-'} item=${d.item || '-'}`);
      return;
    }
  }
  console.log(`--- ${label} : 반응 없음`);
}
const SY = (mv = ['Iron Head', 'Splash'], item) => SN('Synchronize', mv, item);
const gotStatus = b => b.log.some(l => /^\|-status\|p1a/.test(l));
// X1 방어측 리샘열매: 복사된 상태이상을 즉시 치료하는가
first('X1 방어측 리샘열매 + 정전기', [SY(), BENCH], [SN('Static', ['Splash'], 'Lum Berry'), BENCH], gotStatus);
// X2 부리캐논 보유자 리샘열매: 치료 시점이 부리캐논 발사 전인가
first('X2 부리캐논 + 리샘열매', [SY(), BENCH], [SN('Thick Fat', ['Beak Blast', 'Splash'], 'Lum Berry'), BENCH], gotStatus);
// X3 공격측(보유자) 리샘열매: 자기는 치료돼도 복사는 일어나는가
first('X3 보유자 리샘열매 + 정전기', [SY(['Iron Head', 'Splash'], 'Lum Berry'), BENCH], [SN('Static'), BENCH], gotStatus);
// X4 미스트필드(방어측 접지): 복사 차단
first('X4 미스트필드 + 정전기(보유자 비행·방어측 접지)', [set('Togekiss', 'Synchronize', ['Iron Head', 'Splash']), BENCH], [SN('Static', ['Misty Terrain', 'Splash']), BENCH], gotStatus, {turns: [['move 2', 'move 1'], ['move 1', 'move 2']]});
// X5 실제 로스터: 라플레시아(풀/독) 포자 — 독은 면역, 마비만 복사
first('X5 라플레시아 포자 → 독', [SY(), BENCH], [set('Vileplume', 'Effect Spore', ['Splash']), BENCH], b => b.p1.active[0].status === 'psn');
first('X5b 라플레시아 포자 → 마비', [SY(), BENCH], [set('Vileplume', 'Effect Spore', ['Splash']), BENCH], b => b.p1.active[0].status === 'par');
// X6 실제 로스터: 스코빌런(풀/불꽃) 하바네로분출 — 화상 면역
first('X6 스코빌런 하바네로분출', [SY(['Water Gun', 'Splash']), BENCH], [set('Scovillain', 'Spicy Spray', ['Splash']), BENCH], gotStatus);
// X7 실제 로스터: 불카모스(벌레/불꽃) 불꽃몸, 드래캄(독/드래곤) 독가시
first('X7 불카모스 불꽃몸', [SY(), BENCH], [set('Volcarona', 'Flame Body', ['Splash']), BENCH], gotStatus);
first('X7b 드래캄 독가시', [SY(), BENCH], [set('Dragalge', 'Poison Point', ['Splash']), BENCH], gotStatus);
// X8 실제 로스터: 왕큰부리(노말/비행) 부리캐논 — 복사 성공, 화상으로 부리캐논 위력 반감 확인
first('X8 왕큰부리 부리캐논', [SY(), BENCH], [set('Toucannon', 'Keen Eye', ['Beak Blast', 'Splash']), BENCH], gotStatus);
// X10 토치카(Baneful Bunker): 접촉기로 막혀 독 → 토치카 사용자에게 복사되는가
first('X10 토치카 + 접촉기', [SY(), BENCH], [SN('Thick Fat', ['Baneful Bunker', 'Splash']), BENCH], gotStatus);
first('X10b 더시마사리(독/물) 토치카', [SY(), BENCH], [set('Toxapex', 'Regenerator', ['Baneful Bunker', 'Splash']), BENCH], gotStatus);
// X11 (기존 방향) 상대가 독구슬 내던지기 → 방어측 싱크로 보유자 맹독 → 던진 쪽에 복사되는가
first('X11 내던지기(독구슬) → 방어측 싱크로', [SN('Thick Fat', ['Fling', 'Splash'], 'Toxic Orb'), BENCH], [SN('Synchronize'), BENCH], b => b.log.some(l => /^\|-status\|p2a/.test(l)));
first('X11b 내던지기(화염구슬) → 방어측 싱크로', [SN('Thick Fat', ['Fling', 'Splash'], 'Flame Orb'), BENCH], [SN('Synchronize'), BENCH], b => b.log.some(l => /^\|-status\|p2a/.test(l)));
// Y1·Y2 (기존 차이 확인) 보유자 쪽 미스트필드(접지)·신비의부적이면 정전기 자체가 막힌다
first('Y1 보유자 접지 + 미스트필드 + 정전기', [SY(), BENCH], [SN('Static', ['Misty Terrain', 'Splash']), BENCH], b => b.log.some(l => /Static/.test(l)), {turns: [['move 2', 'move 1'], ['move 1', 'move 2']]});
first('Y2 보유자 편 신비의부적 + 정전기', [SY(['Iron Head', 'Safeguard']), BENCH], [SN('Static'), BENCH], b => b.log.some(l => /Static|Safeguard\|/.test(l)) && b.turn > 2, {turns: [['move 2', 'move 1'], ['move 1', 'move 1']]});
