# summary_report.py
# Simple wrapper to print quick summary to console.
from pathlib import Path
p = Path('team_dashboard/summary.txt')
print(p.read_text() if p.exists() else 'No summary found. Run analyze.py first.')
