'use strict';
// Job catalog, area corners, target and bot resolution, build().
const assert = require('node:assert/strict');
const {JOBS, CRAFTS, SMELTS, ITEMS, build, areaJobs, resolveTarget, resolveBots, germanName} = require('../botui-jobs');
const {VALIDATE} = require('../bots');


const ctx = {pos: [1.7, 64, -3.2], dim: 'overworld', yaw: 0, gaze: {x: -271, y: 66, z: -214, block: 'chest'}, supply: {x: 10, y: 65, z: 10}};

{ // names
  assert.equal(germanName('iron_ore'), 'Eisenerz'); assert.equal(germanName('some_new_block'), 'some new block');
}

{ // material for a plan, summon, aimed-at entities
  const env = {ctx: {gaze: null, pos: [3.4, 64, 4.9], dim: 'overworld'}, sel: {}, supply: {x: 10, y: 65, z: 10}, places: [], snaps: [{name: 'Bot1', online: true}], allowed: '*', schematics: ['house.litematic']};
    const pick = (key, data, extra = {}) => { const {type, args} = build(key, data, {...env, ...extra}); return {type, args}; };
  assert.deepEqual(pick('produce', {file: 'house.litematic', where: 'pos', rotation: 0, chest: 'supply'}).args,
    {file: 'house.litematic', origin: {x: 3, y: 64, z: 4}, rotation: 0, chests: [{x: 10, y: 65, z: 10}], store: {x: 10, y: 65, z: 10}});
  assert.deepEqual(pick('summon', {}), {type: 'goto', args: {x: 3, y: 64, z: 4}});
  assert.deepEqual(pick('followme', {}, {viewer: 'Midari'}), {type: 'follow', args: {player: 'Midari'}});
  assert.deepEqual(pick('hunt', {animal: 'cow', n: 3, x: 1, y: 2, z: 3}), {type: 'hunt', args: {animal: 'cow', count: 3, x: 1, y: 2, z: 3, radius: 24}});
  assert.throws(() => pick('hunt', {animal: 'creeper', x: 1, y: 2, z: 3}));
  assert.throws(() => pick('hunt', {animal: 'Cow!', x: 1, y: 2, z: 3}));
}

{ // every job builds args its VALIDATE accepts
  const box = {x1: 0, z1: 0, x2: 4, z2: 4};
  const sel = {a: {x: 0, y: 60, z: 0, dim: 'overworld'}, b: {x: 6, y: 62, z: 6, dim: 'overworld'}};
  const values = {block: 'iron_ore', item: 'stick', n: 16, radius: 16, at: {x: 1, y: 64, z: 2}, chest: {x: 1, y: 64, z: 2}, file: 'a.litematic', rotation: 90, zone: box, animal: 'cow', crop: 'carrot'};
  for (const [key, job] of Object.entries(JOBS)) {
    assert.doesNotThrow(() => VALIDATE[job.type](job.args(key === 'enchant' ? {...values, item: 'iron_pickaxe', n: 2} : values, {sel, supply: {x: 1, y: 2, z: 3}, viewer: 'Midari', pos: [1, 64, 2], dim: 'overworld'})), key);
    assert.ok(job.label && typeof job.say(values) === 'string', key);
  }
  assert.deepEqual(JOBS.mine.args({block: 'iron_ore', n: 64.0}, ctx), {block: 'iron_ore', count: 64, near: true});
  assert.deepEqual(JOBS.mine.args({block: 'iron_ore', n: 63.9999, far: true}, ctx), {block: 'iron_ore', count: 64});
  assert.deepEqual([JOBS.chop.args({n: 64}, ctx), JOBS.chop.args({n: 64, far: true}, ctx)], [{count: 64, near: true}, {count: 64}], 'menu orders stay near unless far');
}

{ // offered items pass VALIDATE for their job; ender chests offer nothing chest-like
  for (const i of CRAFTS) assert.doesNotThrow(() => VALIDATE.craft({item: i, count: 1}), i);
  for (const i of SMELTS) assert.doesNotThrow(() => VALIDATE.smelt({item: i, count: 1}), i);
  for (const i of ITEMS) assert.doesNotThrow(() => VALIDATE.get({item: i, count: 1}) && VALIDATE.withdraw({item: i, count: 1, x: 0, y: 0, z: 0}), i);
}

