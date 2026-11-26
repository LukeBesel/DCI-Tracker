"""Unit tests for the WGI recap parser, on a synthetic sheet that reproduces
each trap the real recaps contain — no network."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scraper"))

import scrape_wgi_recaps as R  # noqa: E402


def score(cls, raw):
    return (f"<td class='{cls}' style='width: 30px;'>\n<table class='scoreTable' cellpadding='0' "
            f"cellspacing='0'><tr><td class='content score' data-translate-number='{raw}'>{raw}</td>"
            f"</tr><tr><td class='content rank'>1</td></tr></table></td>")


HEADER = """
<tr><td>2026 WGI Test Regional</td></tr>
<tr><td>Percussion Scholastic A</td></tr>
<tr><td rowspan='3'></td><td rowspan='3'></td>
    <td colspan='7'>Equipment Analysis</td><td colspan='3'>General Effect</td>
    <td rowspan='3'>Sub Total</td><td>Timing &amp; Penalties</td><td rowspan='3'>Total</td></tr>
<tr><td colspan='3'>A. One</td><td colspan='3'>B. Two</td><td></td>
    <td colspan='3'>C. Three</td><td>P. Pen</td></tr>
<tr><td>Voc</td><td>Exc</td><td>*Tot</td><td>Voc</td><td>Exc</td><td>*Tot</td><td>Tot</td>
    <td>Rep</td><td>Perf</td><td>Tot</td><td>Pen</td></tr>
