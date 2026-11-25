// fix-48 검수 — Showdown 965a535, gen9championsbssregmc. 사용법: node fix48-review-run.cjs <showdown 경로>
console.log('=== E8-26 특수 접촉기 × 정전기·독가시·불꽃몸 ===');
(() => {
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const F='gen9championsbssregmc';
const set = (sp, ab, item = '', moves = ['Splash']) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\nLevel: 50\n${moves.map(m => '- ' + m).join('\n')}`;
const BENCH = set('Snorlax', 'Thick Fat');
function go(label, a, d) { const b = new Battle({formatid: F, seed:[1,2,3,4]});
  b.setPlayer('p1', {name: 'p1', team: Teams.import([a, BENCH].join('\n\n'))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import([d, BENCH].join('\n\n'))});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default'); b.randomChance=()=>true;
  b.makeChoices('move 1','move 1'); console.log(`[${label}] status=${b.p1.active[0].status||'-'}`); }
for (const [ab,sp] of [['Static','Raichu'],['Poison Point','Nidoking'],['Flame Body','Talonflame']])
  for (const m of ['Draining Kiss','Grass Knot','Infestation','Petal Dance','Surf'])
    go(`${ab} × ${m}`, set('Sylveon','Pixilate','',[m]), set(sp, ab));
go('Static × Draining Kiss + 방진패드', set('Sylveon','Pixilate','Protective Pads',['Draining Kiss']), set('Raichu','Static'));
})();
console.log('=== E8-28 드레인 × 반응 (부자유친·유폭·해감액) ===');
(() => {
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const F='gen9championsbssregmc';
const set = (sp, ab, item = '', moves = ['Splash']) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\nLevel: 50\n${moves.map(m => '- ' + m).join('\n')}`;
const BENCH = set('Snorlax', 'Thick Fat');
function mk(p1, p2) { const b = new Battle({formatid: F, seed:[1,2,3,4]});
  b.setPlayer('p1', {name: 'p1', team: Teams.import([p1, BENCH].join('\n\n'))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import([p2, BENCH].join('\n\n'))});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default'); return b; }
const R = (b, n) => b.log.slice(n).filter(l => /^\|(move|-heal|-damage|-hitcount|faint|-ability)\|/.test(l) && !/\/100/.test(l)).map(l=>l.slice(1).replace(/\|\[of\].*$/,'')).join(' / ');
function go(label, a, d, prep, c1='move 1') { const b=mk(a,d); if(prep)prep(b); const n=b.log.length; b.makeChoices(c1,'move 1'); console.log(`[${label}] ${R(b,n)}`); }
const RS = set('Garchomp','Rough Skin');
go('풀피 드레인펀치 vs 까칠한피부', set('Conkeldurr','Guts','',['Drain Punch']), RS);
go('HP-5 드레인펀치 vs 까칠한피부', set('Conkeldurr','Guts','',['Drain Punch']), RS, b=>b.p1.active[0].sethp(b.p1.active[0].maxhp-5));
go('HP1 드레인펀치 vs 까칠한피부', set('Conkeldurr','Guts','',['Drain Punch']), RS, b=>b.p1.active[0].sethp(1));
go('HP1 드레인펀치 vs 울퉁불퉁멧', set('Conkeldurr','Guts','',['Drain Punch']), set('Garchomp','Sand Veil','Rocky Helmet'), b=>b.p1.active[0].sethp(1));
go('메가캥카 HP60 드레인펀치 vs 까칠한피부', set('Kangaskhan','Scrappy','Kangaskhanite',['Drain Punch']), RS, b=>b.p1.active[0].sethp(60), 'move 1 mega');
go('메가캥카 HP1 드레인펀치 vs 울퉁불퉁멧', set('Kangaskhan','Scrappy','Kangaskhanite',['Drain Punch']), set('Garchomp','Sand Veil','Rocky Helmet'), b=>b.p1.active[0].sethp(1), 'move 1 mega');
go('HP1 드레인펀치 vs 유폭 KO', set('Conkeldurr','Guts','',['Drain Punch']), set('Skuntank','Aftermath'), b=>{b.p1.active[0].sethp(1); b.p2.active[0].sethp(1);});
go('HP30 드레인펀치 vs 유폭 KO', set('Conkeldurr','Guts','',['Drain Punch']), set('Skuntank','Aftermath'), b=>{b.p1.active[0].sethp(30); b.p2.active[0].sethp(20);});
go('HP30 흡혈 vs 해감액+울퉁불퉁멧', set('Scizor','Technician','',['Leech Life']), set('Tentacruel','Liquid Ooze','Rocky Helmet'), b=>b.p1.active[0].sethp(30));
go('HP50 드레인펀치(생명의구슬) vs 까칠한피부', set('Conkeldurr','Guts','Life Orb',['Drain Punch']), RS, b=>b.p1.active[0].sethp(50));
})();
console.log('=== E8-27 저주받은바디 ===');
(() => {
const PS = process.argv[2];
const {Battle, Teams} = require(PS + '/dist/sim');
const F='gen9championsbssregmc';
const set = (sp, ab, item = '', moves = ['Splash']) => `${sp}${item ? ' @ ' + item : ''}\nAbility: ${ab}\nLevel: 50\n${moves.map(m => '- ' + m).join('\n')}`;
const BENCH = set('Snorlax', 'Thick Fat');
function mk(p1, p2) { const b = new Battle({formatid: F, seed:[1,2,3,4]});
  b.setPlayer('p1', {name: 'p1', team: Teams.import([p1, BENCH].join('\n\n'))});
  b.setPlayer('p2', {name: 'p2', team: Teams.import([p2, BENCH].join('\n\n'))});
  if (b.requestState === 'teampreview') b.makeChoices('default', 'default'); return b; }
const force = b => { b.randomChance = () => true; };
const R = (b, n) => b.log.slice(n).filter(l => /^\|(move|-start|-end|cant|-enditem|-fail|-block|-activate)\|/.test(l) && !/Splash/.test(l)).map(l=>l.slice(1).replace(/\|\[of\].*$/,'')).join(' / ');
// 지속: T1 부여 후 매 턴 1번 기술 선택 가능 여부
{ const b = mk(set('Snorlax','Thick Fat','',['Crunch','Heavy Slam']), set('Dusknoir','Cursed Body')); force(b);
  for (let t=1;t<=6;t++){ const n=b.log.length; const req=b.p1.activeRequest?.active?.[0]?.moves?.[0]; b.makeChoices(req?.disabled?'move 2':'move 1','move 1'); b.randomChance=()=>false;
  console.log(`T${t} crunch disabled-in-request=${!!req?.disabled}: ${R(b,n)} | vol=${JSON.stringify(b.p1.active[0].volatiles.disable?{d:b.p1.active[0].volatiles.disable.duration,m:b.p1.active[0].volatiles.disable.move}:null)}`); } }
// 잠꼬대
{ const b = mk(set('Snorlax','Comatose','',['Sleep Talk','Crunch']), set('Dusknoir','Cursed Body')); force(b);
  b.p1.active[0].setStatus('slp'); b.p1.active[0].statusState.time=5; b.p1.active[0].statusState.startTime=5;
  const n=b.log.length; b.makeChoices('move 1','move 1'); console.log('[잠꼬대→깨물어부수기 vs 저주받은바디] '+R(b,n)+' | disable.move='+b.p1.active[0].volatiles.disable?.move); }
// 따라하기
{ const b = mk(set('Togekiss','Serene Grace','',['Copycat']), set('Dusknoir','Cursed Body','',['Shadow Sneak'])); force(b);
  const n=b.log.length; b.makeChoices('move 1','move 1'); console.log('[따라하기→야습 vs 저주받은바디] '+R(b,n)+' | disable.move='+b.p1.active[0].volatiles.disable?.move); }
// 마지막 PP
{ const b = mk(set('Snorlax','Thick Fat','',['Crunch']), set('Dusknoir','Cursed Body')); force(b); b.p1.active[0].moveSlots[0].pp=1;
  const n=b.log.length; b.makeChoices('move 1','move 1'); console.log('[마지막PP] '+R(b,n)+' | disable='+!!b.p1.active[0].volatiles.disable); }
// 멘탈허브
{ const b = mk(set('Snorlax','Thick Fat','Mental Herb',['Crunch']), set('Dusknoir','Cursed Body')); force(b);
  const n=b.log.length; b.makeChoices('move 1','move 1'); console.log('[멘탈허브] '+R(b,n)+' | disable='+!!b.p1.active[0].volatiles.disable+' item='+b.p1.active[0].item); }
// 아로마베일
{ const b = mk(set('Aromatisse','Aroma Veil','',['Moonblast']), set('Dusknoir','Cursed Body')); force(b);
  const n=b.log.length; b.makeChoices('move 1','move 1'); console.log('[아로마베일] '+R(b,n)+' | disable='+!!b.p1.active[0].volatiles.disable); }
// 교체 시 해제
{ const b = mk(set('Snorlax','Thick Fat','',['Crunch']), set('Dusknoir','Cursed Body')); force(b); b.makeChoices('move 1','move 1'); b.makeChoices('switch 2','move 1'); b.makeChoices('switch 2','move 1');
  console.log('[교체 후 복귀] disable='+!!b.p1.active[0].volatiles.disable); }
})();
