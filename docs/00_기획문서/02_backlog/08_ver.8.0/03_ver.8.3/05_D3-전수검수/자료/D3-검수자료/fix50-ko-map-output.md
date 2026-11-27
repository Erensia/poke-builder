# fix-50 면제 기술 영문→한글 매핑 출력 (fix50-ko-map.cjs, 2026-11-27)

출처: PokeAPI `data/v2/csv/moves.csv`·`move_names.csv`(`local_language_id = 3`), Showdown 965a535 `gen9championsbssregmc`. 
미매핑: **0건**.

## 대상 분류별 면제 79종
- **self 61**: 토치카(Baneful Bunker), 소울비트(Clangorous Soul), 성장(Growth), 킹실드(King's Shield), 배수의진(No Retreat), 파워시프트(Power Shift), 방어(Protect), 니들가드(Spiky Shield), 볼가득넣기(Stuff Cheeks), 희망사항(Wish), 녹기(Acid Armor), 고속이동(Agility), 사이드체인지(Ally Switch), 망각술(Amnesia), 아쿠아링(Aqua Ring), 배턴터치(Baton Pass), 배북(Belly Drum), 벌크업(Bulk Up), 명상(Calm Mind), 충전(Charge), 똬리틀기(Coil), 흉내쟁이(Copycat), 코스믹파워(Cosmic Power), 코튼가드(Cotton Guard), 길동무(Destiny Bond), 판별(Detect), 그림자분신(Double Team), 용의춤(Dragon Dance), 버티기(Endure), 기충전(Focus Energy), 날따름(Follow Me), 치유소원(Healing Wish), 뿌리박기(Ingrain), 철벽(Iron Defense), 전자부유(Magnet Rise), 작아지기(Minimize), 달빛(Moonlight), 아침햇살(Morning Sun), 나쁜음모(Nasty Plot), 파워트릭(Power Trick), 나비춤(Quiver Dance), 분노가루(Rage Powder), HP회복(Recover), 리사이클(Recycle), 잠자기(Rest), 회생의기도(Revival Blessing), 록커트(Rock Polish), 날개쉬기(Roost), 꼬리자르기(Shed Tail), 껍질깨기(Shell Smash), 농성(Shelter), 기어체인지(Shift Gear), 게으름피우기(Slack Off), 잠꼬대(Sleep Talk), 알낳기(Soft-Boiled), 비축하기(Stockpile), 대타출동(Substitute), 꿀꺽(Swallow), 칼춤(Swords Dance), 광합성(Synthesis), 정리정돈(Tidy Up)
- **allySide 8**: 오로라베일(Aurora Veil), 빛의장막(Light Screen), 자기장조작(Magnetic Flux), 패스트가드(Quick Guard), 리플렉터(Reflect), 신비의부적(Safeguard), 순풍(Tailwind), 와이드가드(Wide Guard)
- **adjacentAlly 4**: 드래곤옐(Dragon Cheer), 아로마미스트(Aromatic Mist), 코칭(Coaching), 도우미(Helping Hand)
- **allies 2**: 멀리짖기(Howl), 생명의물방울(Life Dew)
- **adjacentAllyOrSelf 2**: 우유마시기(Milk Drink), 경혈찌르기(Acupressure)
- **allyTeam 1**: 치료방울(Heal Bell)
- **foeSide(비 mustpressure) 1**: 끈적끈적네트(Sticky Web)

## 면제 아님(−2)
- `mustpressure` 4종: 봉인, 압정뿌리기, 스텔스록, 독압정
- 저주: 고정 분류 불가 — 비고스트 사용자면 면제, 고스트면 −2(검수서 R1)

## 엔진에 없다고 한 5종
파워시프트·기어체인지·알낳기(이상 면제 대상), 버섯포자·발버둥(면제 아님)

## 시험 10용 배열 — 엔진 기준 76종(위 79종 − 파워시프트·기어체인지·알낳기)
```json
["토치카","소울비트","성장","킹실드","배수의진","방어","니들가드","볼가득넣기","희망사항","녹기","고속이동","사이드체인지","망각술","아쿠아링","배턴터치","배북","벌크업","명상","충전","똬리틀기","흉내쟁이","코스믹파워","코튼가드","길동무","판별","그림자분신","용의춤","버티기","기충전","날따름","치유소원","뿌리박기","철벽","전자부유","작아지기","달빛","아침햇살","나쁜음모","파워트릭","나비춤","분노가루","HP회복","리사이클","잠자기","회생의기도","록커트","날개쉬기","꼬리자르기","껍질깨기","농성","게으름피우기","잠꼬대","비축하기","대타출동","꿀꺽","칼춤","광합성","정리정돈","오로라베일","빛의장막","자기장조작","패스트가드","리플렉터","신비의부적","순풍","와이드가드","드래곤옐","아로마미스트","코칭","도우미","멀리짖기","생명의물방울","우유마시기","경혈찌르기","치료방울","끈적끈적네트"]
```
PokeAPI 표기(예: "HP회복", "배북")와 `moves.json` id가 다를 수 있으니 대조 후 고정한다.
