// Deploy as Web App: Execute as Me, Anyone can access

function doGet(e) {
  var action = e.parameter.action;
  var result;
  if (action === 'getScores')        result = getScores();
  else if (action === 'getRosters')  result = getRosters();
  else if (action === 'getKO')       result = getKOMatches();
  else if (action === 'getPins')     result = getPins();
  else if (action === 'getSchedule') result = getSchedule();
  else if (action === 'getNotices')  result = getNotices();
  else                               result = { error: 'Unknown action' };
  return toJson(result);
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var result;
  if (data.action === 'submitScore')        result = submitScore(data);
  else if (data.action === 'updateStatus')  result = updateStatus(data);
  else if (data.action === 'saveRoster')    result = saveRoster(data);
  else if (data.action === 'saveKO')        result = saveKOMatch(data);
  else if (data.action === 'editScore')     result = editScore(data);
  else if (data.action === 'updatePin')     result = updatePin(data);
  else if (data.action === 'setFixtureTime') result = setFixtureTime(data);
  else if (data.action === 'postNotice')     result = postNotice(data);
  else if (data.action === 'deleteNotice')   result = deleteNotice(data);
  else                                      result = { error: 'Unknown action' };
  return toJson(result);
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
  // Save opposition scorers if provided, using dynamic column (safe for existing sheets)
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

// ---------- KO Matches ----------
// Columns: matchId, competition, round, matchNum, team1, team2,
//          score1, score2, penScore1, penScore2, winner, timestamp

function getKOMatches() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('KOMatches');
  if (!sheet) return [];
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  var headers = rows[0];
  return rows.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function saveKOMatch(data) {
  var sheet = getOrCreateSheet('KOMatches', [
    'matchId','competition','round','matchNum',
    'team1','team2','score1','score2','penScore1','penScore2','winner','timestamp'
  ]);
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var midCol = headers.indexOf('matchId');

  // Update if exists
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][midCol]) === String(data.matchId)) {
      sheet.getRange(i+1, 1, 1, 12).setValues([[
        data.matchId, data.competition, data.round, data.matchNum,
        data.team1, data.team2,
        Number(data.score1), Number(data.score2),
        data.penScore1 !== undefined ? data.penScore1 : '',
        data.penScore2 !== undefined ? data.penScore2 : '',
        data.winner, new Date().toISOString()
      ]]);
      return { success: true };
    }
  }

  // Insert new
  sheet.appendRow([
    data.matchId, data.competition, data.round, data.matchNum,
    data.team1, data.team2,
    Number(data.score1), Number(data.score2),
    data.penScore1 !== undefined ? data.penScore1 : '',
    data.penScore2 !== undefined ? data.penScore2 : '',
    data.winner, new Date().toISOString()
  ]);
  return { success: true };
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
// Sheet columns: matchKey (sorted team1||team2), time, pitch, notes

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

// ---------- PINs ----------

function getPins() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Pins');
  if (!sheet) return {};
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return {};
  var result = {};
  rows.slice(1).forEach(function(row) {
    if (row[0] && row[1]) result[String(row[1])] = String(row[0]);
  });
  return result;
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
  }).reverse(); // newest first
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
