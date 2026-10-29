import { useRef, useState, type ChangeEvent } from "react";
import { Modal } from "./Modal";
import { exportBackup, MAX_BACKUP_BYTES, parseBackup } from "../lib/backup";
import type { Party, SlotPreset } from "../types/party";
import "./BackupModal.css";

interface BackupModalProps {
  partyPresets: Party[];
  slotPresets: SlotPreset[];
  onClose: () => void;
  /** 저장된 두 목록을 통째로 바꾼다(덮어쓰기) */
  onImport: (partyPresets: Party[], slotPresets: SlotPreset[]) => void;
}

type Parsed = NonNullable<ReturnType<typeof parseBackup>>;

const count = (parties: number, slots: number) => `파티 ${parties}개 · 포켓몬 ${slots}개`;

/**
 * 저장한 파티·포켓몬 빌드의 백업/복원(5.5 G1). 가져오기는 덮어쓰기라 파일을 읽어 검증한 뒤 확인 단계를 한 번 거친다 —
 * 네이티브 confirm은 자동화 도구에서 탭이 멈추므로 화면 안에서 묻는다.
 */
export function BackupModal({ partyPresets, slotPresets, onClose, onImport }: BackupModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Parsed | null>(null);

  function handleExport() {
    const url = URL.createObjectURL(new Blob([exportBackup(partyPresets, slotPresets)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `champions-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setPending(null);
    setNotice(`${count(partyPresets.length, slotPresets.length)}를 파일로 저장했어요.`);
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 골라도 change가 오게
    if (!file) return;
    setPending(null);
    if (file.size > MAX_BACKUP_BYTES) return setNotice("파일이 너무 커요(5MB 이하만 가져와요).");
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setNotice("파일을 읽지 못했어요.");
    }
    const parsed = parseBackup(text);
    if (!parsed) return setNotice("백업 파일이 아니에요.");
    // 쓸 수 있는 항목이 하나도 없는데 덮어쓰면 저장해 둔 것만 지워진다
    if (parsed.partyPresets.length + parsed.slotPresets.length === 0) return setNotice("가져올 수 있는 항목이 없어요.");
    setNotice("");
    setPending(parsed);
  }

  function handleConfirm() {
    if (!pending) return;
    onImport(pending.partyPresets, pending.slotPresets);
    setNotice(`${count(pending.partyPresets.length, pending.slotPresets.length)}를 가져왔어요${pending.skipped ? ` · 형식이 맞지 않아 ${pending.skipped}개 건너뜀` : ""}.`);
    setPending(null);
  }

  return (
    <Modal title="백업" onClose={onClose}>
      <p className="backup-hint">
        저장된 파티와 저장한 포켓몬을 파일 하나로 옮겨요. 브라우저 데이터를 지우거나 다른 브라우저로 옮길 때 쓰세요. 지금 {count(partyPresets.length, slotPresets.length)}가 저장돼 있어요.
      </p>
      <div className="backup-actions tap-targets">
        <button type="button" onClick={handleExport} disabled={partyPresets.length + slotPresets.length === 0}>
          내보내기
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          가져오기
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={handleFile} />
      </div>
      {pending && (
        <div className="backup-confirm" role="group" aria-label="덮어쓰기 확인">
          <p>
            지금 저장된 {count(partyPresets.length, slotPresets.length)}가 파일 내용({count(pending.partyPresets.length, pending.slotPresets.length)})으로 바뀌어요. 되돌릴 수 없어요.
            {pending.skipped > 0 && ` 형식이 맞지 않는 ${pending.skipped}개는 빠져요.`}
          </p>
          <div className="backup-actions tap-targets">
            <button type="button" className="is-danger" onClick={handleConfirm}>
              덮어쓰기
            </button>
            <button type="button" autoFocus onClick={() => setPending(null)}>
              취소
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p className="backup-notice" role="status">
          {notice}
        </p>
      )}
    </Modal>
  );
}
