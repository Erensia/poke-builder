import { useSwStatus } from "../hooks/useSwStatus";
import "./Footer.css";

/**
 * 앱 셸 최하단 공용 푸터. 이 토이 프로젝트는 개인·비영리·광고 없음으로 운영하며, 포켓몬 관련
 * 명칭·이미지·자료의 저작권/상표권이 닌텐도(및 라이선서)에 있음을 밝힌다. 표시 페이지를 가리지
 * 않고 전 화면에 노출한다(백로그 §1-6).
 */
export function Footer() {
  const { status: sw, warm } = useSwStatus();
  return (
    <footer className="app-footer">
      {sw !== "hidden" && (
        <p className="app-footer-sw" role="status">
          {sw === "ready" && `오프라인 사용 가능${warm && warm.done < warm.total ? ` · 이미지 준비 중 ${warm.done}/${warm.total}` : ""}`}
          {sw === "installing" && "오프라인 준비 중…"}
          {sw === "failed" && "오프라인 준비에 실패했어요"}
          {sw === "off-build" && "오프라인 캐시 꺼짐"}
          {sw === "off-flag" && (
            <>
              오프라인 캐시 꺼짐 · <a href="?sw=on">켜기</a>
            </>
          )}
        </p>
      )}
      <p className="app-footer-legal">
        Pokémon and Pokémon character names are trademarks of Nintendo. Pokémon content and
        materials are trademarks and copyrights of Nintendo or its licensors. All rights reserved.
      </p>
    </footer>
  );
}