"""


def unit_row(name, hometown=True, pen="0.1", total="29.145", sub="29.245", extra=""):
    cells = [score("topBorder rightBorder verified", "75"), score("topBorder rightBorder verified", "71"),
             score("topBorder rightBorder subcaptionTotal", "14.48"),
             score("topBorder rightBorder verified", "75"), score("topBorder rightBorder verified", "72"),
             score("topBorder rightBorder subcaptionTotal", "14.61"),
             score("topBorder rightBorderDouble captionTotal", "14.545"),
             score("topBorder rightBorder verified", "75"), score("topBorder rightBorder verified", "72"),
             score("topBorder rightBorder subcaptionTotal", "14.70"),
             score("topBorder rightBorderDouble", sub),
             score("topBorder rightBorder verified", pen),
             score("topBorder rightBorderDouble", total)]
    home = "<td class='content topBorder rightBorderDouble' rowspan='2'>Somewhere, IL</td>" if hometown else ""
    return (f"<tr><td class='content topBorder rightBorderDouble'>{name}</td>{home}"
            + "".join(cells) + extra + "</tr>")


def page(*rows):
    return HEADER + "<!--PerformancesStart-->" + "".join(rows) + "<!--PerformancesEnd-->"


EVENT = {"classes": [{"class": "Scholastic Marching A", "division": "Percussion",
                      "results": [{"corps": "Alpha HS", "score": 29.145},
                                  {"corps": "Beta HS", "score": 29.145}]}]}


class Layout(unittest.TestCase):
    def setUp(self):
        self.title, self.captions, self.plan = R.parse_layout(HEADER)

    def test_class_title_is_not_mistaken_for_a_caption_group(self):
        self.assertEqual(self.title, "Percussion Scholastic A")
        self.assertEqual(self.captions[:2], ["Equipment Analysis", "General Effect"])

    def test_the_judge_row_is_the_spine(self):
        kinds = [k for k, _j, _c in self.plan]
        self.assertEqual(kinds, ["sub", "sub", "jtot", "sub", "sub", "jtot", "ctot",
                                 "sub", "sub", "jtot", "subtotal", "pen", "total"])
        jt = [(j, c) for k, j, c in self.plan if k == "jtot"]
        self.assertEqual(jt, [("A. One", "Equipment Analysis"), ("B. Two", "Equipment Analysis"),
                              ("C. Three", "General Effect")])

    def test_a_header_whose_spans_disagree_is_refused(self):
        broken = HEADER.replace("<td colspan='3'>C. Three</td>", "<td colspan='2'>C. Three</td>")
        self.assertIsNone(R.parse_layout(broken))


class Rows(unittest.TestCase):
    def rows(self, *r):
        return R.parse_rows(page(*r).split("<!--PerformancesStart-->")[1], R.parse_layout(HEADER)[2])

    def test_a_doubled_panel_uses_its_combined_total(self):
        row = self.rows(unit_row("Alpha HS"))[0]
        self.assertEqual(row["caps"]["Equipment Analysis"], 14.545)
        self.assertEqual(row["caps"]["General Effect"], 14.70)     # single judge
        self.assertEqual([j["v"] for j in row["judges"]], [14.48, 14.61, 14.70])

    def test_the_penalty_is_a_true_value_not_x10(self):
        row = self.rows(unit_row("Alpha HS"))[0]
        self.assertEqual(row["pen"], 0.1)                          # not 0.01

    def test_total_is_read_from_its_column_not_taken_as_the_max(self):
        # the sub-total (29.245) is larger than the post-penalty total
        row = self.rows(unit_row("Alpha HS"))[0]
        self.assertEqual(row["total"], 29.145)
        self.assertEqual(row["sub"], 29.245)

    def test_a_unit_with_no_hometown_column_still_parses(self):
        row = self.rows(unit_row("Alpha HS", hometown=False))[0]
        self.assertEqual(row["unit"], "Alpha HS")
        self.assertEqual(row["total"], 29.145)

    def test_a_row_with_the_wrong_cell_count_is_flagged_not_misaligned(self):
        extra = score("topBorder rightBorder verified", "50")
        row = self.rows(unit_row("Alpha HS", extra=extra))[0]
        self.assertIn("error", row)


class Reconcile(unittest.TestCase):
    def row(self, **kw):
        r = R.parse_rows(page(unit_row("Alpha HS", **kw)).split("<!--PerformancesStart-->")[1],
                         R.parse_layout(HEADER)[2])[0]
        return r

    def test_a_sound_row_passes(self):
        self.assertIsNone(R.reconcile(self.row(), 29.145))

    def test_a_total_that_disagrees_with_wgi_is_dropped(self):
        self.assertIn("!= WGI", R.reconcile(self.row(), 30.0))

    def test_captions_that_do_not_sum_to_the_subtotal_are_dropped(self):
        self.assertIn("captions sum", R.reconcile(self.row(sub="31.000", total="30.900"), 30.9))

    def test_a_penalty_that_does_not_explain_the_total_is_dropped(self):
        self.assertIn("pen", R.reconcile(self.row(total="29.000"), 29.0))

    def test_a_unit_wgi_never_published_is_dropped(self):
        self.assertIn("not in WGI", R.reconcile(self.row(), None))


class Event(unittest.TestCase):
    def test_the_sheet_takes_the_api_class_name_by_unit_overlap(self):
        sheets, kept, dropped, _ = R.parse_event(page(unit_row("Alpha HS"), unit_row("Beta HS")), EVENT)
        self.assertEqual(kept, 2)
        self.assertEqual(dropped, 0)
        self.assertEqual(sheets[0]["class"], "Scholastic Marching A")   # not the recap's title
        self.assertEqual(sheets[0]["division"], "Percussion")
        self.assertEqual(sheets[0]["captions"], ["Equipment Analysis", "General Effect"])

    def test_a_sheet_whose_units_match_no_class_is_skipped(self):
        sheets, kept, _d, _ = R.parse_event(page(unit_row("Gamma HS"), unit_row("Delta HS")), EVENT)
        self.assertEqual((sheets, kept), ([], 0))

    def test_bad_rows_drop_but_the_class_survives(self):
        ev = {"classes": [{"class": "Scholastic Marching A", "division": "Percussion",
                           "results": [{"corps": "Alpha HS", "score": 29.145},
                                       {"corps": "Beta HS", "score": 99.0}]}]}
        sheets, kept, dropped, _ = R.parse_event(page(unit_row("Alpha HS"), unit_row("Beta HS")), ev)
        self.assertEqual((kept, dropped), (1, 1))
        self.assertEqual([r["unit"] for r in sheets[0]["rows"]], ["Alpha HS"])


if __name__ == "__main__":
    unittest.main()


class Freshness(unittest.TestCase):
    """A recap first fetched mid-show is partial; it must be refetched until
    the show is old enough to be final."""

    def test_a_recent_show_is_refetched(self):
        from datetime import date
        self.assertTrue(R._recent({"date_iso": "2026-03-01", "year": 2026}, date(2026, 3, 5)))

    def test_an_old_show_reads_from_cache(self):
        from datetime import date
        self.assertFalse(R._recent({"date_iso": "2025-03-01", "year": 2025}, date(2026, 3, 5)))

    def test_an_undated_show_refreshes_only_in_its_own_season(self):
        from datetime import date
        self.assertTrue(R._recent({"date_iso": "", "year": 2026}, date(2026, 3, 5)))
        self.assertFalse(R._recent({"date_iso": "", "year": 2024}, date(2026, 3, 5)))
