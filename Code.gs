// Deploy as Web App: Execute as Me, Anyone can access

function doGet(e) {
  var action = e.parameter.action;
  var result;
  if (action === 'getScores')        result = getScores();
  else if (action === 'getRosters')  result = getRosters();
  else if (action === 'getKO')       result = getKOMatches();
  else if (action === 'getSchedule') result = getSchedule();
  else if (action === 'getNotices')  result = getNotices();
  else                               result = { error: 'Unknown action' };
  return toJson(result);
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return toJson({ error: 'Server busy — please try again in a few seconds.' });
  }
  try {
    return toJson(routePost(data));
  } finally {
    lock.releaseLock();
  }
}

function routePost(data) {
  var result;
  if (data.action === 'login')              result = login(data);
  else if (data.action === 'loginAdmin')    result = loginAdmin(data);
  else if (data.action === 'submitScore')   result = requireTeamAuth(data, data.team1) || submitScore(data);
  else if (data.action === 'updateStatus')  result = authorizeStatusUpdate(data) || updateStatus(data);
  else if (data.action === 'saveRoster')    result = saveRoster(data);
  else if (data.action === 'saveKO')        result = authorizeKO(data) || saveKOMatch(data);
  else if (data.action === 'confirmKO')     result = authorizeKOConfirm(data) || confirmKOMatch(data);
  else if (data.action === 'editScore')     result = requireAdminAuth(data) || editScore(data);
  else if (data.action === 'deleteScore')   result = requireAdminAuth(data) || deleteScore(data);
  else if (data.action === 'updatePin')     result = requireTeamAuth(data, data.team, data.currentPin) || updatePin(data);
  else if (data.action === 'setFixtureTime') result = requireAdminAuth(data) || setFixtureTime(data);
  else if (data.action === 'postNotice')     result = requireAdminAuth(data) || postNotice(data);
  else if (data.action === 'deleteNotice')   result = requireAdminAuth(data) || deleteNotice(data);
  else                                      result = { error: 'Unknown action' };
  return result;
}

var ADMIN_PIN = '1234';
var DEFAULT_TEAM_PINS = {
  'Covenant':'0001','Mourne':'0002','Spain Madrid':'0003','Waringstown Presbyterian Church':'0004',
  'Bethany FC':'0005','Ballymagerney FPC':'0006','YAKAAR ACADEMY':'0007','Sloan Street Presbyterian':'0008',
  'Grace Community Church Richhill':'0009','Portabello Baptist':'0010','NTPC':'0011','Portadown Elim':'0012',
  'Eagles':'0013','Acpc fc':'0014','Lurgan Elim':'0015','Ulster wonders fc':'0016',
  'Craigavon PC':'0017','Newmills':'0018','Bleary FC':'0019','Benburb Ballers':'0020',
  'Killicomaine Baptist church':'0021','CGR FC':'0022','CFPC Originals':'0023','Gortmerron Goats':'0024',
  'Ancora Church Football':'0025','Legacurry Presbyterian':'0026','Emmanuel Baptist':'0027','Downshire Church':'0028',
  'Derry/Edenderry':'0029','The Blues':'0030','Ardtrea Aardvarks':'0031','Team Black':'0032'
};

function login(data) {
  return validTeamPin(data.team, data.pin) ? { success: true, team: data.team } : { error: 'Invalid team or code.' };
}

function loginAdmin(data) {
  return String(data.pin || '') === ADMIN_PIN ? { success: true } : { error: 'Invalid organizer code.' };
}

function requireTeamAuth(data, team, pinOverride) {
  if (!team || String(data.authTeam || '') !== String(team)) return { error: 'Not authorised for this team.' };
  var pin = pinOverride !== undefined ? pinOverride : data.authPin;
  return validTeamPin(team, pin) ? null : { error: 'Invalid or expired team PIN. Please log in again.' };
}

