import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSw } from './lib/registerSw'
import { SpeedInsights } from '@vercel/speed-insights/react'

// 저장 데이터(파티·프리셋)가 용량 부족으로 자동 삭제되지 않게 영구 저장을 요청한다(5.5 G1 B). 허용 여부는 브라우저가 정하고, 직접 지우는 것까지 막지는 못한다
void navigator.storage?.persist?.()?.catch(() => {})

// 서비스 워커(6.5 P1) — 빌드 결과에서만 등록한다
registerSw()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Vercel Speed Insights(7.4) — 배포된 사이트에서만 방문자 웹 성능 지표를 보낸다(개발 서버는 보내지 않음). 대시보드에서 Speed Insights를 켜야 수집된다 */}
    <SpeedInsights />
  </StrictMode>,
)
