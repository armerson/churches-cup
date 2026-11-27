// Pulls live tournament data from the deployed churches-cup Apps Script
// backend — the actual submitted/confirmed scores, knockout match
// results (including which real teams ended up in each knockout slot,
// which depends on live standings and isn't knowable from static data),
// rosters, admin schedule overrides, and notices.
//
// Read-only: every call here is a GET against one of Code.gs's doGet
// actions (getScores/getKO/getRosters/getSchedule/getNotices). Nothing
// in this script ever calls a doPost action — it can't write to, or in
// any way disturb, the live tournament.
//
// NOTE: script.google.com is not reachable from the sandbox this
// migration script was developed in (confirmed: the egress proxy
// rejects it outright), so the HTTP calls below are written to the
// exact contract documented in Code.gs's getScores/getKOMatches/
// getRosters/getSchedule/getNotices functions, but have not been
// exercised against the real live endpoint. Run this from an
// environment that can actually reach script.google.com, and sanity-
// check the first run's output before trusting it blindly.

const API_URL =
  "https://script.google.com/macros/s/AKfycbyubQx7dYI--e8UEyfz_rQ0mayLE1GxHZE3acWmKGj84g0nXKqqBu3uRSOlJDwUgJzX/exec";

async function getJson(action) {
  const res = await fetch(`${API_URL}?action=${action}`);
  if (!res.ok) {
    throw new Error(`${action}: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchLiveTournamentData() {
  const [scores, ko, rosters, schedule, notices] = await Promise.all([
    getJson("getScores"),
    getJson("getKO"),
    getJson("getRosters"),
    getJson("getSchedule"),
    getJson("getNotices"),
  ]);

  return {
    // [{ id, group, team1, team2, score1, score2, scorers, scorers2,
    //    submittedBy, status, timestamp, disputeNote? }]
    scores: Array.isArray(scores) ? scores : [],
    // [{ matchId, competition, round, matchNum, team1, team2, score1,
    //    score2, penScore1, penScore2, winner, timestamp, status,
    //    submittedBy, scorers1, scorers2 }]
    ko: Array.isArray(ko) ? ko : [],
    // { teamName: [player1, player2, ...] }
    rosters: rosters && typeof rosters === "object" ? rosters : {},
    // { matchKey: { time, pitch, notes } } — sparse admin overrides
    schedule: schedule && typeof schedule === "object" ? schedule : {},
    // [{ id, message, timestamp }]
    notices: Array.isArray(notices) ? notices : [],
  };
}
