"""Unit tests for the WGI builder's merge and ordering logic."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scraper"))

import build_wgi as B  # noqa: E402


def ev(year, name, classes, **kw):
    e = {"year": year, "name": name, "classes": classes, "date_iso": kw.pop("date", ""),
         "circuit": "WGI"}
    e.update(kw)
    return e


def grp(division, cls, *pairs):
    return {"class": cls, "division": division,
            "results": [{"place": i + 1, "corps": c, "score": s} for i, (c, s) in enumerate(pairs)]}


class ClassOrdering(unittest.TestCase):
    def test_world_then_open_then_a(self):
        got = B.sort_classes(["Independent A", "Independent World", "Independent Open"])
        self.assertEqual(got, ["Independent World", "Independent Open", "Independent A"])

    def test_independent_is_listed_before_scholastic_at_each_tier(self):
        got = B.sort_classes(["Scholastic World", "Independent World", "Scholastic Open",
                              "Independent Open"])
        self.assertEqual(got, ["Independent World", "Scholastic World",
                               "Independent Open", "Scholastic Open"])

    def test_unknown_classes_sort_last_but_do_not_vanish(self):
        got = B.sort_classes(["Marching Open", "Independent World", "Concert Open"])
        self.assertEqual(got[0], "Independent World")
        self.assertEqual(sorted(got[1:]), ["Concert Open", "Marching Open"])


class DivisionOrdering(unittest.TestCase):
    def test_wgis_own_order_not_alphabetical(self):
        self.assertEqual(B.sort_divisions({"Winds", "Color Guard", "Percussion"}),
                         ["Color Guard", "Percussion", "Winds"])

    def test_only_the_divisions_present_are_listed(self):
        self.assertEqual(B.sort_divisions({"Color Guard"}), ["Color Guard"])

    def test_blanks_are_dropped(self):
        self.assertEqual(B.sort_divisions({"Color Guard", "", None}), ["Color Guard"])


class Merge(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(self.enterContext(__import__("tempfile").TemporaryDirectory()))
        self._real = B.PARSED
        B.PARSED = self.tmp

    def tearDown(self):
        B.PARSED = self._real

    def write(self, name, obj):
        (self.tmp / name).write_text(json.dumps(obj))

    def test_api_and_history_both_load(self):
        self.write("wgi_events.json", [ev(2026, "A Show", [grp("Color Guard", "Independent World", ("X", 90.0))])])
        self.write("wgi_history_events.json", [ev(2019, "WGI World Championships 2019",
                   [grp("Color Guard", "Independent World", ("Y", 98.25))], finals_only=True)])
        got = B.load_events()
        self.assertEqual(sorted(e["year"] for e in got), [2019, 2026])

    def test_the_api_wins_a_year_both_sources_claim(self):
        # the API carries every show; history carries only the championship
        self.write("wgi_events.json", [ev(2026, "API Show", [grp("Color Guard", "Independent World", ("X", 90.0))])])
        self.write("wgi_history_events.json", [ev(2026, "History Champs",
                   [grp("Color Guard", "Independent World", ("Y", 98.0))], finals_only=True)])
        got = B.load_events()
        self.assertEqual([e["name"] for e in got], ["API Show"])

    def test_classes_with_no_rows_are_dropped_and_empty_events_with_them(self):
        self.write("wgi_events.json", [
            ev(2026, "Half Empty", [grp("Color Guard", "Independent World", ("X", 90.0)),
                                    {"class": "Scholastic A", "division": "Color Guard", "results": []}]),
            ev(2026, "All Empty", [{"class": "Scholastic A", "division": "Color Guard", "results": []}]),
        ])
        got = B.load_events()
        self.assertEqual([e["name"] for e in got], ["Half Empty"])
        self.assertEqual(len(got[0]["classes"]), 1)

    def test_missing_files_are_not_an_error(self):
        self.assertEqual(B.load_events(), [])

    def test_malformed_json_is_ignored_rather_than_crashing(self):
        (self.tmp / "wgi_events.json").write_text("{not json")
        self.assertEqual(B.load_events(), [])


class Rankings(unittest.TestCase):
    def test_uses_each_units_best_score_of_the_latest_season(self):
        events = [
            ev(2026, "Early", [grp("Color Guard", "Independent World", ("X", 85.0), ("Y", 80.0))], date="2026-02-01"),
            ev(2026, "Finals", [grp("Color Guard", "Independent World", ("X", 95.0), ("Y", 90.0))], date="2026-04-01"),
            ev(2025, "Old", [grp("Color Guard", "Independent World", ("Z", 99.0))], date="2025-04-01"),
        ]
        rk = B.build_rankings(events)
        self.assertEqual(rk["season"], 2026)
        rows = rk["standings"]["Color Guard"]["Independent World"]["rows"]
        self.assertEqual([r["corps"] for r in rows], ["X", "Y"])
        self.assertEqual(rows[0]["score"], 95.0)        # best, not latest or first
        self.assertEqual(rows[0]["rank"], 1)
        self.assertEqual(rows[0]["event"], "Finals")

    def test_divisions_and_classes_are_indexed_in_wgi_order(self):
        events = [ev(2026, "S", [
            grp("Winds", "Independent A", ("W", 70.0)),
            grp("Color Guard", "Independent Open", ("A", 80.0)),
            grp("Color Guard", "Independent World", ("B", 90.0))], date="2026-04-01")]
        rk = B.build_rankings(events)
        self.assertEqual(rk["divisions"], ["Color Guard", "Winds"])
        self.assertEqual(rk["classes"]["Color Guard"], ["Independent World", "Independent Open"])

    def test_no_events_yields_an_empty_mapping_not_a_crash(self):
        self.assertEqual(B.build_rankings([]), {})


if __name__ == "__main__":
    unittest.main()
