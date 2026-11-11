"""Unit tests for the judge analytics — no network, no data files."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scraper"))

import build_judges as J  # noqa: E402


GROUPS = [
    {"n": "General Effect", "subs": [
        {"n": "General Effect 1", "j": "A. One", "cols": ["Rep", "Perf"]},
        {"n": "General Effect 2", "j": "B. Two", "cols": ["Rep", "Perf"]}]},
    {"n": "Music", "subs": [
        {"n": "Music - Brass", "j": "C. Three", "cols": ["Cont", "Achv"]}]},
]
# layout: GE1 Rep, Perf, Tot | GE2 Rep, Perf, Tot | GE grpTot
#         MB Cont, Achv, Tot | Music grpTot      -> judge Tots at 2, 5, 9


class Columns(unittest.TestCase):
    def test_judge_totals_land_where_the_sheet_puts_them(self):
        cols = J.recap_columns(GROUPS)
        slots = [(i, c["judge"], c["caption"]) for i, c in enumerate(cols) if c]
        self.assertEqual(slots, [(2, "A. One", "General Effect 1"),
                                 (5, "B. Two", "General Effect 2"),
                                 (9, "C. Three", "Music - Brass")])

    def test_a_group_with_no_subs_still_consumes_its_total_column(self):
        cols = J.recap_columns([{"n": "Empty", "subs": []},
                                {"n": "Music", "subs": [
                                    {"n": "Music - Brass", "j": "X", "cols": ["a", "b"]}]}])
        self.assertEqual([i for i, c in enumerate(cols) if c], [3])

    def test_missing_groups_do_not_raise(self):
        self.assertEqual(J.recap_columns(None), [])
        self.assertEqual(J.recap_columns([]), [])


class Spearman(unittest.TestCase):
    def test_identical_orderings_are_one(self):
        self.assertAlmostEqual(J._spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1.0)

    def test_reversed_orderings_are_minus_one(self):
        self.assertAlmostEqual(J._spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)

    def test_ties_use_average_ranks_and_do_not_divide_by_zero(self):
        self.assertIsNone(J._spearman([5, 5, 5, 5], [1, 2, 3, 4]))

    def test_too_few_points_is_none(self):
        self.assertIsNone(J._spearman([1, 2], [1, 2]))


def recap(rows, groups=GROUPS, date="2026-07-01", event="Show", cls="World Class"):
    return {"d": date, "e": event, "classes": [{"c": cls, "groups": groups, "rows": rows}]}


def row(name, ge1, ge2, mb):
    # values only need to be right at the judge-total columns
    return [name, [0, 0, ge1, 0, 0, ge2, 0, 0, 0, mb, 0], [1] * 11]


class Rooms(unittest.TestCase):
    def setUp(self):
        self._read = J.read_json

    def tearDown(self):
        J.read_json = self._read

    def feed(self, events):
        J.read_json = lambda path: {"events": events}

    def test_a_small_room_is_ignored(self):
        self.feed([recap([row("A", 16, 16, 16), row("B", 15, 15, 15)])])
        self.assertEqual(J.read_rooms(2026), [])

    def test_a_full_room_is_read(self):
        self.feed([recap([row(n, 16, 16, 16) for n in "ABCD"])])
        rooms = J.read_rooms(2026)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(len(rooms[0]["corps"]), 4)

    def test_an_incomplete_sheet_is_dropped_not_half_counted(self):
        rows = [row(n, 16, 16, 16) for n in "ABCD"]
        rows.append(["E", [0, 0, 16, 0, 0, 0, 0, 0, 0, 16, 0], [1] * 11])  # GE2 missing
        self.feed([recap(rows)])
        rooms = J.read_rooms(2026)
        self.assertEqual([n for n, _ in rooms[0]["corps"]], ["A", "B", "C", "D"])

    def test_no_recap_file_is_not_an_error(self):
        J.read_json = lambda path: None
        self.assertEqual(J.read_rooms(2026), [])


class Season(unittest.TestCase):
    def setUp(self):
        self._read = J.read_json

    def tearDown(self):
        J.read_json = self._read

    def season(self, n_shows, ge1_of):
        """n shows of four corps; ge1_of(corps) sets the GE1 judge's score."""
        evs = []
        for s in range(n_shows):
            rows = [row(c, ge1_of(c), 16.0, 16.0) for c in "ABCD"]
            evs.append(recap(rows, date=f"2026-07-0{s + 1}", event=f"Show {s}"))
        J.read_json = lambda path: {"events": evs}

    def test_a_judge_scoring_above_the_room_reads_as_running_high(self):
        self.season(6, lambda c: 17.0)        # GE1 a point over the other subs
        out = J.build_year(2026)
        ge1 = next(j for j in out["judges"] if j["judge"] == "A. One")
        self.assertGreater(ge1["tendency"], 0)
        other = next(j for j in out["judges"] if j["judge"] == "C. Three")
        self.assertLess(other["tendency"], 0)

    def test_tendency_is_reported_against_the_captions_own_norm(self):
        self.season(6, lambda c: 17.0)
        out = J.build_year(2026)
        ge1 = next(j for j in out["judges"] if j["judge"] == "A. One")
        # sole judge of its caption: its offset IS the caption's, so rel is ~0
        self.assertAlmostEqual(ge1["rel"], 0.0, places=6)
        self.assertIn("General Effect 1", out["captions"])

    def test_agreement_is_withheld_below_the_room_floor(self):
        self.season(J.AGREE_MIN_ROOMS - 1, lambda c: {"A": 18, "B": 17, "C": 16, "D": 15}[c])
        out = J.build_year(2026)
        for j in out["judges"]:
            self.assertIsNone(j["agreement"], j["judge"])
            self.assertLess(j["agreement_rooms"], J.AGREE_MIN_ROOMS)

    def test_agreement_appears_once_there_are_enough_rooms(self):
        self.season(J.AGREE_MIN_ROOMS + 1, lambda c: {"A": 18, "B": 17, "C": 16, "D": 15}[c])
        out = J.build_year(2026)
        ge1 = next(j for j in out["judges"] if j["judge"] == "A. One")
        self.assertIsNotNone(ge1["agreement"])
        self.assertAlmostEqual(ge1["agreement"], 1.0, places=6)

    def test_a_seat_below_the_sample_floor_is_not_published_at_all(self):
        self.season(1, lambda c: 16.0)
        self.assertIsNone(J.build_year(2026))

    def test_a_season_with_no_recaps_yields_nothing(self):
        J.read_json = lambda path: {"events": []}
        self.assertIsNone(J.build_year(2026))


if __name__ == "__main__":
    unittest.main()
