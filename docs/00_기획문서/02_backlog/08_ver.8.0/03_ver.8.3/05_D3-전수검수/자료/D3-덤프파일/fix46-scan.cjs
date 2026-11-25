// champions(Reg M-C) 합법 조합 스캔 — node fix46-scan.cjs <PS 경로>
const PS = process.argv[2];
const {Dex, TeamValidator} = require(PS + '/dist/sim');
const FMT = 'gen9championsbssregmc';
const v = TeamValidator.get(FMT);
const dex = Dex.forFormat(FMT);
const legal = (sp, ab, moves) => { const r = v.validateSet({species: sp, ability: ab, moves, evs: {hp: 4}, level: 50, nature: 'Hardy', item: ''}, {}); return !r || (!moves.length && r.length === 1 && /has no moves/.test(r[0])); };
const species = dex.species.all().filter(s => legal(s.name, Object.values(s.abilities)[0], []));
const has = (ab, moves = []) => species.filter(s => Object.values(s.abilities).includes(ab) && legal(s.name, ab, moves)).map(s => s.name);
const learn = mv => species.filter(s => legal(s.name, Object.values(s.abilities)[0], [mv])).map(s => s.name);
const out = (k, a) => console.log(`${k}: ${a.length} ${a.slice(0, 12).join(', ')}${a.length > 12 ? ' …' : ''}`);
out('합법 종', species.map(s => s.name));
for (const ab of ['Purifying Salt', 'Thermal Exchange', 'Insomnia', 'Vital Spirit', 'Sweet Veil', 'Leaf Guard', 'Flower Veil', 'Pastel Veil', 'Comatose', 'Shields Down', 'Misty Surge', 'Electric Surge', 'Trace', 'Mold Breaker', 'Teravolt', 'Turboblaze', 'Infiltrator', 'Corrosion'])
	out(`특성 ${ab}`, has(ab));
for (const ab of ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Purifying Salt', 'Leaf Guard']) out(`${ab}+Rest`, has(ab, ['Rest']));
for (const ab of ['Mold Breaker', 'Teravolt', 'Turboblaze']) for (const mv of ['Yawn', 'Will-O-Wisp', 'Toxic', 'Spore', 'Sleep Powder', 'Thunder Wave', 'Hypnosis'])
	{ const r = has(ab, [mv]); if (r.length) out(`${ab}+${mv}`, r); }
for (const mv of ['Yawn', 'Will-O-Wisp', 'Toxic', 'Thunder Wave', 'Spore', 'Sleep Powder', 'Hypnosis', 'Glare', 'Nuzzle'])
	{ const r = has('Infiltrator', [mv]); if (r.length) out(`Infiltrator+${mv}`, r); }
for (const mv of ['Misty Terrain', 'Electric Terrain', 'Safeguard', 'Skill Swap', 'Role Play', 'Entrainment', 'Uproar', 'Yawn', 'Forest\'s Curse']) out(`기술 ${mv}`, learn(mv));
out('Rest+Sleep Talk', species.filter(s => legal(s.name, Object.values(s.abilities)[0], ['Rest', 'Sleep Talk'])).map(s => s.name));
console.log('아이템 Electric Seed/Misty Seed/Terrain Extender:', ['Electric Seed', 'Misty Seed', 'Terrain Extender'].map(i => `${i}=${!dex.items.get(i).isNonstandard}`).join(' '));