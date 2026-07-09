"""Generate synthetic parsed-source data to test build_data.py + the site
offline (dev only — never runs in CI)."""
import json
import random
from pathlib import Path

random.seed(7)
PARSED = Path(__file__).resolve().parent.parent / "data" / "parsed"
PARSED.mkdir(parents=True, exist_ok=True)

WORLD = ["Bluecoats", "Blue Devils", "Boston Crusaders", "Carolina Crown",
         "Santa Clara Vanguard", "Phantom Regiment", "The Cavaliers", "The Cadets",
         "Blue Stars", "Blue Knights", "Colts", "Madison Scouts", "Crossmen",
         "Mandarins", "Pacific Crest", "Troopers", "Genesis", "Music City"]
OPEN = ["Vanguard Cadets", "Blue Devils B", "Spartans", "Gold", "The Battalion",
        "Golden Empire", "Impulse", "Guardians"]
DCA = ["Reading Buccaneers", "Hawthorne Caballeros", "Bushwackers", "Fusion Core",
       "Carolina Gold", "White Sabers", "Atlanta CV", "Skyliners"]

def season_events(year, upto_month_day=None):
    events = []
    base = {c: random.uniform(68, 75) - i * 0.8 for i, c in enumerate(WORLD)}
    base_open = {c: random.uniform(60, 68) - i * 0.9 for i, c in enumerate(OPEN)}
    dates = [(6, 20), (6, 24), (6, 28), (7, 2), (7, 5), (7, 8), (7, 12), (7, 19),
             (7, 26), (8, 2), (8, 7), (8, 8), (8, 9)]
    names = ["DCI Kickoff", "Drums Along the Rockies", "Western Corps Connection",
             "DCI West", "Drums Across America", "Summer Music Games",
             "DCI Southwestern Championship", "DCI Southeastern Championship",
             "DCI Eastern Classic", "Drum Corps at the Rose Bowl",
             "DCI World Championship Prelims", "DCI World Championship Semifinals",
             "DCI World Championship Finals"]
    for i, ((mo, dy), nm) in enumerate(zip(dates, names)):
        if upto_month_day and (mo, dy) > upto_month_day:
            break
        prog = i * 1.6
        k = min(len(WORLD), 8 + (i % 5))
        corps = random.sample(WORLD, k)
        rows = sorted(
            [{"corps": c, "score": round(min(99.2, base[c] + prog + random.uniform(-0.7, 0.9)), 3)} for c in corps],
            key=lambda r: -r["score"])
        for p, r in enumerate(rows):
            r["place"] = p + 1
        classes = [{"class": "World Class", "results": rows}]
        if i % 2 == 0:
            oc = random.sample(OPEN, 5)
            orows = sorted(
                [{"corps": c, "score": round(base_open[c] + prog + random.uniform(-0.8, 0.8), 3)} for c in oc],
                key=lambda r: -r["score"])
            for p, r in enumerate(orows):
                r["place"] = p + 1
            classes.append({"class": "Open Class", "results": orows})
        ev = {
            "url": f"https://www.dci.org/scores/final-scores/{year}-{nm.lower().replace(' ', '-')}/",
            "slug": f"{year}-{nm.lower().replace(' ', '-')}",
            "year": year, "name": nm,
            "date_display": f"{['','January','February','March','April','May','June','July','August'][mo]} {dy}, {year}",
            "location": random.choice(["Indianapolis, IN", "Denver, CO", "Allentown, PA", "San Antonio, TX", "Atlanta, GA", "Pasadena, CA"]),
            "classes": classes,
        }
        if i >= len(dates) - 3:
            ev["recap_url"] = ev["url"].replace("final-scores", "recap")
            ev["recap"] = [{
                "class": "World Class",
                "captions": ["Corps", "GE1", "GE2", "GE Total", "Visual Prof", "Visual Anal", "Color Guard", "Brass", "Music Anal", "Percussion", "Total"],
                "rows": [{"corps": r["corps"], "total": r["score"],
                          "cells": [r["corps"]] + [f"{random.uniform(8.5, 9.9):.2f}" for _ in range(9)] + [f"{r['score']:.3f}"]}
                         for r in classes[0]["results"]],
            }]
        events.append(ev)
    return events

