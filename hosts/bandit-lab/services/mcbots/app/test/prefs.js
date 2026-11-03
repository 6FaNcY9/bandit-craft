'use strict';
(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
  const {loadPrefs, savePrefs} = require('../prefs');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mcbots-prefs-'));
  try {
    const file = path.join(dir, 'prefs.json');
    assert.deepEqual(loadPrefs(file, 'MisaBot'), {chest: null, keep: {}, verbose: false});
    savePrefs(file, 'MisaBot', {chest: {x: 120, y: 64, z: -340}});
    savePrefs(file, 'MisaBot', {keep: {stick: 64}, verbose: true});
    savePrefs(file, 'bot23', {verbose: true});
    assert.deepEqual(loadPrefs(file, 'MisaBot'), {chest: {x: 120, y: 64, z: -340}, keep: {stick: 64}, verbose: true});
    assert.deepEqual(loadPrefs(file, 'bot23'), {chest: null, keep: {}, verbose: true});
    fs.writeFileSync(file, JSON.stringify({MisaBot: {chest: 'nope', keep: 3, verbose: 'yes'}}));
    assert.deepEqual(loadPrefs(file, 'MisaBot'), {chest: null, keep: {}, verbose: false});
    assert.deepEqual(loadPrefs(null, 'MisaBot'), {chest: null, keep: {}, verbose: false});
    savePrefs(null, 'MisaBot', {verbose: true}); // no throw
    // a corrupt file is not overwritten (that would wipe the other bots' prefs); loading stays tolerant
    fs.writeFileSync(file, '{"bot23": {"verbose": tr');
    assert.throws(() => savePrefs(file, 'MisaBot', {verbose: true}), /^Error: Einstellungen nicht lesbar$/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"bot23": {"verbose": tr');
    assert.deepEqual(loadPrefs(file, 'MisaBot'), {chest: null, keep: {}, verbose: false});
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
})();
