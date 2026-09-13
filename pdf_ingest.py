"""Parse a CricClubs "Score Card PDF" export into the same row shapes that
analyze.py's HTML-based parse_batting_row / parse_bowling_row produce, so a
manually-downloaded PDF can feed the existing analytics pipeline unchanged.

This exists because CricClubs' Cloudflare protection now blocks the
automated scraper entirely (see cricclubs_export.py), but the site's own
per-match "PDF" export (Info tab, top-right icons) still works and contains
everything analyze.py needs except per-bowler dot-ball counts, which come
from a separate scorecard screenshot (see merge_dot_balls below).
"""
from __future__ import annotations

import re
from pathlib import Path

from pypdf import PdfReader

LABELS_IN_ORDER = ["Match:", "Toss:", "Played At:", "Total:", "Date:", "Result:"]

# CricClubs PDF dismissal abbreviations -> analyze.py's simplify_how_out() categories
DISMISSAL_PREFIX_MAP = [
    ("ctw", "catch"),
    ("ct", "catch"),
    ("ro", "run out"),
    ("lbw", "lbw"),
    ("stw", "stumped"),
    ("st", "stumped"),
    ("b", "bowled"),
]
# match a dismissal-prefix token as a standalone word, longest-first so "ctw" wins over "ct"
_DISMISSAL_TOKEN_RE = re.compile(
    r"\b(" + "|".join(p for p, _ in DISMISSAL_PREFIX_MAP) + r")\b", re.IGNORECASE
)

# Team-name chars only (no "," or "(" ), so this can't false-positive-match a
# wrapped "Fall Of Wickets" line like "...9.3), 91 - 6" which ends the same way.
INNINGS_HEADER_RE = re.compile(r"^([^,()]+?) - (\d+)\s*$")
BATTING_TABLE_HEADER = "S.No Batsman How Out Runs Balls Mins 4s 6s SR"
BOWLING_TABLE_HEADER_RE = re.compile(r"^S\.No Bowler Overs Mdns Runs Wkts Wides No Balls Ave\s*$")
EXTRAS_RE = re.compile(r"^Extras:\((.*?)\)\s*(\d+)\s*$")
TOTAL_RE = re.compile(r"^Total:\s*(\d+)\s*$")


def norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def title_clean(s: str) -> str:
    return norm(s).replace("*", "").strip().title()


def simplify_pdf_dismissal(text: str) -> str:
    t = text.strip().lower()
    for prefix, category in DISMISSAL_PREFIX_MAP:
        if t.startswith(prefix):
            return category
    return norm(text)