function requireAdminAuth(data) {
  return String(data.adminPin || '') === ADMIN_PIN ? null : { error: 'Admin authorisation required.' };
}

function authorizeStatusUpdate(data) {
  var score = findScoreById(data.id);
  if (!score) return { error: 'Score not found' };
  var team = String(data.authTeam || '');
  if (team !== String(score.team1) && team !== String(score.team2)) return { error: 'Not authorised for this score.' };
  if (team === String(score.submittedBy)) return { error: 'Submitting team cannot confirm its own score.' };
  return requireTeamAuth(data, team);
}

function authorizeKO(data) {
  var adminError = requireAdminAuth(data);
  if (!adminError) return null;
  var team = String(data.authTeam || '');
  if (team && (team === String(data.team1) || team === String(data.team2))) return requireTeamAuth(data, team);
  return adminError;
}

// Authorise a team to confirm/dispute a KO match submitted by the other team.
// The confirming team must be involved in the match but must NOT be the submitter.
function authorizeKOConfirm(data) {
  var match = findKOById(data.matchId);
  if (!match) return { error: 'KO match not found' };
  var team = String(data.authTeam || '');
  // Admins can always confirm
  var adminError = requireAdminAuth(data);
  if (!adminError) return null;
  // Team must be involved
  if (team !== String(match.team1) && team !== String(match.team2)) {
    return { error: 'Not authorised for this match.' };
  }
  // Submitting team cannot confirm its own submission
  if (team === String(match.submittedBy)) {
    return { error: 'Submitting team cannot confirm its own result.' };
  }
  return requireTeamAuth(data, team);
}

function validTeamPin(team, pin) {
  return !!team && String(pin || '') === getPinForTeam(team);
}

function getPinForTeam(team) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Pins');
  if (sheet) {
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(team) && rows[i][1]) return String(rows[i][1]);
    }
  }
  return DEFAULT_TEAM_PINS[team] || '';
}

function findScoreById(id) {
  var scores = getScores();
  for (var i = 0; i < scores.length; i++) {
    if (String(scores[i].id) === String(id)) return scores[i];
  }
  return null;
}

function findKOById(matchId) {
  var matches = getKOMatches();
  for (var i = 0; i < matches.length; i++) {
    if (String(matches[i].matchId) === String(matchId)) return matches[i];
  }
  return null;
}

// ---------- Group Scores ----------

function getScores() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scores');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  var headers = rows[0];
  return rows.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    if (obj.scorers && typeof obj.scorers === 'string') {
      try { obj.scorers = JSON.parse(obj.scorers); } catch(err) { obj.scorers = []; }
    }
    if (obj.scorers2 && typeof obj.scorers2 === 'string') {
      try { obj.scorers2 = JSON.parse(obj.scorers2); } catch(err) { obj.scorers2 = []; }
    }
    return obj;
  });
}

function submitScore(data) {
  data.submittedBy = data.authTeam;
  var sheet = getOrCreateSheet('Scores', [
    'id','group','team1','team2','score1','score2','scorers','submittedBy','status','timestamp'
  ]);
  var existing = getScores().filter(function(s) {
    return ((s.team1 === data.team1 && s.team2 === data.team2) ||
            (s.team1 === data.team2 && s.team2 === data.team1)) &&
           (s.status === 'pending' || s.status === 'confirmed');
  });
  if (existing.length > 0) return { error: 'A score for this fixture is already pending or confirmed.' };
  var id = Utilities.getUuid();
  sheet.appendRow([
    id, data.group, data.team1, data.team2,
    Number(data.score1), Number(data.score2),
    JSON.stringify(data.scorers || []),
    data.submittedBy, 'pending', new Date().toISOString()
  ]);
  if (data.scorers2 && data.scorers2.length > 0) {
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0];
    function ensureColS(name) {
      var idx = headers.indexOf(name);
      if (idx === -1) { idx = headers.length; headers.push(name); sheet.getRange(1, idx+1).setValue(name); }
      return idx;
    }
    var s2c = ensureColS('scorers2');
    sheet.getRange(rows.length, s2c+1).setValue(JSON.stringify(data.scorers2));
  }
  return { success: true, id: id };
}

