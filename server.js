const fs = require('fs');
const createServer = require('https').createServer;
const createIO = require('socket.io');
const connect = require('connect');
const serveStatic = require('serve-static');

const host = process.env.HOST || 'localhost';
const port = process.env.PORT || 9000;

const serverOptions = {
  key: fs.readFileSync('tls/key.pem'),
  cert: fs.readFileSync('tls/crt.pem')
};

const ioOptions = {
  serveClient: false
};

const app = connect().use('/', serveStatic('client/'));
const server = createServer(serverOptions, app);
const io = createIO(server, ioOptions);

const NOOP = () => { };
const StunUrl = process.env.STUN_URL && {
  urls: `stun:${process.env.STUN_URL}`
};
const TurnUrl = process.env.TURN_URL && {
  urls: `turn:${process.env.TURN_URL}`,
  username: process.env.TURN_USERNAME,
  credential: process.env.TURN_CREDENTIAL
};

const IceServers = [
  ...StunUrl ? [StunUrl] : [],
  ...TurnUrl ? [TurnUrl] : []
];
const peerMaps = {};

const getPeersInRoom = room =>
  peerMaps[room] ? Array.from(peerMaps[room].values()) : [];

const ts = () => `[${(new Date()).toISOString()}]`;

const onConnect = socket => {
  console.log(`${ts()} peer:${socket.id} connected`);

  socket.on('message', (payload = {}, ack = NOOP) => {
    console.log(`${ts()} peer:${socket.id} message`,
      JSON.stringify({ to: payload.to, type: payload.type }));

    const { to: targetSocketId, ...message } = payload;
    const targetSocket = socket.to(targetSocketId);

    if (!targetSocket) {
      return ack(false);
    }

    message.from = socket.id;
    targetSocket.emit('message', message);

    ack(true);
  });

  socket.on('disconnect', () => {
    console.log(`${ts()} peer:${socket.id} disconnected`);

    if (!socket.room) return;

    const room = socket.room;

    if (peerMaps[room]) {
      // remove peer from map
      peerMaps[room].delete(socket.id);

      // delete room map if empty
      if (!peerMaps[room].size) {
        delete peerMaps[room];
      }
    }

    // leave room
    socket.leave(room);
    socket.room = undefined;

    const info = { peerId: socket.id };

    // emit peer left to room
    io.to(room).emit('peer_left', info);
  });

  const username = socket.handshake.query.username || `user-${socket.id}`;
  const info = { peerId: socket.id, username };

  // emit info
  socket.emit('info', info);

  // emit ice servers
  socket.emit('iceservers', IceServers);

  const room = socket.handshake.query.room || 'default';

  // join room
  socket.join(room);
  socket.room = room;

  // emit peers
  socket.emit('peers', getPeersInRoom(room));

  // add peer to map
  peerMaps[room] = peerMaps[room] || new Map();
  peerMaps[room].set(socket.id, info);

  // emit peer joined to room
  socket.to(room).emit('peer_joined', info);
};

const onListening = () =>
  console.log(`listening on https://${host}:${port}`);

io.on('connect', onConnect);
server.on('listening', onListening);

// listen
server.listen(port, host);
