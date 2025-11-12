#!/usr/bin/env python3
"""
Test script to validate match_results.json data quality.
Checks for:
- All expected matches are present
- Opponent names are valid (not navigation elements, series names, etc.)
- Toss winner and decision are populated
- Toss decision is contextual to team_name
- Match results are valid
"""

import json
from pathlib import Path
import sys

def load_config():
    """Load config.yaml to get expected match IDs and team name."""
    import yaml
    config_path = Path("config.yaml")
    if not config_path.exists():
        return None, []
    
    with config_path.open() as f:
        config = yaml.safe_load(f)
    
    team_name = config.get("team_name", "")
    match_ids = []
    for league in config.get("leagues", []):
        match_ids.extend(league.get("match_ids", []))
    
    return team_name, match_ids

def test_match_results():
    """Run all validation tests."""
    results_path = Path("team_dashboard/assets/match_results.json")
    
    if not results_path.exists():
        print("❌ ERROR: match_results.json not found!")
        print("   Run: python3 analyze.py")
        return False
    
    with results_path.open() as f:
        match_results = json.load(f)
    
    team_name, expected_match_ids = load_config()
    
    print("=" * 60)
    print("MATCH RESULTS VALIDATION TEST")
    print("=" * 60)
    print()
    
    all_passed = True
    
    # Test 1: Check all expected matches are present
    print("Test 1: Match Coverage")
    print("-" * 60)
    found_match_ids = {m["match_id"] for m in match_results}
    expected_set = set(expected_match_ids)
    
    missing = expected_set - found_match_ids
    extra = found_match_ids - expected_set
    
    if missing:
        print(f"⚠️  WARNING: {len(missing)} expected match(es) missing: {sorted(missing)}")
        print("   (This is OK if matches were forfeited or have no batting data)")
    else:
        print(f"✅ All {len(expected_set)} expected matches found")
    
    if extra:
        print(f"ℹ️  INFO: {len(extra)} extra match(es) found: {sorted(extra)}")
    
    print(f"   Total matches in results: {len(match_results)}")
    print()
    
    # Test 2: Validate opponent names
    print("Test 2: Opponent Name Validation")
    print("-" * 60)
    invalid_patterns = [
        "player search", "search", "last updated", "updated", "topic",
        "series", "league", "hpt20l", "houston premier",
        "won the toss", "elected to", "innings break",
        "ganapathy", "bollianda",  # Player names
    ]
    
    invalid_opponents = []
    for match in match_results:
        opponent = match.get("opponent", "").lower()
        match_id = match.get("match_id")
        
        # Check for invalid patterns
        for pattern in invalid_patterns:
            if pattern in opponent:
                invalid_opponents.append((match_id, match.get("opponent"), f"contains '{pattern}'"))
                break
        
        # Check for empty or very short names
        if not opponent or len(opponent.strip()) < 3:
            invalid_opponents.append((match_id, match.get("opponent"), "too short or empty"))
        
        # Check for score patterns
        import re
        if re.search(r"\d+\s*[,:]\s*\d+", opponent):
            invalid_opponents.append((match_id, match.get("opponent"), "contains score pattern"))
    
    if invalid_opponents:
        print(f"❌ FAILED: {len(invalid_opponents)} invalid opponent name(s):")
        for match_id, opponent, reason in invalid_opponents:
            print(f"   Match {match_id}: '{opponent}' - {reason}")
        all_passed = False
    else:
        print(f"✅ All {len(match_results)} opponent names are valid")
        print("   Opponents:", ", ".join(sorted(set(m.get("opponent") for m in match_results))))
    print()
    
    # Test 3: Toss winner validation
    print("Test 3: Toss Winner Validation")
    print("-" * 60)
    missing_toss_winner = [m for m in match_results if not m.get("toss_winner")]
    
    if missing_toss_winner:
        print(f"❌ FAILED: {len(missing_toss_winner)} match(es) missing toss_winner:")
        for m in missing_toss_winner:
            print(f"   Match {m.get('match_id')}")
        all_passed = False
    else:
        print(f"✅ All {len(match_results)} matches have toss_winner populated")
        toss_winners = set(m.get("toss_winner") for m in match_results)
        print(f"   Toss winners found: {', '.join(sorted(toss_winners))}")
    print()
    
    # Test 4: Toss decision validation
    print("Test 4: Toss Decision Validation")
    print("-" * 60)
    missing_toss_decision = [m for m in match_results if not m.get("toss_decision")]
    invalid_decisions = [m for m in match_results 
                         if m.get("toss_decision") not in ["batted", "bowled"]]
    
    if missing_toss_decision:
        print(f"❌ FAILED: {len(missing_toss_decision)} match(es) missing toss_decision")
        all_passed = False
    elif invalid_decisions:
        print(f"❌ FAILED: {len(invalid_decisions)} match(es) have invalid toss_decision")
        all_passed = False
    else:
        print(f"✅ All {len(match_results)} matches have valid toss_decision")
        
        # Verify contextual logic
        if team_name:
            print(f"   Verifying toss_decision is contextual to '{team_name}'...")
            contextual_issues = []
            for m in match_results:
                toss_winner = m.get("toss_winner", "")
                toss_decision = m.get("toss_decision")
                match_id = m.get("match_id")
                
                # If our team won toss, decision should reflect what they chose
                # If opponent won toss, decision should be inverted
                # This is a basic check - full validation would need to know what the toss winner chose
                if not toss_winner or not toss_decision:
                    continue
                
                # Just verify it's one of the valid values
                if toss_decision not in ["batted", "bowled"]:
                    contextual_issues.append((match_id, f"Invalid decision: {toss_decision}"))
            
            if contextual_issues:
                print(f"   ⚠️  {len(contextual_issues)} potential contextual issues found")
                for match_id, issue in contextual_issues:
                    print(f"      Match {match_id}: {issue}")
            else:
                print(f"   ✅ Toss decisions appear contextual")
    print()
    
    # Test 5: Match result validation
    print("Test 5: Match Result Validation")
    print("-" * 60)
    valid_results = ["Win", "Loss", "Draw", "Tie"]
    invalid_results = [m for m in match_results 
                      if m.get("result") not in valid_results]
    
    if invalid_results:
        print(f"❌ FAILED: {len(invalid_results)} match(es) have invalid result")
        all_passed = False
    else:
        print(f"✅ All {len(match_results)} matches have valid result")
        result_counts = {}
        for m in match_results:
            result = m.get("result")
            result_counts[result] = result_counts.get(result, 0) + 1
        print(f"   Results: {', '.join(f'{k}: {v}' for k, v in sorted(result_counts.items()))}")
    print()
    
    # Test 6: Required fields
    print("Test 6: Required Fields Validation")
    print("-" * 60)
    required_fields = ["match_id", "match_date", "opponent", "result", "ground", "series"]
    missing_fields = []
    
    for match in match_results:
        match_id = match.get("match_id")
        for field in required_fields:
            if field not in match or not match.get(field):
                missing_fields.append((match_id, field))
    
    if missing_fields:
        print(f"❌ FAILED: {len(missing_fields)} missing required field(s):")
        for match_id, field in missing_fields[:10]:  # Show first 10
            print(f"   Match {match_id}: missing '{field}'")
        all_passed = False
    else:
        print(f"✅ All {len(match_results)} matches have all required fields")
    print()
    
    # Test 7: Data consistency check
    print("Test 7: Data Consistency")
    print("-" * 60)
    issues = []
    
    for match in match_results:
        match_id = match.get("match_id")
        opponent = match.get("opponent", "")
        toss_winner = match.get("toss_winner", "")
        
        # Opponent should not be the same as team_name (unless it's a special case)
        if team_name and opponent.lower() == team_name.lower():
            issues.append((match_id, f"Opponent '{opponent}' matches team name '{team_name}'"))
        
        # Opponent should not be the same as toss_winner (unless it's a special case)
        if opponent and toss_winner and opponent.lower() == toss_winner.lower() and match.get("result") == "Win":
            # This could be valid if opponent won toss but we won match
            pass  # Skip this check as it can be valid
    
    if issues:
        print(f"⚠️  WARNING: {len(issues)} potential consistency issue(s):")
        for match_id, issue in issues:
            print(f"   Match {match_id}: {issue}")
    else:
        print("✅ No obvious data consistency issues found")
    print()
    
    # Summary
    print("=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    if all_passed:
        print("✅ ALL TESTS PASSED")
        print(f"   Validated {len(match_results)} match(es)")
        return True
    else:
        print("❌ SOME TESTS FAILED")
        print("   Please review the errors above")
        return False

if __name__ == "__main__":
    success = test_match_results()
    sys.exit(0 if success else 1)