function updateStatus(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scores');
  if (!sheet) return { error: 'No Scores sheet' };
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idCol = headers.indexOf('id');
  var statusCol = headers.indexOf('status');

  function ensureCol(name) {
    var idx = headers.indexOf(name);
    if (idx === -1) { idx = headers.length; headers.push(name); sheet.getRange(1, idx+1).setValue(name); }
    return idx;
  }

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(data.id)) {
      sheet.getRange(i+1, statusCol+1).setValue(data.status);
      if (data.status === 'disputed' && data.note) {
        var nc = ensureCol('disputeNote');
        sheet.getRange(i+1, nc+1).setValue(data.note);
      }
      if (data.confirmScorers && data.confirmScorers.length > 0) {
        var s2c = ensureCol('scorers2');
        sheet.getRange(i+1, s2c+1).setValue(JSON.stringify(data.confirmScorers));
      }
      return { success: true };
    }
  }
  return { error: 'Score not found' };
}

function editScore(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scores');
  if (!sheet) return { error: 'No Scores sheet' };
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idCol     = headers.indexOf('id');
  var s1Col     = headers.indexOf('score1');
  var s2Col     = headers.indexOf('score2');
  var statusCol = headers.indexOf('status');
  function ensureCol(name) {
    var idx = headers.indexOf(name);
    if (idx === -1) { idx = headers.length; headers.push(name); sheet.getRange(1, idx+1).setValue(name); }
    return idx;
  }
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(data.id)) {
      sheet.getRange(i+1, s1Col+1).setValue(Number(data.score1));
      sheet.getRange(i+1, s2Col+1).setValue(Number(data.score2));
      sheet.getRange(i+1, statusCol+1).setValue('confirmed');
      if (data.scorers)  sheet.getRange(i+1, ensureCol('scorers')+1).setValue(JSON.stringify(data.scorers));
      if (data.scorers2) sheet.getRange(i+1, ensureCol('scorers2')+1).setValue(JSON.stringify(data.scorers2));
      return { success: true };
    }
  }
  return { error: 'Score not found' };
}

function deleteScore(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scores');
  if (!sheet) return { error: 'No Scores sheet' };
  var rows = sheet.getDataRange().getValues();
  var idCol = rows[0].indexOf('id');
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: 'Score not found' };
}

// ---------- KO Matches ----------
// Columns: matchId, competition, round, matchNum, team1, team2,
//          score1, score2, penScore1, penScore2, winner, timestamp
// Extra columns (added via ensureCol): status, submittedBy, scorers1, scorers2

function getKOMatches() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('KOMatches');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  var headers = rows[0];
  return rows.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    if (obj.scorers1 && typeof obj.scorers1 === 'string') {
      try { obj.scorers1 = JSON.parse(obj.scorers1); } catch(err) { obj.scorers1 = []; }
    }
    if (obj.scorers2 && typeof obj.scorers2 === 'string') {
      try { obj.scorers2 = JSON.parse(obj.scorers2); } catch(err) { obj.scorers2 = []; }
    }
    return obj;
  });
}

