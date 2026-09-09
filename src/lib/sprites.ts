import type { Pokemon, PokemonGender } from "../types/pokemon";
import { megaFormFullName, findMegaFormByStone } from "./pokemonForm";
import manifest from "../data/spriteManifest.json";

/**
 * 포켓몬 아바타 스프라이트 해석. `public/sprites/` 를 스캔해 만든 `spriteManifest.json`
 * ({ 공백제거한_파일명: "/sprites/..." })에서 찾는다. 매니페스트는 `npm run sprites` 로 재생성.
 *
 * 파일명 규칙(사용자 제공): `{종족명}.webp` 기본, 폼은 괄호 접미사 —
 *  - 성별: `{종족명}(수컷|암컷)`  (genderedSprite 종)
 *  - 겉모습: `{종족명}({cosmeticForm.label})`  (마휘핑·비비용 등)
 *  - 폼 변종: `{종족명}({formVariant.label})`  (루가루암)
 *  - 크기 변종: `{종족명}({sizeForm.label})`  (펌킨인)
 *  - 리전폼: `{기본명}(알로라|가라르|히스이|팔데아 …)`
 *  - 메가: `메가진화/메가{종족명}[XY]`  (= pokemonForm.megaFormFullName)
 * 매칭이 없으면 null — 호출부(PokemonAvatar)가 이니셜+그라디언트로 폴백한다.
 */

const MANIFEST = manifest as Record<string, string>;

/** 매칭 키 정규화 — 매니페스트와 동일하게 공백만 제거(라벨 "한낮의모습" ↔ 파일 "한낮의 모습"). */
const norm = (s: string): string => s.replace(/\s+/g, "");

/** 매니페스트에서 정규화 키로 찾는다. */
function look(key: string | undefined | null): string | null {
  if (!key) return null;
  return MANIFEST[norm(key)] ?? null;
}

/** 범용 메가진화 심볼 아이콘(`public/sprites/메가진화/메가진화.webp`) — 특정 종과 무관한 메가 마크.
 * 배틀타워 메가진화 선언 토글 등에서 쓴다. 에셋이 없으면 null. */
export const MEGA_SYMBOL_SPRITE_URL: string | null = look("메가진화");

/**
 * `pokemon.id` 가 파일명 stem 과 다른 종(리전폼 접두사, 파일명 오타 등)의 보정.
 * 값은 파일명 stem(공백 유무 무관 — look 이 정규화한다).
 */
const ID_TO_SPRITE_STEM: Record<string, string> = {
  // 팔데아 리전폼: id 는 "팔데아" 접두사, 파일명은 "켄타로스(팔데아 …종)".
  팔데아켄타로스컴뱃종: "켄타로스(팔데아 컴뱃종)",
  팔데아켄타로스블레이즈종: "켄타로스(팔데아 블레이즈종)",
  팔데아켄타로스워터종: "켄타로스(팔데아 워터종)",
  플라엣테영원의꽃: "플라엣테(영원의 꽃)",
};

/** 리전폼: id 가 `알로라|가라르|히스이` 로 시작하면 `{나머지}({접두사})` 파일명으로 바꿔 본다. */
function regionalStem(id: string): string | null {
  const m = id.match(/^(알로라|가라르|히스이)(.+)$/);
  return m ? `${m[2]}(${m[1]})` : null;
}

/** pokemon.formVariants 에서 id 로 폼을 찾는다(기준 폼이어도 반환 — resolveFormVariant 와 다름). */
function pickFormVariant(pokemon: Pokemon, formVariantId?: string) {
  const forms = pokemon.formVariants;
  if (!forms || forms.length === 0) return undefined;
  return (
    forms.find((f) => f.id === formVariantId) ??
    forms.find((f) => f.standard) ??
    forms[0]
  );
}

function pickSizeForm(pokemon: Pokemon, sizeFormId?: string) {
  const forms = pokemon.sizeForms;
  if (!forms || forms.length === 0) return undefined;
  return forms.find((f) => f.id === sizeFormId) ?? forms.find((f) => f.standard) ?? forms[0];
}

function pickCosmeticForm(pokemon: Pokemon, cosmeticFormId?: string) {
  const forms = pokemon.cosmeticForms;
  if (!forms || forms.length === 0) return undefined;
  return forms.find((f) => f.id === cosmeticFormId) ?? forms.find((f) => f.standard) ?? forms[0];
}

export interface SpriteFormOptions {
  /** getEffectiveGender 결과. genderedSprite 종에서 수컷/암컷 스프라이트를 가른다. 미지정이면 수컷. */
  gender?: PokemonGender | null;
  /** 슬롯의 cosmeticForm(마휘핑·비비용 등). 미지정이면 기준 모습. */
  cosmeticForm?: string;
  /** 슬롯의 formVariant(루가루암). 미지정이면 기준 폼. */
  formVariant?: string;
  /** 슬롯의 sizeForm(펌킨인). 미지정이면 기준 크기. */
  sizeForm?: string;
  /** 활성 메가폼 id(예: "리자몽-메가X"). */
  activeMegaForm?: string;
  /** 장착 도구 — 메가스톤이면 그 메가폼 스프라이트를 쓴다. activeMegaForm 이 우선. */
  item?: string | null;
}

/**
 * 이 포켓몬(+폼 옵션)에 맞는 스프라이트 URL. 없으면 null.
 * 폼 우선순위: 메가 → 겉모습 → 폼 변종 → 크기 변종 → 성별 → 리전/오타 보정 → 기본명.
 * 폼 파일만 있고 기본 파일이 없는 종(펌킨인·루가루암·마휘핑 등)은 기준 폼 파일로 자연히 떨어진다.
 */
export function resolvePokemonSpriteUrl(pokemon: Pokemon, opts: SpriteFormOptions = {}): string | null {
  // 1) 메가
  const mega =
    pokemon.megaEvolutions?.find((m) => m.form === opts.activeMegaForm) ??
    findMegaFormByStone(pokemon, opts.item ?? null);
  if (mega) {
    const hit = look(megaFormFullName(mega));
    if (hit) return hit;
  }

  // 2) 겉모습(마휘핑 계열)
  if (pokemon.cosmeticForms) {
    const cf = pickCosmeticForm(pokemon, opts.cosmeticForm);
    const hit = look(cf && `${pokemon.id}(${cf.label})`);
    if (hit) return hit;
  }

  // 3) 폼 변종(루가루암 계열)
  if (pokemon.formVariants) {
    const fv = pickFormVariant(pokemon, opts.formVariant);
    const hit = look(fv && `${pokemon.id}(${fv.label})`);
    if (hit) return hit;
  }

  // 4) 크기 변종(펌킨인 계열)
  if (pokemon.sizeForms) {
    const sf = pickSizeForm(pokemon, opts.sizeForm);
    const hit = look(sf && `${pokemon.id}(${sf.label})`);
    if (hit) return hit;
  }

  // 5) 성별(화염레오·대쓰여너·냐오닉스)
  if (pokemon.genderedSprite) {
    const g = opts.gender === "female" ? "암컷" : "수컷";
    const hit = look(`${pokemon.id}(${g})`);
    if (hit) return hit;
  }

  // 6) 리전폼/파일명 보정
  const overridden = look(ID_TO_SPRITE_STEM[pokemon.id]) ?? look(regionalStem(pokemon.id));
  if (overridden) return overridden;

  // 7) 기본명
  return look(pokemon.id);
}
