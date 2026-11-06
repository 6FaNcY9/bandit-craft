// Minimal protocol client for the BotUi stand. NODE_PATH must point at the mcbots node_modules.
const mc = require('minecraft-protocol');
const nbt = require('prismarine-nbt');

const varint = (n) => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return Buffer.from(o); };
const str = (s) => Buffer.concat([varint(Buffer.byteLength(s)), Buffer.from(s)]);

function connect(username, port = 25599) {
  return new Promise((resolve, reject) => {
    const c = mc.createClient({host: '127.0.0.1', port, username, auth: 'offline', version: '26.1'});
    const dialogs = [], maps = [], counts = {particles: 0}, inv = [], windows = [], chats = []; // inv: the player inventory window as the server last sent it
    c.on('error', reject);
    c.on('position', (p) => c.write('teleport_confirm', {teleportId: p.teleportId})); // else the server ignores our movement
    c.on('packet', (data, meta) => {
      if (meta.name === 'show_dialog') dialogs.push(nbt.simplify(data.dialog.data));
      else if (meta.name === 'open_window') windows.push(data.windowId);
      else if (meta.name === 'system_chat') chats.push(JSON.stringify(nbt.simplify(data.content)));
      else if (meta.name === 'map') maps.push(data);
      else if (meta.name === 'window_items' && data.windowId === 0) inv.splice(0, inv.length, ...data.items);
      else if (meta.name === 'set_slot' && data.windowId === 0) inv[data.slot] = data.item;
      else if (meta.name === 'world_particles') counts.particles++;
    });
    c.once('login', () => {
      c.write('player_loaded', {}); // the server ignores movement until the client reports it has loaded
      resolve({
        dialogs, maps, counts, inv, windows, chats,
        // The dialog click packet is written raw: minecraft-data's anonymous-NBT shape makes Paper drop the connection.
        click(id, data) {
          const value = {};
          for (const [k, v] of Object.entries(data)) value[k] = typeof v === 'number' ? {type: 'float', value: v} : typeof v === 'object' ? v : {type: 'string', value: String(v)}; // an object is a raw nbt value
          const named = nbt.writeUncompressed({type: 'compound', name: '', value}, 'big');
          const tag = Buffer.concat([named.subarray(0, 1), named.subarray(3)]); // drop the root name (bytes 1-2)
          c.writeRaw(Buffer.concat([varint(0x44), str(id), varint(tag.length), tag]));
        },
        command: (text) => c.write('chat_command', {command: text.replace(/^\//, '')}),
        sneak: (on) => c.write('player_input', {inputs: {shift: on}}),
        swap: () => c.write('block_dig', {status: 6, location: {x: 0, y: 0, z: 0}, face: 0, sequence: 0}), // swap hands (F)
        useItem: (hand = 'main_hand', rotation = {x: 0, y: 0}) => c.write('use_item', {hand, sequence: 0, rotation}), // right click with the item in hand
        leftClick: () => c.write('arm_animation', {hand: 'main_hand'}), // swing at air: Paper reports LEFT_CLICK_AIR
        useBlock: (x, y, z, hand = 'main_hand') => c.write('block_place', {hand, location: {x, y, z}, direction: 1, cursorX: 0.5, cursorY: 1, cursorZ: 0.5, insideBlock: false, worldBorderHit: false, sequence: 1}),
        closeWindow: (id) => c.write('close_window', {windowId: id}),
        look: (yaw, pitch) => c.write('look', {yaw, pitch, flags: {onGround: true, hasHorizontalCollision: false}}),
        end: () => new Promise((r) => { c.once('end', r); c.end(); }),
      });
    });
  });
}
module.exports = {connect};
