#!/usr/bin/env python3
"""public/sprites/ 이미지를 카테고리별 규격으로 통일한다.

규격(2026-09, 기존 에셋 실측 기준):
    포켓몬(1~9세대), 메가진화 : 128x128 RGBA WEBP
    도구(도구/ 바로 아래)      : 160x160 RGBA WEBP
    도구/메가스톤              :  40x40  RGBA PNG
    타입                      : SVG — 정규화 대상 아님(건너뜀)

용례:
    python scripts/normalize_sprites.py                     # 전체 검사(규격 이탈 목록만 출력)
    python scripts/normalize_sprites.py --fix               # 전체 검사 + 이탈분 제자리 변환
    python scripts/normalize_sprites.py a.png b.png --fix    # 신규 파일만 변환(경로에서 카테고리 추론)
    python scripts/normalize_sprites.py new.png --category 포켓몬 --fix   # 트리 밖 파일은 --category 지정

의존성: Pillow (`pip install Pillow`). --fix 후에는 `npm run sprites` 로 매니페스트를 재생성한다.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow 가 필요합니다:  pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "public" / "sprites"

# (목표 크기, 포맷, 확장자, 모드)
SPEC = {
    "포켓몬": ((128, 128), "WEBP", ".webp", "RGBA"),
    "메가진화": ((128, 128), "WEBP", ".webp", "RGBA"),
    "도구": ((160, 160), "WEBP", ".webp", "RGBA"),
    "메가스톤": ((40, 40), "PNG", ".png", "RGBA"),
}
WEBP_OPTS = {"quality": 85, "method": 6}
PNG_OPTS = {"optimize": True}

# 카테고리별 예외 파일(규격에서 일부러 벗어난 것). 파일명 stem 으로 매칭.
SKIP_STEMS = {"메가진화": {"메가진화"}}  # 범용 메가 심볼(200x200)


def category_of(path: Path) -> str | None:
    """public/sprites 하위 경로에서 카테고리를 추론한다."""
    try:
        rel = path.resolve().relative_to(SPRITES)
    except ValueError:
        return None
    parts = rel.parts
    top = parts[0]
    if top.endswith("세대"):
        return "포켓몬"
    if top == "메가진화":
        return "메가진화"
    if top == "타입":
        return None
    if top == "도구":
        return "메가스톤" if len(parts) > 2 and parts[1] == "메가스톤" else "도구"
    return None


def resize_contain(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """비율을 유지해 목표 안에 맞추고, 투명 캔버스 중앙에 배치한다."""
    im = im.convert("RGBA")
    tw, th = size
    scale = min(tw / im.width, th / im.height)
    nw, nh = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.paste(im, ((tw - nw) // 2, (th - nh) // 2), im)
    return canvas


def check_one(path: Path, category: str):
    """(ok, 사유목록). ok=False 면 규격 이탈."""
    size, fmt, ext, mode = SPEC[category]
    reasons = []
    if path.suffix.lower() != ext:
        reasons.append(f"확장자 {path.suffix} → {ext}")
    try:
        with Image.open(path) as im:
            if im.size != size:
                reasons.append(f"크기 {im.width}x{im.height} → {size[0]}x{size[1]}")
            if (im.format or "").upper() != fmt:
                reasons.append(f"포맷 {im.format} → {fmt}")
            if im.mode != mode:
                reasons.append(f"모드 {im.mode} → {mode}")
    except Exception as e:  # noqa: BLE001
        return False, [f"열기 실패: {e}"]
    return (not reasons), reasons


def fix_one(path: Path, category: str) -> Path:
    """규격대로 다시 저장한다. 확장자가 바뀌면 옛 파일은 지운다. 최종 경로를 돌려준다."""
    size, fmt, ext, _mode = SPEC[category]
    with Image.open(path) as im:
        out = resize_contain(im, size)
    target = path.with_suffix(ext)
    if fmt == "WEBP":
        out.save(target, "WEBP", **WEBP_OPTS)
    else:
        out.save(target, "PNG", **PNG_OPTS)
    if target != path and path.exists():
        path.unlink()
    return target


def iter_targets(args) -> list[tuple[Path, str]]:
    out = []
    if args.paths:
        for p in args.paths:
            path = Path(p)
            cat = args.category or category_of(path)
            if cat is None:
                sys.exit(f"카테고리를 알 수 없음: {path}  (--category 로 지정)")
            if cat not in SPEC:
                sys.exit(f"알 수 없는 --category: {cat}  (선택지: {', '.join(SPEC)})")
            out.append((path, cat))
        return out
    for path in sorted(SPRITES.rglob("*")):
        if path.is_dir() or path.suffix.lower() == ".svg":
            continue
        cat = category_of(path)
        if cat is None:
            continue
        if path.stem in SKIP_STEMS.get(cat, set()):
            continue
        out.append((path, cat))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*", help="검사/변환할 파일(생략 시 public/sprites 전체)")
    ap.add_argument("--fix", action="store_true", help="규격 이탈분을 제자리에서 변환")
    ap.add_argument("--category", help="포켓몬 | 메가진화 | 도구 | 메가스톤 (트리 밖 파일용)")
    ap.add_argument("--warn-only", action="store_true", help="이탈이 있어도 exit 0")
    args = ap.parse_args()

    def show(p: Path) -> str:
        try:
            return str(p.resolve().relative_to(ROOT))
        except ValueError:
            return str(p)

    targets = iter_targets(args)
    deviated, fixed = [], []
    for path, cat in targets:
        ok, reasons = check_one(path, cat)
        if ok:
            continue
        deviated.append(path)
        print(f"  [{cat}] {show(path)}")
        for r in reasons:
            print(f"        {r}")
        if args.fix:
            new = fix_one(path, cat)
            fixed.append(new)
            print(f"        ✔ {show(new)}")

    print()
    print(f"검사 {len(targets)}개 · 이탈 {len(deviated)}개" + (f" · 변환 {len(fixed)}개" if args.fix else ""))
    if fixed:
        print("→ `npm run sprites` 로 매니페스트를 재생성하세요.")
    if deviated and not args.fix and not args.warn_only:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