{ // resolveTarget
  assert.deepEqual(resolveTarget('1 2 3', ctx), {x: 1, y: 2, z: 3, dim: 'overworld'});
  assert.deepEqual(resolveTarget('-4, 70, 9', ctx), {x: -4, y: 70, z: 9, dim: 'overworld'});
  assert.throws(() => resolveTarget('a b c', ctx), /Koordinaten/);
  assert.throws(() => resolveTarget('1 2', ctx), /Koordinaten/);
  assert.throws(() => resolveTarget('1 999 3', ctx), /außerhalb/);
  assert.throws(() => resolveTarget('gaze', {}), /keinen Block/);
  assert.deepEqual(resolveTarget('pos', ctx), {x: 1, y: 64, z: -4, dim: 'overworld'});
  const places = [{name: 'Nether', kind: 'base', dim: 'the_nether', x: 1, y: 2, z: 3}, {name: 'Verboten', kind: 'protected', dim: 'overworld', x: 1, y: 2, z: 3}];
  assert.equal(resolveTarget('place:Nether', ctx, places).dim, 'the_nether');
  assert.throws(() => resolveTarget('place:Verboten', ctx, places), /nicht gefunden/);
}

{ // resolveBots
  const s = (name, over = {}) => ({name, online: true, dead: false, job: null, queue: [], dimension: 'overworld', ...over});
  const snaps = [s('bot1', {job: {label: 'x'}}), s('bot2'), s('MisaBot'), s('bot4', {dimension: 'the_nether'}), s('bot5', {online: false})];
  assert.deepEqual(resolveBots('frei', snaps, '*'), ['bot2']);
  assert.deepEqual(resolveBots('frei', snaps, ['MisaBot']), ['MisaBot']);
  assert.deepEqual(resolveBots('alle', snaps, '*', 'overworld'), ['bot1', 'bot2', 'MisaBot']);
  assert.throws(() => resolveBots('frei', [s('a', {job: {}})], '*'), /^Error: Kein freier Bot$/);
  assert.throws(() => resolveBots('frei', [s('a', {dimension: 'the_end'})], '*', 'overworld'), /in dieser Welt/);
  assert.throws(() => resolveBots('bot1', snaps, ['MisaBot']), /nicht dein Bot/);
  assert.throws(() => resolveBots('bot4', snaps, '*', 'overworld'), /bot4 ist in einer anderen Welt/);
  assert.deepEqual(resolveBots('bot4', snaps, '*'), ['bot4']);
}

{ // the viewer plays on main: a free pick stays in their world and off a guest's bots; a helper in the sandbox only by name and without a place
  const {build} = require('../botui-jobs');
  const s = (name, over = {}) => ({name, online: true, dead: false, job: null, queue: [], dimension: 'overworld', ...over});
  const snaps = [s('bot1', {sandbox: true}), s('MisaBot', {guest: true}), s('bot19'), s('bot2', {sandbox: true})];
  assert.deepEqual(resolveBots('frei', snaps, '*'), ['bot19']);
  assert.deepEqual(resolveBots('alle', snaps, '*'), ['bot19']);
  assert.deepEqual(resolveBots('frei', snaps, ['MisaBot']), ['MisaBot'], 'a guest keeps their own bots');
  assert.deepEqual(resolveBots('MisaBot', snaps, '*', 'overworld'), ['MisaBot'], 'the owner may still name a guest bot');
  assert.throws(() => resolveBots('frei', [s('bot1', {sandbox: true})], '*'), /^Error: Kein freier Bot in deiner Welt$/);
  assert.throws(() => resolveBots('bot1', snaps, '*', 'overworld'), /^Error: bot1 ist in der Sandbox, nicht in deiner Welt$/);
  assert.deepEqual(resolveBots('bot1', snaps, '*'), ['bot1'], 'a named helper may still take a job without a place');
  const env = {ctx: {gaze: null, pos: [1, 64, 2], dim: 'overworld'}, sel: {}, supply: null, places: [], snaps, allowed: '*', schematics: []};
  assert.throws(() => build('goto', {where: 'pos', who: 'bot1'}, env), /bot1 ist in der Sandbox/);
  assert.deepEqual(build('goto', {where: 'pos', who: 'frei'}, env).bots, ['bot19']);
}

