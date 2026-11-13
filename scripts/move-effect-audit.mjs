// 효과 문구(effect) ↔ 기술 필드 값 대조(8.3 B3). validate-data.mjs가 경고로 쓰고, 시험(27-ver83-b3.mjs)이 직접 부른다 — 부수효과 없는 순수 함수.
// 문구의 숫자(확률·분수·타수·랭크)가 필드와 다른 기술을 걸러낸다. 휴리스틱이라 오탐·미탐이 있다(허용 목록으로 의도된 차이를 등록한다).
// 턴수는 엔진 상수가 값을 쥐고 있어 필드 대조가 불가능하다(설계서 C4) — 이 도구의 대상이 아니다.
const close = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// 문구의 분수 표현 → 값. "N%만큼"도 분수로 센다.
const FRACTION_WORDS = [
  [/(½|1\/2|절반|2분의 ?1)/, 0.5],
  [/(⅓|1\/3|3분의 ?1)/, 1 / 3],
  [/(¼|1\/4|4분의 ?1)/, 0.25],
  [/(⅛|1\/8|8분의 ?1)/, 0.125],
  [/(¾|3\/4|4분의 ?3)/, 0.75],
  [/(1\/16|16분의 ?1)/, 1 / 16],
];
const FRACTION_FIELDS = ["recoilFraction", "drainFraction", "healsFraction", "costsHpFraction", "crashFraction"];
const STAT_WORDS = { 공격: "atk", 방어: "def", 특수공격: "spa", 특공: "spa", 특수방어: "spd", 특방: "spd", 스피드: "spe", 명중률: "accuracy", 회피율: "evasion" };

/** 기술 객체를 재귀로 훑어 확률 필드(`chance`·`randomDoublePower`)의 숫자를 모은다 */
function collectChances(node, out = []) {
  if (Array.isArray(node)) node.forEach((v) => collectChances(v, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if ((k === "chance" || k === "randomDoublePower") && typeof v === "number") out.push(v);
      else collectChances(v, out);
    }
  }
  return out;
}

function fractionsIn(text) {
  const found = FRACTION_WORDS.filter(([re]) => re.test(text)).map(([, v]) => v);
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%\s*만큼/g)) found.push(+m[1] / 100);
  return found;
}

/** 한 기술의 문구 ↔ 필드 불일치 목록 [{ kind, msg }] — 없으면 [] */
export function auditMoveEffect(move) {
  const out = [];
  const text = move.effect ?? "";
  const add = (kind, msg) => out.push({ kind, msg });

  // K1 확률
  const pcts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%[의은는]?\s*확률/g)].map((m) => +m[1]);
  const chances = collectChances(move);
  if (pcts.length) {
    if (!chances.length) add("K1b", `확률 문구 ${pcts}%인데 chance 필드 없음`);
    else {
      const sum = chances.reduce((a, b) => a + b, 0);
      if (!pcts.some((p) => chances.some((c) => close(p, c, 0.1)) || close(p, sum, 0.1))) add("K1a", `확률 문구 ${pcts}% ↔ 필드 chance [${chances}]`);
    }
  } else if (!/확률/.test(text) && chances.some((c) => c < 100)) {
    add("K1c", `chance 필드 [${chances.filter((c) => c < 100)}]가 있는데 문구에 확률 표현 없음`); // chance 100(확정 효과)은 제외
  }

  // K2 분수 — 문구에 분수 표현이 있는데 어느 것도 필드와 같지 않을 때만(분수 표현이 없으면 검증 불가라 건너뜀)
  const fr = fractionsIn(text);
  if (fr.length) for (const k of FRACTION_FIELDS) if (typeof move[k] === "number" && !fr.some((f) => close(f, move[k]))) add("K2", `${k}=${move[k].toFixed(3)} ↔ 문구 분수 [${fr.map((f) => f.toFixed(3))}]`);

  // K3 타수 — 위력 있는 기술만, "쓸 수 없"이 있는 문구(트집·거대해머)는 건너뜀
  if (move.power > 0 && !/쓸 수 없/.test(text)) {
    const range = text.match(/(\d+)\s*[~～-]\s*(\d+)\s*회/);
    const seq = text.match(/(\d+)\s*회\s*연속/);
    const mx = text.match(/최대\s*(\d+)\s*회/);
    const multi = Array.isArray(move.multiHitPowers); // 맞을 때마다 위력이 달라지는 연타는 minHits가 1이라 최대만 본다
    if (range) { if (move.maxHits !== +range[2] || (!multi && move.minHits !== +range[1])) add("K3", `문구 ${range[1]}~${range[2]}회 ↔ 필드 ${move.minHits}~${move.maxHits}`); }
    else if (mx) { if (move.maxHits !== +mx[1]) add("K3", `문구 최대 ${mx[1]}회 ↔ 필드 maxHits ${move.maxHits}`); }
    else if (seq) { if (move.maxHits !== +seq[1] || (!multi && move.minHits !== +seq[1])) add("K3", `문구 ${seq[1]}회 연속 ↔ 필드 ${move.minHits}~${move.maxHits}`); }
  }

  // K4 랭크 — "(자신|상대)의 {스탯}(들)을 N랭크 올린다/떨어뜨린다"
  for (const m of text.matchAll(/(자신|상대)의\s*([^을를이가,.]+?)(?:을|를|이|가)?\s*(\d)랭크\s*(올린다|떨어뜨린다|내린다)/g)) {
    const target = m[1] === "자신" ? "self" : "opponent";
    const delta = (m[4] === "올린다" ? 1 : -1) * +m[3];
    for (const word of m[2].split(/[과와,·\s]+/).filter(Boolean)) {
      const stat = STAT_WORDS[word];
      if (stat && !(move.statChanges ?? []).some((s) => s.target === target && s.stat === stat && s.delta === delta)) add("K4", `문구 ${m[1]} ${word} ${delta > 0 ? "+" : ""}${delta} ↔ 필드 statChanges [${(move.statChanges ?? []).map((s) => `${s.target}.${s.stat}${s.delta > 0 ? "+" : ""}${s.delta}`)}]`);
    }
  }
  return out;
}

/**
 * 기술 전체 점검 + 허용 목록(기술명 → 사유) 적용. 반환: { warnings, errors }.
 * 허용 항목은 사유가 필수(비면 오류)이고, 더 이상 걸리지 않으면 stale 경고 — 수정 뒤 허용 목록이 낡아 쌓이지 않게 한다.
 */
export function auditMoves(moves, allow = {}) {
  const warnings = [], errors = [], used = new Set();
  for (const m of moves) {
    const found = auditMoveEffect(m);
    if (!found.length) continue;
    if (Object.hasOwn(allow, m.name)) { used.add(m.name); continue; }
    for (const f of found) warnings.push(`move "${m.name}": ${f.kind} ${f.msg}`);
  }
  for (const [name, reason] of Object.entries(allow)) {
    if (!String(reason).trim()) errors.push(`data-allowlist moveEffectAudit "${name}": 사유가 비어 있다(허용 항목은 사유 필수)`);
    if (!used.has(name)) warnings.push(`data-allowlist moveEffectAudit "${name}": 더 이상 걸리지 않는다(stale) — 허용 목록에서 지울 것`);
  }
  return { warnings, errors };
}
