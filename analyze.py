# analyze.py
# Builds an HTML dashboard + PDF from exported data.
# Reads team_name from config.yaml for team-level metrics.

from pathlib import Path
import json, math, re
import yaml
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

IN = Path("cricclubs_export_out")
OUT = Path("team_dashboard")
ASSETS = OUT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

def load_config():
    cfg = Path("config.yaml")
    if cfg.exists():
        return yaml.safe_load(cfg.read_text())
    return {"team_name":"Team"}

def save_plot(fig, name: str) -> str:
    p = ASSETS / f"{name}.png"
    fig.savefig(p, bbox_inches="tight", dpi=160)
    plt.close(fig)
    return p.name

def bar_chart(series: pd.Series, title: str, xlabel: str, name: str) -> str:
    fig = plt.figure()
    series.head(5).plot(kind="bar")
    plt.title(title)
    plt.xlabel(xlabel)
    plt.ylabel("Value")
    return save_plot(fig, name)

def overs_to_float(overs) -> float:
    try:
        s = str(overs)
        if "." in s:
            o, b = s.split("."); return float(o) + float(b)/6.0
        return float(s)
    except Exception:
        return 0.0

def detect_winner(result: str) -> str:
    if not isinstance(result, str):
        return ""
    m = re.match(r"\s*([A-Za-z0-9 &'-]+)\s+won by", result)
    return m.group(1).strip() if m else ""

def extract_venue(meta: dict) -> str:
    for k in ("venue","ground"):
        v = meta.get(k)
        if isinstance(v,str) and v.strip():
            return v.strip()
    return ""

def compute_team_metrics(matches_json, batting_df, bowling_df, team):
    # Parse meta from matches.json -> title/result/venue
    rows = []
    for m in matches_json or []:
        meta = m.get("meta", {})
        title, result = meta.get("title",""), meta.get("result","")
        venue = extract_venue(meta)
        if team.lower() not in (title or "").lower():
            continue
        winner = detect_winner(result)
        if not winner:
            outcome = "unknown"
        elif team.lower() in winner.lower():
            outcome = "win"
        else:
            outcome = "loss"
        rows.append({"match_id": m.get("match_id"), "venue": venue, "outcome": outcome, "result": result})
    df = pd.DataFrame(rows)
    by_ground = pd.DataFrame()
    loss_details = pd.DataFrame()
    if not df.empty:
        by_ground = df.groupby("venue").agg(matches=("match_id","count"),
                                            wins=("outcome", lambda s: (s=='win').sum()),
                                            losses=("outcome", lambda s: (s=='loss').sum())
                                           )
        by_ground["win_rate_%"] = (by_ground["wins"]/by_ground["matches"]*100).round(1)

        lost_ids = df[df["outcome"]=="loss"]["match_id"].tolist()
        # simple themes
        def team_total(mid):
            sub = batting_df[(batting_df["match_id"]==mid) & (batting_df["team"].str.contains(team, case=False, na=False))]
            return pd.to_numeric(sub["runs"], errors="coerce").fillna(0).sum()
        def opp_bowler_peak(mid):
            sub = bowling_df[(bowling_df["match_id"]==mid) & (~bowling_df["team"].str.contains(team, case=False, na=False))].copy()
            sub["wk"] = pd.to_numeric(sub["wickets"], errors="coerce").fillna(0).astype(int)
            if sub.empty: return ("",0)
            row = sub.sort_values("wk", ascending=False).iloc[0]
            return (row["bowler"], int(row["wk"]))
        recs = []
        for mid in lost_ids:
            total = team_total(mid)
            ob, ow = opp_bowler_peak(mid)
            result_text = df.loc[df["match_id"]==mid,"result"].values[0]
            margin = ""
            m1 = re.search(r"won by\s+(\d+)\s+runs", str(result_text), re.I)
            m2 = re.search(r"won by\s+(\d+)\s+wickets", str(result_text), re.I)
            if m1: margin = f"{m1.group(1)} runs"
            elif m2: margin = f"{m2.group(1)} wickets"
            recs.append({"match_id": mid, "venue": df.loc[df["match_id"]==mid,"venue"].values[0], "low_total_flag": bool(total and total < 130), "opp_bowler": ob, "opp_bowler_wk": ow, "margin": margin})
        loss_details = pd.DataFrame(recs)
    return by_ground.reset_index() if not by_ground.empty else by_ground, loss_details