{ // areaJobs
  const sel = (b) => ({a: {x: 0, y: 60, z: 0, dim: 'overworld'}, b: {...b, dim: b.dim || 'overworld'}});
  assert.deepEqual(areaJobs({a: {x: 0, y: 0, z: 0}, b: null}), []);
  const by = (list) => Object.fromEntries(list.map((j) => [j.key, j]));
  let r = by(areaJobs(sel({x: 8, y: 64, z: 8})));
  assert.ok(r.excavate.ok && r.clear.ok && r.light.ok && r.shaft.ok && r.seal.ok);
  r = by(areaJobs(sel({x: 20, y: 60, z: 20})));
  assert.deepEqual([r.excavate.ok, r.excavate.parts], [true, 9], 'a big Raum graben box goes out in parts'); assert.equal(r.clear.ok, true);
  r = by(areaJobs(sel({x: 40, y: 60, z: 40})));
  assert.deepEqual([r.clear.ok, r.clear.parts], [true, 4], 'a big Abbauen box goes out in parts'); assert.equal(r.light.ok, true);
  { // clearTiles: every part within 32 x 32 x 24, together the whole box, the top layer first; too many parts is refused
    const {clearTiles} = require('../botui-jobs'), s = sel({x: 20, y: 67, z: 79}), t = clearTiles(s), size = (q) => ['x', 'y', 'z'].map((k) => Math.abs(q.a[k] - q.b[k]) + 1);
    assert.equal(t.length, 3); assert.ok(t.every((q) => size(q)[0] <= 32 && size(q)[1] <= 24 && size(q)[2] <= 32 && q.a.dim === s.a.dim));
    assert.equal(t.reduce((n, q) => n + size(q).reduce((a, b) => a * b), 0), size(s).reduce((a, b) => a * b));
    const tall = clearTiles(sel({x: 3, y: 110, z: 3})); assert.ok(tall[0].a.y > tall.at(-1).a.y, 'top first');
    assert.equal(clearTiles(sel({x: 8, y: 64, z: 8})).length, 1);
    const huge = by(areaJobs(sel({x: 300, y: 60, z: 300}))); assert.equal(huge.clear.ok, false); assert.match(huge.clear.why, /höchstens 24 Teile/);
  }
  { // Raum graben in 9 x 9 x 5 parts, top first, every cell once; Ausleuchten cut across only; Schacht and Versiegeln never
    const {clearTiles} = require('../botui-jobs'), size = (q) => ['x', 'y', 'z'].map((k) => Math.abs(q.a[k] - q.b[k]) + 1);
    const cells = (t) => { const c = new Set(); let n = 0; for (const q of t) for (let x = q.a.x; x <= q.b.x; x++) for (let y = q.a.y; y <= q.b.y; y++) for (let z = q.a.z; z <= q.b.z; z++) { n++; c.add(`${x},${y},${z}`); } return [n, c.size]; };
    const s = sel({x: 17, y: 69, z: 17}), t = clearTiles(s, 'excavate');
    assert.equal(t.length, 8); assert.ok(t.every((q) => size(q)[0] <= 9 && size(q)[1] <= 5 && size(q)[2] <= 9 && q.a.dim === 'overworld'));
    assert.deepEqual(cells(t), [18 * 10 * 18, 18 * 10 * 18], 'no gap, no overlap'); assert.ok(t.slice(0, 4).every((q) => q.a.y === 65) && t.slice(4).every((q) => q.b.y === 64), 'top first');
    const lt = clearTiles(sel({x: 99, y: 79, z: 9}), 'light');
    assert.equal(lt.length, 2); assert.ok(lt.every((q) => q.a.y === 60 && q.b.y === 79)); assert.deepEqual(cells(lt), [100 * 20 * 10, 100 * 20 * 10]);
    assert.equal(clearTiles(sel({x: 99, y: 79, z: 99}), 'shaft').length, 1); assert.equal(clearTiles(sel({x: 99, y: 79, z: 99}), 'seal').length, 1);
    r = by(areaJobs(sel({x: 99, y: 79, z: 9})));
    assert.deepEqual([r.light.ok, r.light.parts], [true, 2]); assert.equal(r.shaft.ok, false); assert.equal(r.seal.ok, false); assert.match(r.seal.why, /zu groß oder zu klein/);
    r = by(areaJobs(sel({x: 99, y: 119, z: 9}))); assert.equal(r.light.ok, false); assert.match(r.light.why, /64 x 64 x 48/, 'over 48 high is not cut: a y seam would stay dark');
    r = by(areaJobs(sel({x: 49, y: 64, z: 49}))); assert.equal(r.excavate.ok, false); assert.match(r.excavate.why, /höchstens 24 Teile/);
  }
  r = by(areaJobs(sel({x: 1, y: 60, z: 1})));
  assert.equal(r.shaft.ok, false); // 2 x 2 is under the minimum
  assert.ok(areaJobs(sel({x: 8, y: 64, z: 8, dim: 'the_nether'})).every((j) => !j.ok && j.why === 'Ecken in verschiedenen Welten'));
}

