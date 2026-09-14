import { Modal } from "./Modal";
import type { BattleVideo } from "../types/battleVideo";
import "./PresetListModal.css";

interface BattleVideoListModalProps {
  videos: BattleVideo[];
  onClose: () => void;
  onView: (video: BattleVideo) => void;
  onDelete: (id: string) => void;
}

function winnerLabel(video: BattleVideo): string {
  if (video.winner === "draw") return "무승부";
  return `${video.winner === "a" ? video.labelA : video.labelB} 승리`;
}

/**
 * 저장된 배틀비디오 목록(§6) — 대전이 끝날 때마다 자동 저장되는 최근 3개를 보여준다. 이름 붙여
 * 저장하는 파티/빌드 프리셋과 달리 사용자가 직접 저장하지 않으므로 이름변경·수동저장 UI는 없다.
 */
export function BattleVideoListModal({ videos, onClose, onView, onDelete }: BattleVideoListModalProps) {
  const sorted = [...videos].sort((a, b) => b.savedAt - a.savedAt);

  function handleDelete(video: BattleVideo) {
    if (window.confirm(`"${video.labelA} vs ${video.labelB}" 배틀비디오를 삭제할까요?`)) {
      onDelete(video.id);
    }
  }

  return (
    <Modal title="배틀비디오" onClose={onClose}>
      <ul className="preset-list">
        {sorted.map((video) => (
          <li key={video.id} className="preset-item">
            <div className="preset-item-info">
              <span className="preset-item-name">
                {video.labelA} vs {video.labelB}
              </span>
              <span className="preset-item-meta">
                {winnerLabel(video)} · {new Date(video.savedAt).toLocaleString()}
              </span>
            </div>
            <div className="preset-item-actions">
              <button type="button" onClick={() => onView(video)}>
                보기
              </button>
              <button type="button" className="is-danger" onClick={() => handleDelete(video)}>
                삭제
              </button>
            </div>
          </li>
        ))}
        {sorted.length === 0 && (
          <li className="preset-list-empty">
            저장된 배틀비디오가 없습니다. 대전이 끝나면 자동으로 저장됩니다(최근 3개까지).
          </li>
        )}
      </ul>
    </Modal>
  );
}