def main():
    cfg = load_config()
    team = cfg.get("team_name","Team")

    # Load structured CSVs if present; fall back to simple placeholders
    bat_csv, bowl_csv = IN / "batting.csv", IN / "bowling.csv"
    balls_csv, matches_json_path = IN / "balls.csv", IN / "matches.json"


    # --- Load & MERGE CSVs from any subfolder under cricclubs_export_out ---
    def read_many(pattern: str):
        files = sorted(IN.rglob(pattern))
        dfs = []
        for f in files:
            try:
                df = pd.read_csv(f)
                df["__source__"] = str(f.relative_to(IN))
                dfs.append(df)
            except Exception:
                pass
        return pd.concat(dfs, ignore_index=True) if dfs else pd.DataFrame()

    batting_df = read_many("batting.csv")
    bowling_df = read_many("bowling.csv")
    balls_df = read_many("balls.csv")

    matches_json = []
    # We'll take the first matches.json found (optional)
    for mj in IN.rglob("matches.json"):
        try:
            matches_json = json.loads(mj.read_text())
            break
        except Exception:
            continue

    sections = []

    # Batting top 5
    if batting_df is not None and not batting_df.empty:
        batting_df["runs_num"] = pd.to_numeric(batting_df["runs"], errors="coerce").fillna(0).astype(int)
        batting_df["balls_num"] = pd.to_numeric(batting_df["balls"], errors="coerce").fillna(0).astype(int)
        agg = batting_df.groupby("batsman").agg(runs=("runs_num","sum"), balls=("balls_num","sum")).sort_values("runs", ascending=False)
        agg["SR"] = (agg["runs"]/agg["balls"]*100).replace([math.inf,-math.inf],0).round(1)
        img1 = bar_chart(agg["runs"], "Top 5 Run Scorers", "Batsman", "top5_runs")
        img2 = bar_chart(agg[agg["balls"]>=20]["SR"].sort_values(ascending=False), "Top 5 Strike Rates (>=20 balls)", "Batsman", "top5_sr")
        sections.append(f"<h2>Batting — Top 5</h2><img src='assets/{img1}'><br><img src='assets/{img2}'>")

    # Bowling top 5
    if bowling_df is not None and not bowling_df.empty:
        bowling_df["wk"] = pd.to_numeric(bowling_df["wickets"], errors="coerce").fillna(0).astype(int)
        bowling_df["runs_num"] = pd.to_numeric(bowling_df["runs"], errors="coerce").fillna(0).astype(int)
        bowling_df["overs_num"] = bowling_df["overs"].apply(overs_to_float)
        agg_b = bowling_df.groupby("bowler").agg(wickets=("wk","sum"), runs=("runs_num","sum"), overs=("overs_num","sum"))
        agg_b["econ"] = (agg_b["runs"]/agg_b["overs"]).replace([math.inf,-math.inf],0).round(2)
        img3 = bar_chart(agg_b["wickets"].sort_values(ascending=False), "Top 5 Wicket Takers", "Bowler", "top5_wk")
        img4 = bar_chart(agg_b[agg_b["overs"]>=4]["econ"].sort_values(ascending=True), "Top 5 Best Economy (>=4 overs)", "Bowler", "top5_econ")
        sections.append(f"<h2>Bowling — Top 5</h2><img src='assets/{img3}'><br><img src='assets/{img4}'>")

    # Dot-ball leaders (optional)
    if balls_df is not None and not balls_df.empty:
        balls_df["runs_num"] = pd.to_numeric(balls_df["runs"], errors="coerce").fillna(0).astype(int)
        dots_bowler = balls_df[balls_df["runs_num"]==0].groupby("bowler").size().sort_values(ascending=False)
        dots_batsman = balls_df[balls_df["runs_num"]==0].groupby("batsman").size().sort_values(ascending=False)
        img5 = bar_chart(dots_bowler, "Top 5 Dot-Ball Bowlers", "Bowler", "top5_dots_bowler")
        img6 = bar_chart(dots_batsman, "Top 5 Dot-Balls Faced", "Batsman", "top5_dots_batsman")
        sections.append(f"<h2>Dot-Ball Leaders — Top 5</h2><img src='assets/{img5}'><br><img src='assets/{img6}'>")

    # Team metrics
    by_ground, loss_details = compute_team_metrics(matches_json, batting_df if batting_df is not None else pd.DataFrame(), bowling_df if bowling_df is not None else pd.DataFrame(), team)
    def table_html(df: pd.DataFrame) -> str:
        if df is None or df.empty: return "<p>No data</p>"
        head = "".join(f"<th>{c}</th>" for c in df.columns)
        rows = []
        for _, r in df.iterrows():
            rows.append("<tr>" + "".join(f"<td>{r[c]}</td>" for c in df.columns) + "</tr>")
        return f"<table class='data-table'><thead><tr>{head}</tr></thead><tbody>{''.join(rows)}</tbody></table>"

    sr_html = table_html(by_ground) if not by_ground.empty else "<p>No match metadata yet.</p>"
    loss_html = table_html(loss_details) if not loss_details.empty else "<p>Not enough data to analyze losses.</p>"

    # --- Player Stats Index (merged across tournaments) ---
    player_stats = {}

    # Batting aggregates
    if not batting_df.empty:
        batting_df["runs_num"] = pd.to_numeric(batting_df.get("runs"), errors="coerce").fillna(0).astype(int)
        batting_df["balls_num"] = pd.to_numeric(batting_df.get("balls"), errors="coerce").fillna(0).astype(int)
        for name, grp in batting_df.groupby("batsman"):
            ps = player_stats.setdefault(name, {"name": name, "runs": 0, "balls": 0, "sr": 0.0, "dots": 0, "dot_pct": None, "wickets": 0, "overs": 0.0, "econ": None, "best_batting": [], "best_bowling": []})
            ps["runs"] += int(grp["runs_num"].sum())
            ps["balls"] += int(grp["balls_num"].sum())

    # Bowling aggregates
    if not bowling_df.empty:
        bowling_df["wk"] = pd.to_numeric(bowling_df.get("wickets"), errors="coerce").fillna(0).astype(int)
        bowling_df["runs_conc"] = pd.to_numeric(bowling_df.get("runs"), errors="coerce").fillna(0).astype(int)
        def overs_to_float_local(x):
            try:
                s = str(x)
                if "." in s:
                    o,b = s.split("."); return float(o) + float(b)/6.0
                return float(s)
            except Exception:
                return 0.0
        bowling_df["overs_num"] = bowling_df.get("overs", 0).apply(overs_to_float_local)
        for name, grp in bowling_df.groupby("bowler"):
            ps = player_stats.setdefault(name, {"name": name, "runs": 0, "balls": 0, "sr": 0.0, "dots": 0, "dot_pct": None, "wickets": 0, "overs": 0.0, "econ": None, "best_batting": [], "best_bowling": []})
            ps["wickets"] += int(grp["wk"].sum())
            ps["overs"] += float(grp["overs_num"].sum())
            runs_c = int(grp["runs_conc"].sum())
            ps["econ"] = round(runs_c / ps["overs"], 2) if ps["overs"] > 0 else None

    # Dot balls + best innings (needs balls.csv)
    if not balls_df.empty:
        balls_df["runs_num"] = pd.to_numeric(balls_df.get("runs"), errors="coerce").fillna(0).astype(int)
        # dot balls by batsman
        for name, grp in balls_df.groupby("batsman"):
            dots = int((grp["runs_num"]==0).sum())
            ps = player_stats.setdefault(name, {"name": name, "runs": 0, "balls": 0, "sr": 0.0, "dots": 0, "dot_pct": None, "wickets": 0, "overs": 0.0, "econ": None, "best_batting": [], "best_bowling": []})
            ps["dots"] += dots
        # compute balls faced if we have it (approx by counting deliveries for that batsman)
        balls_faced = balls_df.groupby("batsman").size().to_dict()
        for name, ps in player_stats.items():
            bf = balls_faced.get(name, 0)
            if bf > 0:
                ps["dot_pct"] = round(ps["dots"]/bf*100, 1)
        # best batting innings: pick top N by runs from batting_df
    if not batting_df.empty:
        top_by_player = batting_df.copy()
        top_by_player["runs_num"] = pd.to_numeric(top_by_player["runs"], errors="coerce").fillna(0).astype(int)
        # Construct an innings label with match_id and (if available) team
        def mk_label(row):
            return f"M{row.get('match_id','')}: {row.get('team','') or ''} {row['runs_num']}({row.get('balls','?')})"
        top_by_player["label"] = top_by_player.apply(mk_label, axis=1)
        for name, grp in top_by_player.groupby("batsman"):
            best = grp.sort_values("runs_num", ascending=False).head(3)["label"].tolist()
            player_stats.setdefault(name, {"name": name, "runs": 0, "balls": 0, "sr": 0.0, "dots": 0, "dot_pct": None, "wickets": 0, "overs": 0.0, "econ": None, "best_batting": [], "best_bowling": []})["best_batting"] = best

    if not bowling_df.empty:
        top_by_bowler = bowling_df.copy()
        top_by_bowler["wk"] = pd.to_numeric(top_by_bowler["wickets"], errors="coerce").fillna(0).astype(int)
        def mk_bowl_label(row):
            return f"M{row.get('match_id','')}: {row.get('team','') or ''} {row['wk']} wkts @ {row.get('overs','?')} overs"
        top_by_bowler["label"] = top_by_bowler.apply(mk_bowl_label, axis=1)
        for name, grp in top_by_bowler.groupby("bowler"):
            best = grp.sort_values("wk", ascending=False).head(3)["label"].tolist()
            player_stats.setdefault(name, {"name": name, "runs": 0, "balls": 0, "sr": 0.0, "dots": 0, "dot_pct": None, "wickets": 0, "overs": 0.0, "econ": None, "best_batting": [], "best_bowling": []})["best_bowling"] = best

    # Finish SR
    for ps in player_stats.values():
        ps["sr"] = round((ps["runs"]/ps["balls"]*100), 1) if ps["balls"] else None

    # Optional: load player photo map
    photo_map = {}
    pmap_path = Path("players.csv")
    if pmap_path.exists():
        try:
            dfmap = pd.read_csv(pmap_path)
            for _, r in dfmap.iterrows():
                n = str(r.get("name","")).strip()
                u = str(r.get("photo_url","")).strip()
                if n and u:
                    photo_map[n] = u
        except Exception:
            pass

    # Write JSON for the HTML to consume
    (ASSETS / "player_stats.json").write_text(json.dumps(player_stats, indent=2), encoding="utf-8")
    (ASSETS / "player_photos.json").write_text(json.dumps(photo_map, indent=2), encoding="utf-8")

    # HTML
    html = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>{team} — Team Dashboard</title>
