import type { AbilityHitTrigger } from "../types/ability";
import type { Move } from "../types/move";

/**
 * hitTrigger.on 조건이 이번에 실제로 맞은 기술과 맞아떨어지는지 판정한다. 확률(chance)은
 * battleSimulator.ts가 별도로 굴린다 — 이 함수는 "발동 자격이 있는 기술인지"만 본다.
 */
export function hitTriggerMatchesMove(trigger: AbilityHitTrigger, move: Move): boolean {
  const makesContact = move.makesContact ?? false;
  switch (trigger.on) {
    case "physicalContact":
      return move.category === "physical" && makesContact;
    case "contact":
      return makesContact;
    case "physical":
      return move.category === "physical";
    case "damaging":
      return true;
  }
}