function saveKOMatch(data) {
  if (data.winner && data.winner !== data.team1 && data.winner !== data.team2) return { error: 'Winner must be one of the match teams.' };

  var isAdmin = String(data.adminPin || '') === ADMIN_PIN;

  var sheet = getOrCreateSheet('KOMatches', [
    'matchId','competition','round','matchNum',
    'team1','team2','score1','score2','penScore1','penScore2','winner','timestamp'
  ]);
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var midCol = headers.indexOf('matchId');

  function ensureCol(name) {
    var idx = headers.indexOf(name);
    if (idx === -1) { idx = headers.length; headers.push(name); sheet.getRange(1, idx+1).setValue(name); }
    return idx;
  }

  // When a team (non-admin) submits, status = 'pending' and no winner yet.
  // When admin submits, go straight to confirmed with winner.
  var submitStatus = isAdmin ? 'confirmed' : 'pending';
  var submitWinner = isAdmin ? (data.winner || '') : '';
  var submittedBy  = isAdmin ? '' : (data.authTeam || '');

  function writeScorers(rowNum) {
    var s1, s2;
    if (data.scorersTeam) {
      if (String(data.scorersTeam) === String(data.team1)) s1 = data.scorers || [];
      if (String(data.scorersTeam) === String(data.team2)) s2 = data.scorers || [];
    } else {
      s1 = data.scorers1;
      s2 = data.scorers2;
    }
    if (s1 !== undefined) sheet.getRange(rowNum, ensureCol('scorers1')+1).setValue(JSON.stringify(s1));
    if (s2 !== undefined) sheet.getRange(rowNum, ensureCol('scorers2')+1).setValue(JSON.stringify(s2));
  }

  // Update if exists
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][midCol]) === String(data.matchId)) {
      var existingStatus = String(rows[i][headers.indexOf('status')] || '');
      // Block duplicate pending submissions from teams (not admins)
      if (!isAdmin && existingStatus === 'pending') {
        return { error: 'A result for this match is already pending confirmation.' };
      }
      sheet.getRange(i+1, 1, 1, 12).setValues([[
        data.matchId, data.competition, data.round, data.matchNum,
        data.team1, data.team2,
        Number(data.score1), Number(data.score2),
        data.penScore1 !== undefined ? data.penScore1 : '',
        data.penScore2 !== undefined ? data.penScore2 : '',
        submitWinner, new Date().toISOString()
      ]]);
      // Write status and submittedBy in extra columns
      sheet.getRange(i+1, ensureCol('status')+1).setValue(submitStatus);
      sheet.getRange(i+1, ensureCol('submittedBy')+1).setValue(submittedBy);
      writeScorers(i+1);
      return { success: true };
    }
  }

  // Insert new row
  sheet.appendRow([
    data.matchId, data.competition, data.round, data.matchNum,
    data.team1, data.team2,
    Number(data.score1), Number(data.score2),
    data.penScore1 !== undefined ? data.penScore1 : '',
    data.penScore2 !== undefined ? data.penScore2 : '',
    submitWinner, new Date().toISOString()
  ]);
  var newRow = sheet.getLastRow();
  sheet.getRange(newRow, ensureCol('status')+1).setValue(submitStatus);
  sheet.getRange(newRow, ensureCol('submittedBy')+1).setValue(submittedBy);
  writeScorers(newRow);
  return { success: true };
}

// Confirm (or dispute) a KO match that was submitted as pending by a team.
// Determines winner from stored scores and updates status + winner columns.
function confirmKOMatch(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('KOMatches');
  if (!sheet) return { error: 'No KOMatches sheet' };
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var midCol = headers.indexOf('matchId');

  function ensureCol(name) {
    var idx = headers.indexOf(name);
    if (idx === -1) { idx = headers.length; headers.push(name); sheet.getRange(1, idx+1).setValue(name); }
    return idx;
  }

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][midCol]) === String(data.matchId)) {
      var newStatus = String(data.status || 'confirmed');
      sheet.getRange(i+1, ensureCol('status')+1).setValue(newStatus);

      if (newStatus === 'confirmed') {
        // Derive winner from scores already stored in the row
        var s1Col = headers.indexOf('score1');
        var s2Col = headers.indexOf('score2');
        var p1Col = headers.indexOf('penScore1');
        var p2Col = headers.indexOf('penScore2');
        var t1Col = headers.indexOf('team1');
        var t2Col = headers.indexOf('team2');
        var winnerCol = headers.indexOf('winner');

        var s1 = Number(rows[i][s1Col]);
        var s2 = Number(rows[i][s2Col]);
        var p1 = Number(rows[i][p1Col]) || 0;
        var p2 = Number(rows[i][p2Col]) || 0;
        var t1 = String(rows[i][t1Col]);
        var t2 = String(rows[i][t2Col]);

        var winner = '';
        if (s1 > s2) winner = t1;
        else if (s2 > s1) winner = t2;
        else if (p1 > p2) winner = t1;
        else if (p2 > p1) winner = t2;
        // If still tied (e.g. no penalties entered), leave winner blank

        // Use data.winner override if explicitly passed and valid
        if (data.winner && (data.winner === t1 || data.winner === t2)) {
          winner = data.winner;
        }

        if (winnerCol >= 0) {
          sheet.getRange(i+1, winnerCol+1).setValue(winner);
        }
      } else if (newStatus === 'disputed') {
        // Clear winner on dispute
        var winnerColD = headers.indexOf('winner');
        if (winnerColD >= 0) sheet.getRange(i+1, winnerColD+1).setValue('');
      }

      return { success: true };
    }
  }
  return { error: 'KO match not found' };
}

