"""Unit tests for the WGI historical-page parser — no network."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scraper"))

import scrape_wgi_history as H  # noqa: E402


PAGE = """
<h2>2004 INDEPENDENT WORLD</h2>
<table>
  <tr><th>Name</th><th>Score</th></tr>
  <tr><td>Fantasia</td><td>98.25</td></tr>
  <tr><td>Northern Lights</td><td>96.70</td></tr>
  <tr><td>Pride of Cincinnati*</td><td>94.10</td></tr>
</table>
<h2>2004 SCHOLASTIC A</h2>
<table>
  <tr><th>Name</th><th>Score</th></tr>
  <tr><td>Kennesaw Mt. HS</td><td>97.65</td></tr>
</table>
"""


class Headings(unittest.TestCase):
    def test_strips_the_year_and_titlecases(self):
        self.assertEqual(H.parse_class_heading("2004 INDEPENDENT WORLD", 2004), "Independent World")
        self.assertEqual(H.parse_class_heading("1995 SCHOLASTIC OPEN", 1995), "Scholastic Open")
        self.assertEqual(H.parse_class_heading("2019 INDEPENDENT A", 2019), "Independent A")

    def test_world_is_not_shadowed_by_the_a_class(self):
        # "SCHOLASTIC WORLD" contains no standalone "A", but the tier scan must
        # not match the "a" inside "SCHOLASTIC" either
        self.assertEqual(H.parse_class_heading("2010 SCHOLASTIC WORLD", 2010), "Scholastic World")

    def test_non_class_headings_are_ignored(self):
        for h in ("SUBSCRIBE TO THE eFOCUS NEWSLETTER!", "2004", "", "Privacy Overview",
                  "2004 PERCUSSION"):
            self.assertIsNone(H.parse_class_heading(h, 2004), h)

    def test_markup_inside_the_heading_is_tolerated(self):
        self.assertEqual(H.parse_class_heading("<strong>2004 INDEPENDENT WORLD</strong>", 2004),
                         "Independent World")


class Rows(unittest.TestCase):
    def test_reads_name_and_score_and_ranks_in_order(self):
        rows = H.parse_rows("""
          <tr><th>Name</th><th>Score</th></tr>
          <tr><td>Fantasia</td><td>98.25</td></tr>
          <tr><td>Northern Lights</td><td>96.70</td></tr>""")
        self.assertEqual([r["corps"] for r in rows], ["Fantasia", "Northern Lights"])
        self.assertEqual([r["place"] for r in rows], [1, 2])
        self.assertEqual(rows[0]["score"], 98.25)

    def test_the_tie_asterisk_is_not_part_of_the_name(self):
        rows = H.parse_rows("<tr><td>Pride of Cincinnati*</td><td>94.10</td></tr>")
        self.assertEqual(rows[0]["corps"], "Pride of Cincinnati")

    def test_header_rows_are_skipped_whatever_the_era_called_them(self):
        for header in ("Name", "Unit", "Color Guard", "Group", "Ensemble"):
            rows = H.parse_rows(f"<tr><td>{header}</td><td>Score</td></tr>"
                                "<tr><td>Real Unit</td><td>90.00</td></tr>")
            self.assertEqual([r["corps"] for r in rows], ["Real Unit"], header)

    def test_note_lines_and_blank_scores_are_dropped(self):
        rows = H.parse_rows("""
          <tr><td>Scores are unofficial for 30 minutes</td><td>&nbsp;</td></tr>
          <tr><td>Real Unit</td><td>90.00</td></tr>
          <tr><td>Withdrew</td><td>DNS</td></tr>""")
        self.assertEqual([r["corps"] for r in rows], ["Real Unit"])

    def test_zero_is_not_a_score(self):
        self.assertEqual(H.parse_rows("<tr><td>Unit</td><td>0</td></tr>"), [])

    def test_entities_are_decoded(self):
        rows = H.parse_rows("<tr><td>St. Ann&#8217;s</td><td>95.55</td></tr>")
        self.assertEqual(rows[0]["corps"], "St. Ann’s")


class Year(unittest.TestCase):
    def test_builds_one_championship_event_with_every_class(self):
        ev = H.parse_year(2004, PAGE)
        self.assertEqual(ev["year"], 2004)
        self.assertEqual(ev["circuit"], "WGI")
        self.assertTrue(ev["finals_only"])
        self.assertEqual(ev["name"], "WGI World Championships 2004")
        self.assertEqual([c["class"] for c in ev["classes"]],
                         ["Independent World", "Scholastic A"])
        self.assertTrue(all(c["division"] == "Color Guard" for c in ev["classes"]))
        self.assertEqual(len(ev["classes"][0]["results"]), 3)

    def test_a_page_with_no_classes_yields_nothing(self):
        self.assertIsNone(H.parse_year(2014, "<h2>404 - PAGE NOT FOUND</h2>"))
        self.assertIsNone(H.parse_year(2014, ""))

    def test_a_class_whose_table_is_empty_is_dropped_not_emitted_blank(self):
        ev = H.parse_year(2004, "<h2>2004 INDEPENDENT WORLD</h2><table><tr><th>Name</th></tr></table>")
        self.assertIsNone(ev)

    def test_the_event_links_back_to_the_page_it_came_from(self):
        ev = H.parse_year(2004, PAGE)
        self.assertEqual(ev["url"], "https://www.wgi.org/historical_scores/2004/")
        for banned in ("/event/", "/show/", "/season/", "/group/", "/orgs/"):
            self.assertNotIn(banned, ev["url"])


if __name__ == "__main__":
    unittest.main()
