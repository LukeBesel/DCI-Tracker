"""Unit tests for the WGI scraper's pure parsing logic — no network."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scraper"))

import scrape_wgi  # noqa: E402


def group(name, score, place=None, hide=False, display=True):
    g = {"backend_Group_Friendly_Name__c": name, "gss_cs_score__c": score}
    if place is not None:
        g["Placement"] = place
    if hide:
        g["gss_bool_Hide_Score__c"] = True
    if not display:
        g["gss_bool_Score_Display__c"] = False
    return g


class ScoreReading(unittest.TestCase):
    def test_reads_a_plain_score(self):
        self.assertEqual(scrape_wgi._score(group("A", "94.340")), 94.34)

    def test_withheld_scores_are_dropped_not_zeroed(self):
        self.assertIsNone(scrape_wgi._score(group("A", "94.340", hide=True)))
        self.assertIsNone(scrape_wgi._score(group("A", "94.340", display=False)))

    def test_blank_and_junk_are_dropped(self):
        for raw in ("", "   ", "TBD", "n/a", "--"):
            self.assertIsNone(scrape_wgi._score(group("A", raw)), raw)

    def test_zero_is_not_a_score(self):
        # an unscored entry comes through as 0, which would otherwise rank last
        # as though the group had competed and bombed
        self.assertIsNone(scrape_wgi._score(group("A", "0")))
        self.assertIsNone(scrape_wgi._score(group("A", "0.000")))


class Results(unittest.TestCase):
    def detail(self, results):
        return {"Results": results}

    def test_maps_a_class_into_the_app_shape(self):
        out = scrape_wgi._results(self.detail({
            "Independent World": {"Round 0": [
                group("Fusion", "97.100", 1), group("Rhythm X", "95.200", 2)]}}), "Percussion")
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["class"], "Independent World")
        self.assertEqual(out[0]["division"], "Percussion")
        self.assertEqual([r["corps"] for r in out[0]["results"]], ["Fusion", "Rhythm X"])
        self.assertEqual(out[0]["results"][0]["score"], 97.1)

    def test_division_is_given_its_readable_label(self):
        out = scrape_wgi._results(self.detail({
            "Scholastic A": {"Round 0": [group("Oviedo HS", "88.000", 1)]}}), "Guard")
        self.assertEqual(out[0]["division"], "Color Guard")

    def test_a_later_round_supersedes_an_earlier_one(self):
        # prelims then finals: the finals scores are the show's result
        out = scrape_wgi._results(self.detail({
            "Independent A": {
                "Round 0": [group("Luminus", "91.040", 1)],
                "Round 1": [group("Luminus", "94.340", 1)]}}), "Guard")
        self.assertEqual(out[0]["results"][0]["score"], 94.34)

    def test_broken_placements_fall_back_to_ranking_by_score(self):
        out = scrape_wgi._results(self.detail({
            "Independent Open": {"Round 0": [
                group("Low", "80.000"), group("High", "95.000"), group("Mid", "88.000")]}}), "Guard")
        rows = out[0]["results"]
        self.assertEqual([r["corps"] for r in rows], ["High", "Mid", "Low"])
        self.assertEqual([r["place"] for r in rows], [1, 2, 3])

    def test_a_class_with_no_usable_scores_is_omitted(self):
        out = scrape_wgi._results(self.detail({
            "Scholastic World": {"Round 0": [
                group("A", "", 1), group("B", "0", 2)]}}), "Winds")
        self.assertEqual(out, [])

    def test_withheld_groups_drop_out_but_the_class_survives(self):
        out = scrape_wgi._results(self.detail({
            "Scholastic Open": {"Round 0": [
                group("Shown", "90.000", 1), group("Withheld", "89.000", 2, hide=True)]}}), "Guard")
        self.assertEqual([r["corps"] for r in out[0]["results"]], ["Shown"])

    def test_empty_and_malformed_payloads_do_not_raise(self):
        self.assertEqual(scrape_wgi._results({}, "Guard"), [])
        self.assertEqual(scrape_wgi._results({"Results": None}, "Guard"), [])
        self.assertEqual(scrape_wgi._results(self.detail({"": {}}), "Guard"), [])
        self.assertEqual(scrape_wgi._results(self.detail({"X": []}), "Guard"), [])
        self.assertEqual(scrape_wgi._results(self.detail({"X": {"Round 0": ["junk", None]}}), "Guard"), [])


class Coverage(unittest.TestCase):
    def test_only_years_the_api_answers_for_are_listed(self):
        # a year absent from SEASONS must yield nothing rather than a guess
        self.assertEqual(scrape_wgi.build_year(1999), [])
        self.assertEqual(scrape_wgi.build_year(2021), [])

    def test_the_covered_years_are_the_api_backed_ones(self):
        self.assertEqual(sorted(scrape_wgi.SEASONS), [2024, 2025, 2026, 2027])

    def test_event_links_stay_off_the_robots_disallowed_paths(self):
        # wgi.org disallows /event/, /show/, /season/, /group/, /orgs/
        for div in scrape_wgi.DIVISIONS:
            url = scrape_wgi._event_url("a0uABC", div)
            self.assertIn("/scores/", url)
            for banned in ("/event/", "/show/", "/season/", "/group/", "/orgs/"):
                self.assertNotIn(banned, url)


if __name__ == "__main__":
    unittest.main()


class LiveSeason(unittest.TestCase):
    """The fetch cache never re-asks. That is right for a finished season and
    wrong for a live one, where WGI keeps adding shows and correcting scores."""

    def setUp(self):
        self.calls = []
        self._se, self._sd = scrape_wgi.season_events, scrape_wgi.show_detail
        today = scrape_wgi.date.today()
        self.recent = (today - scrape_wgi.timedelta(days=2)).isoformat() if hasattr(scrape_wgi, "timedelta") else None

        def season_events(sid, division, force=False):
            self.calls.append(("season", sid, force))
            return [{"show-id-key": "OLD", "Name": "Old Show", "Show_Date__c": "2001-01-01"},
                    {"show-id-key": "NEW", "Name": "New Show", "Show_Date__c": today.isoformat()}]

        def show_detail(show_id, division, force=False):
            self.calls.append(("show", show_id, force))
            return {"Results": {"Independent A": {"Round 0": [group("X", "80.0", 1)]}}}

        scrape_wgi.season_events, scrape_wgi.show_detail = season_events, show_detail

    def tearDown(self):
        scrape_wgi.season_events, scrape_wgi.show_detail = self._se, self._sd

    def forced(self, kind, key):
        return [f for k, x, f in self.calls if k == kind and x == key]

    def test_the_live_season_relists_its_shows_every_run(self):
        live = max(scrape_wgi.SEASONS)
        scrape_wgi.build_year(live)
        self.assertTrue(all(self.forced("season", scrape_wgi.SEASONS[live])))

    def test_a_recent_show_refetches_and_an_old_one_trusts_the_cache(self):
        scrape_wgi.build_year(max(scrape_wgi.SEASONS))
        self.assertTrue(all(self.forced("show", "NEW")))
        self.assertFalse(any(self.forced("show", "OLD")))

    def test_a_finished_season_never_refetches(self):
        past = min(scrape_wgi.SEASONS)
        scrape_wgi.build_year(past)
        self.assertFalse(any(f for _k, _x, f in self.calls))


class Merge(unittest.TestCase):
    """The pipeline runs the scraper twice — the live season often, the older
    ones daily — so a run may only replace the years it was given."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self._parsed, self._by = scrape_wgi.PARSED, scrape_wgi.build_year
        scrape_wgi.PARSED = self.tmp
        (self.tmp / "wgi_events.json").write_text(json.dumps(
            [{"year": 2024, "name": "A", "classes": [1]}, {"year": 2025, "name": "B", "classes": [1]}]))

    def tearDown(self):
        scrape_wgi.PARSED, scrape_wgi.build_year = self._parsed, self._by

    def held(self):
        return sorted((e["year"], e["name"]) for e in json.loads((self.tmp / "wgi_events.json").read_text()))

    def test_rebuilding_one_year_leaves_the_others_alone(self):
        scrape_wgi.build_year = lambda y, limit=None: [{"year": y, "name": "C", "classes": [1]}] if y == 2026 else []
        scrape_wgi.main([2026])
        self.assertEqual(self.held(), [(2024, "A"), (2025, "B"), (2026, "C")])

    def test_a_rebuilt_year_replaces_its_old_events(self):
        scrape_wgi.build_year = lambda y, limit=None: [{"year": 2025, "name": "B2", "classes": [1]}]
        scrape_wgi.main([2025])
        self.assertEqual(self.held(), [(2024, "A"), (2025, "B2")])

    def test_a_year_that_comes_back_empty_is_kept_not_wiped(self):
        scrape_wgi.build_year = lambda y, limit=None: []          # WGI's API down
        scrape_wgi.main([2024, 2025])
        self.assertEqual(self.held(), [(2024, "A"), (2025, "B")])
