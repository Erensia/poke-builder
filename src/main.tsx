import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 저장 데이터(파티·프리셋)가 용량 부족으로 자동 삭제되지 않게 영구 저장을 요청한다(5.5 G1 B). 허용 여부는 브라우저가 정하고, 직접 지우는 것까지 막지는 못한다
void navigator.storage?.persist?.()?.catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