// ---------- Rosters ----------

function getRosters() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Rosters');
  if (!sheet) return {};
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return {};
  var result = {};
  rows.slice(1).forEach(function(row) {
    result[row[0]] = row.slice(1).filter(function(p) { return p; });
  });
  return result;
}

function saveRoster(data) {
  var maxPlayers = 10;
  var headers = ['team'];
  for (var n = 1; n <= maxPlayers; n++) headers.push('player' + n);
  var sheet = getOrCreateSheet('Rosters', headers);
  var rows = sheet.getDataRange().getValues();
  var players = (data.players || []).slice(0, maxPlayers);
  while (players.length < maxPlayers) players.push('');
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.team) {
      sheet.getRange(i+1, 1, 1, maxPlayers+1).setValues([[data.team].concat(players)]);
      return { success: true };
    }
  }
  sheet.appendRow([data.team].concat(players));
  return { success: true };
}

// ---------- Schedule / Fixture Times ----------

function getSchedule() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Schedule');
  if (!sheet) return {};
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return {};
  var headers = rows[0];
  var result = {};
  rows.slice(1).forEach(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    if (obj.matchKey) result[String(obj.matchKey)] = { time: obj.time || '', pitch: obj.pitch || '', notes: obj.notes || '' };
  });
  return result;
}

function setFixtureTime(data) {
  var sheet = getOrCreateSheet('Schedule', ['matchKey','time','pitch','notes']);
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var keyCol = headers.indexOf('matchKey');
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][keyCol]) === String(data.matchKey)) {
      sheet.getRange(i+1, 1, 1, 4).setValues([[data.matchKey, data.time || '', data.pitch || '', data.notes || '']]);
      return { success: true };
    }
  }
  sheet.appendRow([data.matchKey, data.time || '', data.pitch || '', data.notes || '']);
  return { success: true };
}

function updatePin(data) {
  var sheet = getOrCreateSheet('Pins', ['team', 'pin']);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.team)) {
      sheet.getRange(i+1, 2).setValue(String(data.newPin));
      return { success: true };
    }
  }
  sheet.appendRow([data.team, String(data.newPin)]);
  return { success: true };
}

// ---------- Noticeboard ----------

function getNotices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Notices');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  var headers = rows[0];
  return rows.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  }).reverse();
}

function postNotice(data) {
  var sheet = getOrCreateSheet('Notices', ['id','message','timestamp']);
  var id = Utilities.getUuid();
  sheet.appendRow([id, data.message, new Date().toISOString()]);
  return { success: true, id: id };
}

function deleteNotice(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Notices');
  if (!sheet) return { error: 'No Notices sheet' };
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idCol = headers.indexOf('id');
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: 'Notice not found' };
}

// ---------- Helpers ----------

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function toJson(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
