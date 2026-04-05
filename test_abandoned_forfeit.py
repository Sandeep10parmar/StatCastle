#!/usr/bin/env python3
"""Unit tests for abandoned / no-result / forfeit parsing in analyze.parse_match_result."""

import unittest

import numpy as np
import pandas as pd

import analyze


class ParseSpecialResultsTests(unittest.TestCase):
    def test_abandoned_is_draw_with_detail(self):
        html = "<html><body>Match abandoned due to rain. No play.</body></html>"
        r = analyze.parse_match_result(html, "Royals", None, None)
        self.assertEqual(r["match_result"], "Draw")
        self.assertEqual(r["result_detail"], "Abandoned")

    def test_no_result_is_draw(self):
        html = "<html><body>No result — weather</body></html>"
        r = analyze.parse_match_result(html, "Royals", None, None)
        self.assertEqual(r["match_result"], "Draw")
        self.assertEqual(r["result_detail"], "No result")

    def test_forfeit_winner_royals_is_win(self):
        html = "<html><body>Forfeited. Winner: Royals</body></html>"
        r = analyze.parse_match_result(html, "Royals", None, None)
        self.assertEqual(r["match_result"], "Win")
        self.assertEqual(r["result_detail"], "Forfeit")

    def test_forfeit_winner_other_is_loss(self):
        html = "<html><body>Forfeited. Winner: Sultan</body></html>"
        r = analyze.parse_match_result(html, "Royals", None, None)
        self.assertEqual(r["match_result"], "Loss")
        self.assertEqual(r["result_detail"], "Forfeit")
        self.assertEqual(r["opponent_team"], "Sultan")

    def test_won_by_forfeit(self):
        html = "<html><body>Royals won by forfeit</body></html>"
        r = analyze.parse_match_result(html, "Royals", None, None)
        self.assertEqual(r["match_result"], "Win")
        self.assertEqual(r["result_detail"], "Forfeit")

    def test_forfeit_wins_over_abandoned_keyword_in_page(self):
        html = "<html><body>Forfeited. Winner: Royals. Note: not abandoned.</body></html>"
        r = analyze.parse_match_result(html, "Royals", None, None)
        self.assertEqual(r["match_result"], "Win")
        self.assertEqual(r["result_detail"], "Forfeit")


class MergeSeriesListTests(unittest.TestCase):
    def test_includes_series_only_on_match_results(self):
        """Abandoned/forfeit rows can have series but no batting rows — still in series list."""
        dfb = pd.DataFrame()
        match_results = [{"series": "HPT20L_SERIES_22"}]
        out = analyze.merge_series_list_for_dashboard(dfb, match_results)
        self.assertIn("HPTL(S22)", out)


class NonPlayedExcludedFromRecordStatsTests(unittest.TestCase):
    def test_team_analytics_ignores_forfeit_and_abandoned(self):
        match_results = [
            {
                "result": "Win",
                "ground": "G1",
                "toss_decision": "batted",
                "match_type": "League",
                "result_detail": None,
            },
            {
                "result": "Win",
                "ground": "G1",
                "toss_decision": "batted",
                "match_type": "League",
                "result_detail": "Forfeit",
            },
            {
                "result": "Draw",
                "ground": "G2",
                "toss_decision": "bowled",
                "match_type": "League",
                "result_detail": "Abandoned",
            },
        ]
        ta = analyze.build_team_analytics(
            pd.DataFrame(), pd.DataFrame(), match_results, "Royals"
        )
        self.assertEqual(ta["overall_win_pct"], 100.0)
        self.assertIn("G1", ta["win_rate_by_ground"])
        self.assertNotIn("G2", ta["win_rate_by_ground"])
        self.assertEqual(ta["win_rate_by_ground"]["G1"]["wins"], 1)
        self.assertEqual(ta["win_rate_by_toss"]["batted"]["wins"], 1)

    def test_exclude_non_played_match_rows_drops_forfeit_innings(self):
        dfb = pd.DataFrame(
            [
                {"Name": "A", "Runs": 10, "Match_Id": 1, "result_detail": None},
                {"Name": "A", "Runs": 99, "Match_Id": 2, "result_detail": "Forfeit"},
            ]
        )
        out = analyze.exclude_non_played_match_rows(dfb)
        self.assertEqual(len(out), 1)
        self.assertEqual(int(out.iloc[0]["Runs"]), 10)


class PlausibleBattingTests(unittest.TestCase):
    def test_duck_zero_sr_accepted(self):
        """0 runs off 1+ balls shows SR 0.00 on scorecards; must not reject the row."""
        self.assertTrue(analyze.plausible_batting(0, 2, 0.0, 0, 0))

    def test_run_out_without_facing_zero_zero(self):
        """0(0) with SR 0 or missing (run out without facing a ball)."""
        self.assertTrue(analyze.plausible_batting(0, 0, 0.0, 0, 0))
        self.assertTrue(analyze.plausible_batting(0, 0, np.nan, 0, 0))

    def test_six_off_one_not_out_sr_600(self):
        self.assertTrue(analyze.plausible_batting(6, 1, 600.0, 1, 1))

    def test_normal_innings_still_requires_min_sr_when_runs_positive(self):
        self.assertFalse(analyze.plausible_batting(1, 20, 5.0, 0, 0))

    def test_parse_batting_row_run_out_zero_zero(self):
        cells = ["Pat run out (short)", "0", "0", "0", "0", "0.00"]
        br = analyze.parse_batting_row(cells, 999, None, {"match_date": "2026-01-01"}, 11)
        self.assertIsNotNone(br)
        self.assertEqual(br["Name"], "Pat")
        self.assertEqual(br["Runs"], 0.0)
        self.assertEqual(br["Balls"], 0.0)


if __name__ == "__main__":
    unittest.main()
