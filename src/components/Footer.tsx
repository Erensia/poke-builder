import "./Footer.css";

/**
 * 앱 셸 최하단 공용 푸터. 이 토이 프로젝트는 개인·비영리·광고 없음으로 운영하며, 포켓몬 관련
 * 명칭·이미지·자료의 저작권/상표권이 닌텐도(및 라이선서)에 있음을 밝힌다. 표시 페이지를 가리지
 * 않고 전 화면에 노출한다(백로그 §1-6).
 */
export function Footer() {
  return (
    <footer className="app-footer">
      <p className="app-footer-legal">
        Pokémon and Pokémon character names are trademarks of Nintendo.
        <br />
        Pokémon content and materials are trademarks and copyrights of Nintendo or its licensors.
        <br />
        All rights reserved.
      </p>
    </footer>
  );
}
