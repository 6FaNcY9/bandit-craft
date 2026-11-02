'use strict';
// Pure helpers for the in-game console channel: sidebar lines (one per bot), panel tokens and the order inbox
// parser. The Ingame class that pushes them to the Minecraft console builds on these.
const token = (text) => String(text).trim().replace(/§./g, '').replace(/[^A-Za-z0-9./:+-]+/g, '_').slice(0, 32) || '-';
const statusToken = (snap) => token(snap.activity || (snap.online ? 'frei' : 'offline'));

function sidebarLines(snaps, {guests}) {
  const list = [...snaps.filter((s) => !guests.includes(s.name)), ...snaps.filter((s) => guests.includes(s.name))].slice(0, 15);
  return list.map((s, i) => {
    const act = String(s.activity || ''), text = act.length > 28 ? act.slice(0, 28) + '…' : act;
    const color = s.dead ? 'dark_red' : !s.online || act.startsWith('idle') ? 'gray' : typeof s.lastErrorAgoS === 'number' && s.lastErrorAgoS < 300 ? 'red' : 'white';
    return {entry: s.name, score: 15 - i, component: JSON.stringify(['', {text: s.name + ' ', color: 'aqua'}, {text, color}])};
  });
}

function parseInbox(value) {
  const m = /^(\w{1,16}):([\w.\/-]{1,64})$/.exec(value || '');
  const words = m && m[2].split('_').filter(Boolean);
  return words && words.length ? {bot: m[1], words} : null;
}

module.exports = {token, sidebarLines, parseInbox, statusToken};