{ // the hub validates the chest order
    assert.throws(() => VALIDATE.setchest({x: 1, y: 999, z: 3}));
    assert.deepEqual(VALIDATE.setchest({x: 1, y: 2, z: 3, junk: 1}), {x: 1, y: 2, z: 3});
}
{ // Tiere & Felder: farm jobs from the corners or a saved pen/field, never on the Bereich page; the idle path builds from v.zone
  const {AREA} = require('../botui-jobs');
  assert.ok(!AREA.includes('animalfarm') && !AREA.includes('cropfarm'));
  const p = (x, y, z) => ({x, y, z, dim: 'overworld'}), sel = {a: p(0, 64, 0), b: p(3, 65, 4)};
  const places = [{name: 'Tiere 5 5', kind: 'pen', dim: 'overworld', box: {x1: 5, y1: 60, z1: 5, x2: 9, y2: 66, z2: 9}}, {name: 'Feld 1 1', kind: 'field', dim: 'overworld', crop: 'potato', box: {x1: 1, y1: 60, z1: 1, x2: 4, y2: 66, z2: 4}}];
  const env = {ctx: {gaze: null, pos: [1, 64, 2], dim: 'overworld'}, sel, supply: null, places, snaps: [{name: 'bot1', online: true}], allowed: '*', schematics: []};
  assert.deepEqual(build('animalfarm', {who: 'bot1'}, env).args, {x1: 0, z1: 0, x2: 3, z2: 4, y: 64}); // y: the ground level the job searches around
  const c = build('cropfarm', {who: 'bot1', crop: 'carrot'}, env);
  assert.equal(c.type, 'cropfarm'); assert.deepEqual(c.args, {x1: 0, z1: 0, x2: 3, z2: 4, crop: 'carrot', y: 64});
  assert.throws(() => build('cropfarm', {who: 'bot1', crop: 'cactus'}, env));
  assert.throws(() => build('animalfarm', {who: 'bot1'}, {...env, sel: {a: p(0, 64, 0), b: p(16, 64, 16)}}), /at most 16 x 16/);
  assert.throws(() => build('animalfarm', {who: 'bot1'}, {...env, sel: {}}), /zwei Ecken/);
  assert.deepEqual(build('cropfarm', {who: 'bot1', zone: 'Feld 1 1', crop: 'carrot'}, {...env, sel: {}}).args, {x1: 1, z1: 1, x2: 4, z2: 4, crop: 'potato', y: 60}); // the saved crop wins
  assert.deepEqual(build('animalfarm', {who: 'bot1', zone: 'Tiere 5 5'}, {...env, sel: {}}).args, {x1: 5, z1: 5, x2: 9, z2: 9, y: 60});
  assert.throws(() => build('animalfarm', {who: 'bot1', zone: 'Feld 1 1'}, env), /Farm nicht gefunden/);
  // the idle path: resolveIdle hands the first pen/field's box as v.zone
  const {resolveIdle, choiceOf} = require('../idle'), high = {x1: 5, y1: 110, z1: 5, x2: 9, y2: 114, z2: 9};
  for (const [id, z] of [['tiere', {box: high}], ['feld', {box: high, crop: 'potato'}]]) {
    const ch = choiceOf(id), a = JOBS[ch.key].args(resolveIdle(ch, {zoneOf: () => z}), {});
    assert.equal(VALIDATE[JOBS[ch.key].type](a).y, 110, id);
  }
  assert.deepEqual(JOBS.animalfarm.args({zone: {x1: 5, z1: 5, x2: 9, z2: 9}}, {}), {x1: 5, z1: 5, x2: 9, z2: 9}, 'a zone without y1 gives no y');
  assert.deepEqual(JOBS.cropfarm.args({zone: places[1].box, kind: 'field', crop: 'potato'}, {}), {x1: 1, z1: 1, x2: 4, z2: 4, crop: 'potato', y: 60});
  assert.equal(germanName('beetroot'), 'Rote Bete');
}
console.log('botui-jobs ok');

{ // enchant: item and offer level, German say
  const env = {ctx: {gaze: null, pos: [1, 64, 2], dim: 'overworld'}, sel: {}, supply: null, places: [], snaps: [{name: 'bot1', online: true}], allowed: '*', schematics: []};
  const b = build('enchant', {who: 'bot1', item: 'iron_pickaxe', n: 2}, env);
  assert.equal(b.type, 'enchant'); assert.deepEqual(b.args, {item: 'iron_pickaxe', level: 2});
  assert.equal(b.say, 'Eisenspitzhacke verzaubern (Stufe 2)');
}