<style>
body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin:24px }}
h1,h2 {{ margin: 12px 0 6px }}
img {{ max-width: 980px; width:100%; height:auto; display:block; margin: 8px 0 16px }}
.data-table {{ border-collapse: collapse; width:100%; }}
.data-table th,.data-table td {{ border:1px solid #ddd; padding:6px 8px }}
.data-table th {{ background: #f3f6fb }}
.small {{ color:#666; font-size: 12px }}
</style>
</head>
<body>
<h1>{team} — Shareable Team Dashboard</h1>
<p class="small">Generated from CricClubs exports in <code>cricclubs_export_out/</code>.</p>


<h2>Player Insights</h2>
<div id="player-insights">
  <label for="playerSelect">Choose player:</label>
  <select id="playerSelect"></select>
  <div id="playerCard" style="display:flex; gap:16px; align-items:center; margin:12px 0;">
    <img id="playerPhoto" alt="player" style="width:96px; height:96px; object-fit:cover; border-radius:50%; border:1px solid #ddd;">
    <div>
      <div><b id="pi_name">—</b></div>
      <div>Runs: <b id="pi_runs">-</b> | SR: <b id="pi_sr">-</b> | Dot%: <b id="pi_dot">-</b></div>
      <div>Wickets: <b id="pi_wk">-</b> | Overs: <b id="pi_overs">-</b> | Econ: <b id="pi_econ">-</b></div>
      <div>Key Batting: <span id="pi_best_bat">-</span></div>
      <div>Key Bowling: <span id="pi_best_bowl">-</span></div>
    </div>
  </div>
</div>
<script>
async function loadPlayerData(){{
  const statsResp = await fetch('assets/player_stats.json');
  const stats = await statsResp.json();
  const photosResp = await fetch('assets/player_photos.json');
  const photos = await photosResp.json().catch(()=>({{}}));

  const players = Object.keys(stats).sort();
  const sel = document.getElementById('playerSelect');
  sel.innerHTML = players.map(p => `<option value="${{p}}">${{p}}</option>`).join('');
  function fmt(v){{ return (v===null || v===undefined) ? '-' : v; }}
  function render(name){{
    const ps = stats[name];
    document.getElementById('pi_name').innerText = name;
    document.getElementById('pi_runs').innerText = fmt(ps.runs);
    document.getElementById('pi_sr').innerText = fmt(ps.sr);
    document.getElementById('pi_dot').innerText = fmt(ps.dot_pct);
    document.getElementById('pi_wk').innerText = fmt(ps.wickets);
    document.getElementById('pi_overs').innerText = fmt(ps.overs?.toFixed ? ps.overs.toFixed(1) : fmt(ps.overs));
    document.getElementById('pi_econ').innerText = fmt(ps.econ);
    document.getElementById('pi_best_bat').innerText = (ps.best_batting||[]).join(' · ') || '-';
    document.getElementById('pi_best_bowl').innerText = (ps.best_bowling||[]).join(' · ') || '-';
    const url = photos[name] || 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';
    document.getElementById('playerPhoto').src = url;
  }}
  sel.addEventListener('change', (e)=> render(e.target.value));
  if(players.length){{
    sel.value = players[0];
    render(players[0]);
  }}
}}
loadPlayerData();
</script>


{''.join(sections)}

<h2>{team} — Win Rate by Ground</h2>
{sr_html}

<h2>{team} — Themes in Losses</h2>
{loss_html}

</body>
</html>"""
    (OUT / "index.html").write_text(html, encoding="utf-8")

    # Summary text
    lines = []
    if batting_df is not None and not batting_df.empty:
        top_runs = (batting_df.groupby("batsman")["runs"].apply(pd.to_numeric, errors="coerce").sum().sort_values(ascending=False).head(5))
        lines.append("Top-5 Batsmen (Runs): " + ", ".join(f"{i}({int(v)})" for i,v in top_runs.items()))
    if bowling_df is not None and not bowling_df.empty:
        top_wk = (bowling_df.groupby("bowler")["wickets"].apply(pd.to_numeric, errors="coerce").sum().sort_values(ascending=False).head(5))
        lines.append("Top-5 Bowlers (Wickets): " + ", ".join(f"{i}({int(v)})" for i,v in top_wk.items()))
    (OUT / "summary.txt").write_text("\n".join(lines) if lines else "No data yet. Run the exporter first.", encoding="utf-8")

    # PDF
    pdf = OUT / "Team_Stats_Summary.pdf"
    with PdfPages(pdf) as p:
        for img in ["top5_runs","top5_sr","top5_wk","top5_econ","top5_dots_bowler","top5_dots_batsman"]:
            f = ASSETS / f"{img}.png"
            if f.exists():
                fig = plt.figure(figsize=(8.5,5))
                import matplotlib.image as mpimg
                plt.imshow(mpimg.imread(str(f))); plt.axis('off')
                p.savefig(fig); plt.close(fig)

    print("Dashboard & PDF generated in team_dashboard/")

if __name__ == "__main__":
    main()
