const PS = process.argv[2]; const {Battle, Teams} = require(PS + '/dist/sim');
const set = (sp, ab, moves) => `${sp}\nAbility: ${ab}\n${moves.map(m => '- ' + m).join('\n')}`;
function cnt(p1, p2, turns) { let par = 0, n = 200;
  for (let sd = 1; sd <= n; sd++) { const b = new Battle({formatid: 'gen9championsbssregmc', seed: [sd, sd+1, sd+2, sd+3]});
    b.setPlayer('p1', {team: Teams.import(p1)}); b.setPlayer('p2', {team: Teams.import(p2)});
    if (b.requestState === 'teampreview') b.makeChoices('default', 'default');
    for (const [a, c] of turns) b.makeChoices(a, c); if (b.p1.active[0].status === 'par') par++; }
  return `${par}/${n}`; }
console.log('대조(필드·부적 없음)', cnt(set('Snorlax','Synchronize',['Iron Head','Splash']), set('Snorlax','Static',['Splash','Misty Terrain']), [['move 2','move 1'],['move 1','move 1']]));
console.log('Y1 미스트필드', cnt(set('Snorlax','Synchronize',['Iron Head','Splash']), set('Snorlax','Static',['Splash','Misty Terrain']), [['move 2','move 2'],['move 1','move 1']]));
console.log('Y2 신비의부적', cnt(set('Snorlax','Synchronize',['Iron Head','Safeguard']), set('Snorlax','Static',['Splash']), [['move 2','move 1'],['move 1','move 1']]));