dci_events = []
for yr in range(2013, 2026):
    dci_events += season_events(yr)
dci_events += season_events(2026, upto_month_day=(7, 8))
(PARSED / "dci_events.json").write_text(json.dumps(dci_events))

dcnet_dci = []
for yr in range(2001, 2013):
    evs = season_events(yr)
    for e in evs:
        e["url"] = f"https://www.drum-corps.net/scores/dci/{random.randint(100,4000)}"
        e.pop("recap", None); e.pop("recap_url", None)
    dcnet_dci += evs
(PARSED / "dcnet_dci.json").write_text(json.dumps(dcnet_dci))

dcnet_dca = []
for yr in range(2001, 2026):
    base = {c: random.uniform(75, 82) - i * 1.1 for i, c in enumerate(DCA)}
    for j, nm in enumerate(["DCA June Classic", "DCA World Championships Prelims", "DCA World Championships Finals"]):
        rows = sorted([{"corps": c, "score": round(base[c] + j * 2 + random.uniform(-1, 1), 3)} for c in random.sample(DCA, 6)], key=lambda r: -r["score"])
        for p, r in enumerate(rows):
            r["place"] = p + 1
        dcnet_dca.append({
            "url": f"https://www.drum-corps.net/scores/dca/{random.randint(100,4000)}",
            "name": nm, "year": yr,
            "date_display": f"{'June' if j == 0 else 'September'} {random.randint(1, 28)}, {yr}",
            "location": "Rochester, NY",
            "classes": [{"class": "Open Class", "results": rows}],
        })
(PARSED / "dcnet_dca.json").write_text(json.dumps(dcnet_dca))
(PARSED / "dca_site.json").write_text("[]")

finals = []
for yr in range(1972, 2005):
    corps = random.sample(WORLD + ["27th Lancers", "Star of Indiana", "Suncoast Sound", "Velvet Knights", "Bridgemen", "North Star", "Glassmen", "Kilties", "Anaheim Kingsmen"], 12)
    top = random.uniform(85, 98.4)
    finals.append({"year": yr, "results": [
        {"place": p + 1, "corps": c, "score": round(top - p * random.uniform(0.4, 1.4), 2),
         "repertoire": "Selections from mock repertoire"} for p, c in enumerate(corps)]})
(PARSED / "dci_finals_history.json").write_text(json.dumps(finals))
(PARSED / "dci_finals_recaps.json").write_text(json.dumps(
    {str(y["year"]): f"MOCK ARCHIVAL RECAP {y['year']}\nCorps        GE   Brass  Perc  Visual  Total\n" +
     "\n".join(f"{r['corps'][:20]:<22}{random.uniform(15,20):.1f} {random.uniform(15,20):.1f} {random.uniform(15,20):.1f} {random.uniform(15,20):.1f}  {r['score']:.2f}" for r in y["results"])
     for y in finals}))

(PARSED / "dca_champions.json").write_text(json.dumps(
    [{"year": y, "corps": random.choice(DCA), "score": round(random.uniform(88, 99), 3), "location": "Rochester, NY"}
     for y in range(1965, 2001)]))

(PARSED / "news.json").write_text(json.dumps([
    {"source": "DCI", "title": f"Mock headline {i}: scores climb as tour heads to Allentown", "url": f"https://www.dci.org/news/mock-{i}", "date": f"2026-07-{8 - i:02d}", "summary": "Mock summary of the news item for layout testing."}
    for i in range(1, 7)] + [
    {"source": "DCA", "title": "DCA announces 2026 championship weekend schedule", "url": "https://dcacorps.org/news/mock", "date": "2026-07-05", "summary": "Mock DCA item."}]))

print("mock parsed data written")