def extract_pdf_text(pdf_path: str | Path) -> str:
    reader = PdfReader(str(pdf_path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def parse_header_fields(text: str) -> dict:
    positions = [(label, text.find(label)) for label in LABELS_IN_ORDER]
    end_idx = text.find("Best Performances")
    if end_idx == -1:
        end_idx = len(text)
    fields = {}
    for i, (label, idx) in enumerate(positions):
        if idx == -1:
            fields[label] = None
            continue
        start = idx + len(label)
        end = end_idx
        for _, next_idx in positions[i + 1:]:
            if next_idx != -1:
                end = next_idx
                break
        fields[label] = norm(text[start:end])
    return fields


def parse_match_header(text: str) -> dict:
    fields = parse_header_fields(text)

    match_line = fields.get("Match:") or ""
    m = re.match(r"(.+?)\s+vs\s+(.+)", match_line, re.IGNORECASE)
    team_one, team_two = (m.group(1).strip(), m.group(2).strip()) if m else (None, None)

    date_line = fields.get("Date:") or ""
    dm = re.match(r"(\d{1,2}/\d{1,2}/\d{4})", date_line)
    match_date_raw = dm.group(1) if dm else None

    # Series/league name sits just above "Match Details" on page 1, e.g.:
    #   Houston United Premier League
    #   Season 12 - Professional Division (S12D3)
    series = None
    md_idx = text.find("Match Details")
    if md_idx != -1:
        header_block = text[:md_idx]
        lines = [norm(l) for l in header_block.splitlines() if norm(l)]
        if lines:
            series = lines[-1]  # e.g. "Season 12 - Professional Division (S12D3)"

    return {
        "team_one": team_one,
        "team_two": team_two,
        "toss": fields.get("Toss:"),
        "ground": fields.get("Played At:"),
        "totals_raw": fields.get("Total:"),
        "match_date_raw": match_date_raw,
        "result": fields.get("Result:"),
        "series": series,
    }


def _split_innings_blocks(text: str) -> list[tuple[str, str]]:
    """Return [(team_name, block_text), ...] for each innings section."""
    lines = text.splitlines()
    blocks = []
    current_team = None
    current_lines: list[str] = []
    for line in lines:
        m = INNINGS_HEADER_RE.match(line.strip())
        if m and norm(line) != BATTING_TABLE_HEADER:
            if current_team is not None:
                blocks.append((current_team, "\n".join(current_lines)))
            current_team = m.group(1).strip()
            current_lines = []
        elif current_team is not None:
            current_lines.append(line)
    if current_team is not None:
        blocks.append((current_team, "\n".join(current_lines)))
    return blocks


def _parse_batting_line(line: str, position: int) -> dict | None:
    m = re.match(r"^\s*(\d+)\s+(.*)$", line)
    if not m:
        return None
    rest = m.group(2)
    tokens = rest.split()
    if len(tokens) < 6:
        return None
    # last 5 tokens are Runs, Balls, 4s, 6s, SR (the "Mins" column is always
    # blank in this export and never appears in the extracted text)
    tail = tokens[-5:]
    if not all(re.fullmatch(r"\d+(\.\d+)?", t) for t in tail):
        return None
    name_and_dismissal = " ".join(tokens[:-5])
    if not name_and_dismissal.strip():
        return None

    dm = _DISMISSAL_TOKEN_RE.search(name_and_dismissal)
    if dm:
        raw_name = name_and_dismissal[: dm.start()]
        dismissal_text = name_and_dismissal[dm.start():]
        dismissal_type = simplify_pdf_dismissal(dismissal_text)
    else:
        raw_name = name_and_dismissal
        dismissal_type = "not out"

    name = title_clean(raw_name)
    if not name:
        return None

    runs, balls, fours, sixes, sr = (float(x) for x in tail)
    return {
        "Name": name,
        "Runs": runs,
        "Balls": balls,
        "4s": fours,
        "6s": sixes,
        "SR": sr,
        "Dismissal Type": dismissal_type,
        "Batting_Position": position,
    }


def _parse_bowling_line(line: str) -> dict | None:
    m = re.match(r"^\s*(\d+)\s+(.*)$", line)
    if not m:
        return None
    rest = m.group(2)
    tokens = rest.split()
    # name tokens + Overs Mdns Runs Wkts Wides NoBalls Ave (7 trailing numeric cols)
    if len(tokens) < 8:
        return None
    numeric_tail = tokens[-7:]
    if not all(re.fullmatch(r"\d+(\.\d+)?", t) for t in numeric_tail):
        return None
    tail = numeric_tail[:-1]  # drop Ave/econ column, recomputed below instead
    name = title_clean(" ".join(tokens[:-7]))
    if not name:
        return None
    overs, maidens, runs, wkts, wides, noballs = (float(x) for x in tail)
    econ = round(runs / overs, 2) if overs else None
    return {
        "bowler": name,
        "o": overs,
        "m": maidens,
        "dot": None,  # not present in this export; see merge_dot_balls()
        "r": runs,
        "w": wkts,
        "econ": econ,
        "Wd": wides,
        "Nb": noballs,
    }


def parse_innings(text: str) -> list[dict]:
    """Return one dict per innings: {team, batting: [...], bowling: [...], extras, total}."""
    innings = []
    for team, block in _split_innings_blocks(text):
        lines = block.splitlines()
        batting, bowling = [], []
        extras = {"total": None, "breakdown": None}
        section = "batting"
        position = 0
        for line in lines:
            stripped = norm(line)
            if not stripped:
                continue
            if stripped == BATTING_TABLE_HEADER:
                section = "batting"
                continue
            if BOWLING_TABLE_HEADER_RE.match(stripped):
                section = "bowling"
                continue
            em = EXTRAS_RE.match(stripped)
            if em:
                extras["breakdown"] = em.group(1)
                extras["total"] = int(em.group(2))
                continue
            tm = TOTAL_RE.match(stripped)
            if tm:
                continue
            if stripped.startswith("Fall Of Wickets"):
                break
            if section == "batting":
                position += 1
                row = _parse_batting_line(line, position)
                if row:
                    batting.append(row)
                else:
                    position -= 1
            elif section == "bowling":
                row = _parse_bowling_line(line)
                if row:
                    bowling.append(row)
        innings.append({"team": team, "batting": batting, "bowling": bowling, "extras": extras})
    return innings


def parse_scorecard_pdf(pdf_path: str | Path) -> dict:
    text = extract_pdf_text(pdf_path)
    header = parse_match_header(text)
    innings = parse_innings(text)
    return {"header": header, "innings": innings}


def canonical_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _parse_date(date_str: str | None) -> str | None:
    if not date_str:
        return None
    from datetime import datetime

    try:
        return datetime.strptime(date_str, "%m/%d/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def derive_match_meta(header: dict, team_name: str) -> dict:
    """Build the same metadata keys analyze.py's parse_match_metadata /
    parse_match_result produce, from this PDF's cleanly-labeled header fields.
    """
    team_key = canonical_name(team_name)
    team_one, team_two = header.get("team_one"), header.get("team_two")
    our_side_found = any(t and canonical_name(t) == team_key for t in (team_one, team_two))
    opponent_team = None
    if our_side_found:
        opponent_team = team_two if canonical_name(team_one) == team_key else team_one

    meta = {
        "series": header.get("series"),
        "ground": header.get("ground"),
        "toss_winner": None,
        "toss_decision": None,
        "player_of_match": None,
        "match_date": _parse_date(header.get("match_date_raw")),
        "match_type": None,
        "is_playoff": False,
        "opponent_team": opponent_team if our_side_found else None,
        "match_result": None,
        "result_margin": None,
        "result_detail": None,
    }

    toss_text = header.get("toss") or ""
    tm = re.match(r"(.+?)\s+won the toss", toss_text, re.IGNORECASE)
    if tm:
        toss_winner_name = norm(tm.group(1))
        meta["toss_winner"] = toss_winner_name
        if re.search(r"elected to bat\b|\bbatted\b", toss_text, re.IGNORECASE):
            decision = "batted"
        elif re.search(r"elected to (?:bowl|field)\b|\bbowled\b", toss_text, re.IGNORECASE):
            decision = "bowled"
        else:
            decision = None
        if decision and our_side_found:
            winner_key = canonical_name(toss_winner_name)
            meta["toss_decision"] = decision if winner_key == team_key else (
                "bowled" if decision == "batted" else "batted"
            )
        elif decision:
            meta["toss_decision"] = decision

    result_text = header.get("result") or ""
    if our_side_found:
        if re.search(r"\bforfeit", result_text, re.IGNORECASE):
            meta["result_detail"] = "Forfeit"
            meta["result_margin"] = "Forfeit"
            wm = re.search(r"winner\s*:\s*(.+)", result_text, re.IGNORECASE)
            winner_name = norm(wm.group(1)) if wm else result_text
            meta["match_result"] = "Win" if team_key in canonical_name(winner_name) else "Loss"
        elif re.search(r"\babandoned\b", result_text, re.IGNORECASE):
            meta["match_result"] = "Draw"
            meta["result_margin"] = "Abandoned"
            meta["result_detail"] = "Abandoned"
        elif re.search(r"\bno result\b|\bN\s*/\s*R\b", result_text, re.IGNORECASE):
            meta["match_result"] = "Draw"
            meta["result_margin"] = "No result"
            meta["result_detail"] = "No result"
        elif re.search(r"\b(tied|drawn|draw)\b", result_text, re.IGNORECASE):
            meta["match_result"] = "Draw"
        else:
            rm = re.match(r"(.+?)\s+won by\s+(.+)", result_text, re.IGNORECASE)
            if rm:
                winner_name, margin = norm(rm.group(1)), norm(rm.group(2))
                meta["result_margin"] = margin
                meta["match_result"] = "Win" if canonical_name(winner_name) == team_key else "Loss"

    return meta


def merge_dot_balls(parsed: dict, dot_counts: dict[str, int]) -> dict:
    """Fill in bowling rows' "dot" field from a manually-read screenshot.

    dot_counts: {bowler_name: dot_ball_count}, names matched case-insensitively
    against the bowler names already parsed from the PDF.
    """
    lookup = {k.lower(): v for k, v in dot_counts.items()}
    for inn in parsed["innings"]:
        for row in inn["bowling"]:
            dots = lookup.get(row["bowler"].lower())
            if dots is not None:
                row["dot"] = float(dots)
    return parsed


def build_manual_match_entry(
    pdf_path: str | Path,
    team_name: str,
    match_id: int | str,
    dot_counts: dict[str, int] | None = None,
) -> dict:
    """Build a matches.json entry (source: "pdf_manual") for analyze.py to
    consume directly — see the branch in analyze.py's main() that checks for
    match["source"] == "pdf_manual".
    """
    parsed = parse_scorecard_pdf(pdf_path)
    if dot_counts:
        parsed = merge_dot_balls(parsed, dot_counts)
    meta = derive_match_meta(parsed["header"], team_name)

    team_key = canonical_name(team_name)
    our_innings = next(
        (inn for inn in parsed["innings"] if canonical_name(inn["team"]) == team_key), None
    )
    their_innings = next(
        (inn for inn in parsed["innings"] if canonical_name(inn["team"]) != team_key), None
    )
    if our_innings is None:
        raise ValueError(
            f"Could not find {team_name!r}'s innings in this PDF "
            f"(saw: {[inn['team'] for inn in parsed['innings']]})"
        )

    # A scorecard's "bowling" table under TEAM's innings lists the OPPOSING
    # team's bowlers (who bowled at TEAM) - so our own bowling figures live
    # under the opponent's innings block, not ours.
    our_bowling = their_innings["bowling"] if their_innings else []

    return {
        "match_id": match_id,
        "source": "pdf_manual",
        "manual_meta": meta,
        "manual_batting": our_innings["batting"],
        "manual_bowling": our_bowling,
    }


if __name__ == "__main__":
    import sys
    import json

    result = parse_scorecard_pdf(sys.argv[1])
    print(json.dumps(result, indent=2))
