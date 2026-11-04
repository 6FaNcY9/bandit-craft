// Minimal protocol client for the BotUi stand. NODE_PATH must point at the mcbots node_modules.
const mc = require('minecraft-protocol');
const nbt = require('prismarine-nbt');

const varint = (n) => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return Buffer.from(o); };
const str = (s) => Buffer.concat([varint(Buffer.byteLength(s)), Buffer.from(s)]);

function connect(username, port = 25599) {
  return new Promise((resolve, reject) => {
    const c = mc.createClient({host: '127.0.0.1', port, username, auth: 'offline', version: '26.1'});
    const dialogs = [], maps = [];
    c.on('error', reject);
    c.on('position', (p) => c.write('teleport_confirm', {teleportId: p.teleportId})); // else the server ignores our movement
    c.on('packet', (data, meta) => {
      if (meta.name === 'show_dialog') dialogs.push(nbt.simplify(data.dialog));
      else if (meta.name === 'map') maps.push(data);
    });
    c.once('login', () => {
      c.write('player_loaded', {}); // the server ignores movement until the client reports it has loaded
      resolve({
        dialogs, maps,
        // The dialog click packet is written raw: minecraft-data's anonymous-NBT shape makes Paper drop the connection.
        click(id, data) {
          const value = {};
          for (const [k, v] of Object.entries(data)) value[k] = typeof v === 'number' ? {type: 'float', value: v} : {type: 'string', value: String(v)};
          const named = nbt.writeUncompressed({type: 'compound', name: '', value}, 'big');
          const tag = Buffer.concat([named.subarray(0, 1), named.subarray(3)]); // drop the root name (bytes 1-2)
          c.writeRaw(Buffer.concat([varint(0x44), str(id), varint(tag.length), tag]));
        },
        command: (text) => c.write('chat_command', {command: text.replace(/^\//, '')}),
        look: (yaw, pitch) => c.write('look', {yaw, pitch, flags: {onGround: true, hasHorizontalCollision: false}}),
        end: () => new Promise((r) => { c.once('end', r); c.end(); }),
      });
    });
  });
}
module.exports = {connect};
