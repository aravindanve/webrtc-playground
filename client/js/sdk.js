const DEBUG = true;

function generateId() {
  const mul = 0x100000000;
  const id = Math.floor(Math.random() * mul).toString(16).toLowerCase()
    + Math.floor(Math.random() * mul).toString(16).toLowerCase()
    + Math.floor(Math.random() * mul).toString(16).toLowerCase()
    + Math.floor(Math.random() * mul).toString(16).toLowerCase();

  return id.length === 32 ? id : '0' + id;
}

class Dispatcher {
  constructor() {
    this.listeners = {};
  }

  on(type, callback) {
    if (type && callback) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(callback);
    }

    return this;
  }

  off(type, callback) {
    if (!type) {
      this.listeners = {};

    } else if (!callback) {
      delete this.listeners[type];

    } else if (type in this.listeners) {
      const stack = this.listeners[type];
      const index = stack.indexOf(callback);

      if (index > -1) {
        stack.splice(index, 1);
      }
    }

    return this;
  }

  emit(type, event) {
    if (type in this.listeners) {
      const stack = this.listeners[type];

      for (let i = 0; i < stack.length; i++) {
        stack[i].call(this, event);
      }
    }

    return this;
  }
}

const SocketEvent = {
  CONNECT: 'connect',
  CONNECT_ERROR: 'connect_error',
  CONNECT_TIMEOUT: 'connect_timeout',
  ERROR: 'error',
  DISCONNECT: 'disconnect',
  RECONNECT: 'reconnect',
  RECONNECT_ATTEMPT: 'reconnect_attempt',
  RECONNECTING: 'reconnecting',
  RECONNECT_ERROR: 'reconnect_error',
  RECONNECT_FAILED: 'reconnect_failed'
};

const SignalEvent = {
  INFO: 'info',
  ICE_SERVERS: 'iceservers',
  PEERS: 'peers',
  MESSAGE: 'message',
  PEER_JOINED: 'peer_joined',
  PEER_LEFT: 'peer_left'
};

const SignalMessageType = {
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'icecandidate',
  SEND_OFFER: 'send_offer'
};

const SessionEvent = {
  ERROR: 'error',
  INFO: 'info',
  PEERS: 'peers',
  PEER_JOINED: 'peer_joined',
  PEER_LEFT: 'peer_left',
  STREAM: 'stream'
};

const defaultOfferOptions = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true,
  voiceActivityDetection: true,
  iceRestart: false
};

const defaultAnswerOptions = {
  voiceActivityDetection: true
};

// TODO: session stream added and removed events
class Session extends Dispatcher {
  constructor(sessionId, options = {}) {
    super();
    this.sessionId = sessionId;
    this.type = 'mesh';
    this.signalingServerUrl = options.signalingServerUrl;
    this.username = options.username;
    this.socket = undefined;
    this.info = undefined;
    this.iceServers = undefined;
    this.peers = undefined;
    this.peerConnections = {};
    this.sessionPublishers = new Map();
  }

  get isConnected() {
    return this.socket && this.socket.connected
      ? true : false;
  }

  async connect() {
    if (this.socket) {
      throw new SessionConnectionError(
        'Connection already in progress');
    }

    return new Promise((resolve, reject) => {
      // connect
      this.socket = io(this.signalingServerUrl, { query: {
        room: this.sessionId,
        username: this.username
      }});

      // attach handlers
      this.socket.on(SignalEvent.INFO, e =>
        this._handleInfo(e));
      this.socket.on(SignalEvent.ICE_SERVERS, e =>
        this._handleIceServers(e));
      this.socket.on(SignalEvent.PEERS, e =>
        this._handlePeers(e));
      this.socket.on(SignalEvent.MESSAGE, e =>
        this._handleMessage(e));
      this.socket.on(SignalEvent.PEER_JOINED, e =>
        this._handlePeerJoined(e));
      this.socket.on(SignalEvent.PEER_LEFT, e =>
        this._handlePeerLeft(e));

      // TODO: check if fired multiple times
      this.socket.on(SocketEvent.CONNECT, () =>
        this._handleConnect(resolve));
      this.socket.on(SocketEvent.CONNECT_ERROR, err =>
        this._handleConnectError(err, resolve, reject));

      this.socket.on(SocketEvent.CONNECT_TIMEOUT, e =>
        console.log('SocketEvent', SocketEvent.CONNECT_TIMEOUT, e));
      this.socket.on(SocketEvent.ERROR, e =>
        console.log('SocketEvent', SocketEvent.ERROR, e));
      this.socket.on(SocketEvent.DISCONNECT, e =>
        console.log('SocketEvent', SocketEvent.DISCONNECT, e));
      this.socket.on(SocketEvent.RECONNECT, e =>
        console.log('SocketEvent', SocketEvent.RECONNECT, e));
      this.socket.on(SocketEvent.RECONNECT_ATTEMPT, e =>
        console.log('SocketEvent', SocketEvent.RECONNECT_ATTEMPT, e));
      this.socket.on(SocketEvent.RECONNECTING, e =>
        console.log('SocketEvent', SocketEvent.RECONNECTING, e));
      this.socket.on(SocketEvent.RECONNECT_ERROR, e =>
        console.log('SocketEvent', SocketEvent.RECONNECT_ERROR, e));
      this.socket.on(SocketEvent.RECONNECT_FAILED, e =>
        console.log('SocketEvent', SocketEvent.RECONNECT_FAILED, e));
    });
  }

  async disconnect() {
    if (!this.socket) return;

    this.off();
    this._destroyAllPeerConnections();
    await this._destroyAllPublishers();
    this.socket.off();
    this.socket.disconnect();
    this.socket = undefined;
    this.info = undefined;
    this.iceServers = undefined;
    this.peers = undefined;
  }

  async publish(publisher) {
    if (this.sessionPublishers.has(publisher.publisherId)) return;

    const publisherId = publisher.publisherId;
    const stream = await publisher.getStream();
    const peerIds = Object.keys(this.peerConnections);

    for (let i = 0; i < peerIds.length; i++) {
      const peerId = peerIds[i];
      const peerConnection = this.peerConnections[peerId];

      peerConnection.addStream(stream);
    }

    this.sessionPublishers.set(publisherId, publisher);
    publisher.sessions.set(this.sessionId, this);
    publisher.emit(PublisherEvent.STREAM_PUBLISHED, stream);

    return stream;
  }

  async unpublish(publisher) {
    if (!this.sessionPublishers.has(publisher.publisherId)) return;

    const publisherId = publisher.publisherId;
    const stream = await publisher.getStream();
    const peerIds = Object.keys(this.peerConnections);

    for (let i = 0; i < peerIds.length; i++) {
      const peerId = peerIds[i];
      const peerConnection = this.peerConnections[peerId];

      peerConnection.removeStream(stream);
    }

    this.sessionPublishers.delete(publisherId);
    publisher.sessions.delete(this.sessionId);
    publisher.emit(PublisherEvent.STREAM_UNPUBLISHED, stream);

    return stream;
  }

  async _destroyAllPublishers() {
    const promises = []
    for (const publisher of this.sessionPublishers.values()) {
      promises.push(this.unpublish(publisher));
    }

    this.sessionPublishers = new Map();
    return Promise.all(promises);
  }

  _handleConnect(resolve) {
    resolve();
  }

  _handleConnectError(err, resolve, reject) {
    reject(err);
  }

  _handleInfo(payload) {
    this.info = payload;
  }

  _handleIceServers(payload) {
    this.iceServers = payload;
  }

  _handlePeers(payload) {
    const peers = payload;

    // TODO: clean up peers
    this.peers = {};
    for (let i = 0; i < peers.length; i++) {
      const peer = peers[i];
      const peerId = peer.peerId;

      this.peers[peerId] = peer;
      this._createOffer(peerId);
    }

    // TODO: emit clone
    this.emit(SessionEvent.PEERS, this.peers);
  }

  _createOffer(peerId, initiator = true) {
    const peerConnection =
      this._getOrCreatePeerConnection(peerId, initiator);

    peerConnection.createOffer(defaultOfferOptions)
      .then(offer => this._handleLocalOffer(peerConnection, offer))
      .catch(err => this.emit(SessionEvent.ERROR, err));
  }

  _handlePeerJoined(payload) {
    const { peerId, username } = payload;

    this.peers = this.peers || {};
    this.peers[peerId] = {
      peerId,
      username
    };

    // TODO: emit clone
    this.emit(SessionEvent.PEER_JOINED, this.peers[peerId]);
  }

  _handlePeerLeft(payload) {
    const { peerId } = payload;

    if (!this.peers && this.peers[peerId]) return;

    this._destroyPeerConnection(peerId);
    delete this.peers[peerId];

    // TODO: emit clone
    this.emit(SessionEvent.PEER_LEFT, { peerId });
  }

  _handleMessage(payload) {
    const { from, type, data } = payload;

    switch (type) {
      case SignalMessageType.OFFER:
        return this._handleRemoteOffer(from, data);

      case SignalMessageType.ANSWER:
        return this._handleRemoteAnswer(from, data);

      case SignalMessageType.ICE_CANDIDATE:
        return this._handleRemoteIceCandidate(from, data);

      case SignalMessageType.SEND_OFFER:
        return this._handleSendOffer(from);
    }
  }

  _handleLocalOffer(peerConnection, offer) {
    // handle only if offer created
    if (!offer) return;

    const { type, sdp } = offer;

    this.socket.emit(SignalEvent.MESSAGE, {
      type: SignalMessageType.OFFER,
      to: peerConnection.peerId,
      data: { type, sdp }
    });
  }

  _handleRemoteOffer(peerId, offer) {
    const peerConnection = this._getOrCreatePeerConnection(peerId);

    peerConnection.acceptOffer(offer, defaultAnswerOptions)
      .then(answer => this._handleLocalAnswer(peerConnection, answer))
      .catch(err => this.emit(SessionEvent.ERROR, err));
  }

  _handleLocalAnswer(peerConnection, answer) {
    // handle only if answer created
    if (!answer) return;

    const { type, sdp } = answer;

    this.socket.emit(SignalEvent.MESSAGE, {
      type: SignalMessageType.ANSWER,
      to: peerConnection.peerId,
      data: { type, sdp }
    });
  }

  _handleRemoteAnswer(peerId, answer) {
    const peerConnection = this._getOrCreatePeerConnection(peerId);

    peerConnection.acceptAnswer(answer)
      .catch(err => this.emit(SessionEvent.ERROR, err));
  }

  _getOrCreatePeerConnection(peerId, initiator = false) {
    if (!this.peerConnections[peerId]) {
      const configuration = {
        iceServers: this.iceServers
      };
      const peerConnection = new PeerConnection(
        peerId, configuration, initiator);

      peerConnection.on(PeerConnectionEvent.STREAM, e =>
        this._handleRemoteStreamEvent(peerConnection, e));

      peerConnection.on(PeerConnectionEvent.ICE_CANDIDATE, e =>
        this._handleLocalIceCandidate(peerConnection, e.candidate));

      peerConnection.on(PeerConnectionEvent.NEGOTIATION_NEEDED, e =>
        this._handleNegotiationNeeded(peerConnection, e));

      // publish found streams
      this._publishFoundStreams(peerConnection);

      this.peerConnections[peerId] = peerConnection;
    }

    return this.peerConnections[peerId];
  }

  _destroyAllPeerConnections() {
    const peerIds = Object.keys(this.peerConnections);

    for (let i = 0; i < peerIds.length; i++) {
      this._destroyPeerConnection(peerIds[i]);
    }
  }

  _destroyPeerConnection(peerId) {
    if (!this.peerConnections[peerId]) return;

    this.peerConnections[peerId].close();
    delete this.peerConnections[peerId];
  }

  _publishFoundStreams(peerConnection) {
    for (const publisher of this.sessionPublishers.values()) {
      if (!publisher.hasStream) continue;

      publisher.getStream()
        .then(stream => peerConnection.addStream(stream))
        .catch(err => this.emit(SessionEvent.ERROR, err));
    }
  }

  _handleRemoteStreamEvent(peerConnection, event) {
    this.emit(SessionEvent.STREAM, event);
  }

  _handleLocalIceCandidate(peerConnection, candidate) {
    this.socket.emit(SignalEvent.MESSAGE, {
      type: SignalMessageType.ICE_CANDIDATE,
      to: peerConnection.peerId,
      data: candidate
    });
  }

  _handleRemoteIceCandidate(peerId, candidate) {
    const peerConnection = this._getOrCreatePeerConnection(peerId);

    if (candidate) {
      peerConnection.addIceCandidate(candidate)
        .catch(err => this.emit(SessionEvent.ERROR, err));
    }
  }

  _handleSendOffer(peerId) {
    this._createOffer(peerId);
  }

  _handleNegotiationNeeded(peerConnection, event) {
    const peerId = peerConnection.peerId;

    // create offer only if initiator
    if (peerConnection.initiator) {
      this._createOffer(peerId);

      return;
    }

    // ask peer to send offer
    this.socket.emit(SignalEvent.MESSAGE, {
      type: SignalMessageType.SEND_OFFER,
      to: peerId
    });
  }
}

class SessionConnectionError extends Error { }

const PeerConnectionEvent = {
  STREAM: 'stream',
  ICE_CANDIDATE: 'icecandidate',
  NEGOTIATION_NEEDED: 'negotiationneeded'
};

const PeerConnectionState = {
  NEW: 'new',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed',
  CLOSED: 'closed'
};

const PeerConnectionSignalingState = {
  STABLE: 'stable',
  HAVE_LOCAL_OFFER: 'have-local-offer',
  HAVE_REMOTE_OFFER: 'have-remote-offer',
  HAVE_LOCAL_PROVISIONAL_ANSWER: 'have-local-pranswer',
  HAVE_REMOTE_PROVISIONAL_ANSWER: 'have-remote-pranswer'
};

// TODO: communicate unpublish to remote peer
class PeerConnection extends Dispatcher {
  constructor(peerId, configuration, initiator = false) {
    super();
    this.peerId = peerId;
    this.initiator = initiator;
    this.connection = new RTCPeerConnection();
    this.stream = undefined;
    this.senders = new Map();
    this.negotiating = false;

    this.connection.setConfiguration(configuration);

    this.connection.ontrack = e =>
      this._handleTrack(e);

    this.connection.onicecandidate = e =>
      this._handleIceCandidate(e);

    this.connection.onnegotiationneeded = e =>
      this._handleNegotiationNeeded(e);
  }

  // TODO: implement state rollback to accept latest offer
  // see http://w3c.github.io/webrtc-pc/#rtcsignalingstate-enum

  async createOffer(offerOptions) {
    console.log('%c BEEP-BOP PeerConnection.createOffer ',
      'background: #06b8e0; color: #273303',
      offerOptions);

    // dont create offer if already negotiating
    // HACK: if messages are lost or errors are thrown,
    // this may result in a deadlock
    if (this.negotiating) {
      console.log(`%c BEEP-BOP already negotiating, skipping... `,
        'background: #86ed4e; color: #273303');

      return;
    }

    this.negotiating = true;

    const offer = await this.connection.createOffer(offerOptions);

    await this.connection.setLocalDescription(offer);

    return offer;
  }

  async acceptOffer(offer, answerOptions) {
    console.log('%c BEEP-BOP PeerConnection.acceptOffer ',
      'background: #f4e542; color: #273303',
      { offer }, answerOptions);

    await this.connection.setRemoteDescription(offer);

    const answer = await this.connection.createAnswer(answerOptions);

    await this.connection.setLocalDescription(answer);

    return answer;
  }

  async acceptAnswer(answer) {
    console.log('%c BEEP-BOP PeerConnection.acceptAnswer ',
      'background: #07bc40; color: #273303',
      { answer });

    this.negotiating = false;

    await this.connection.setRemoteDescription(answer);
  }

  async addIceCandidate(candidate) {
    return this.connection.addIceCandidate(candidate);
  }

  addStream(stream) {
    const mediaStream = stream.mediaStream;
    const tracks = mediaStream.getTracks();
    const publisherId = stream.publisherId;

    let senders;
    if (!this.senders.has(publisherId)) {
      this.senders.set(publisherId, senders = []);

    } else {
      senders = this.senders.get(publisherId);
    }

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];

      senders.push(this.connection
        .addTrack(track, mediaStream));
    }
  }

  removeStream(stream) {
    const publisherId = stream.publisherId;
    const senders = this.senders.get(publisherId);

    if (!senders) return;

    for (let i = 0; i < senders.length; i++) {
      const sender = senders[i];

      this.connection.removeTrack(sender);
    }
  }

  close() {
    this.senders = new Map();
    this.connection.close();
  }

  _handleTrack(event) {
    const track = event.track;
    const stream = this._getOrCreateStream();

    stream.addTrack(track);
  }

  _getOrCreateStream() {
    if (!this.stream) {
      const stream = new Stream(this.peerId);
      const event = new StreamEvent(stream);

      this.stream = stream;
      this.emit(PeerConnectionEvent.STREAM, event);
    }

    return this.stream;
  }

  _handleIceCandidate(event) {
    this.emit(PeerConnectionEvent.ICE_CANDIDATE, event);
  }

  // TODO: handle multiple negotiation needed events while adding tracks
  _handleNegotiationNeeded(event) {
    console.log('%c BEEP-BOP PeerConnection._handleNegotiationNeeded ',
      'background: #cc53d1; color: #273303', event);

    this.emit(PeerConnectionEvent.NEGOTIATION_NEEDED, event);
  }
}

class StreamEvent {
  constructor(stream) {
    this.stream = stream;
  }
}

class Stream {
  constructor(peerId) {
    this.publisherId = undefined;
    this.peerId = peerId;
    this.mediaStream = peerId && new MediaStream();
  }

  addTrack(track) {
    return this.mediaStream.addTrack(track);
  }

  getTracks() {
    return this.mediaStream.getTracks();
  }

  getSrcObject() {
    return this.mediaStream;
  }

  static fromMediaStream(mediaStream, publisherId) {
    const stream = new Stream();

    stream.publisherId = publisherId;
    stream.mediaStream = mediaStream;

    return stream;
  }
}

const defaultMediaConstraints = {
  audio: true,
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 }
  }
};

const PublisherEvent = {
  STREAM_CREATED: 'stream_created',
  STREAM_DESTROYED: 'stream_destroyed',
  STREAM_PUBLISHED: 'stream_published',
  STREAM_UNPUBLISHED: 'stream_unpublished'
};

class Publisher extends Dispatcher {
  constructor(constraints) {
    super();
    this.publisherId = generateId();
    this.stream = undefined;
    this.setConstraints(constraints);
    this.sessions = new Map();
  }

  setConstraints(constraints = {}) {
    this.mediaConstraints = {
      ...defaultMediaConstraints,
      ...constraints
    };

    return this;
  }

  get hasStream() {
    return !!this.stream;
  }

  async getStream() {
    if (!this.stream) {
      const mediaStream = await navigator.mediaDevices
        .getUserMedia(this.mediaConstraints);
      const stream = Stream
        .fromMediaStream(mediaStream, this.publisherId);

      this.stream = stream;
      this.emit(PublisherEvent.STREAM_CREATED, this.stream);
    }

    return this.stream;
  }

  async clearStream() {
    if (!this.stream) return;

    const promises = [];
    for (session of this.sessions.values()) {
      promises.push(this.unpublish(session));
    }

    await Promise.all(promises);

    const stream = this.stream;
    const tracks = stream.getTracks();

    for (let i = 0; i < tracks.length; i++) {
      tracks[i].stop();
    }

    this.stream = undefined;
    this.emit(PublisherEvent.STREAM_DESTROYED, stream);

    return stream;
  }

  async publish(session) {
    if (this.sessions.has(session.sessionId)) return;

    return this.sessions.get(session.sessionId).publish(this);
  }

  async unpublish(session) {
    if (!this.sessions.has(session.sessionId)) return;

    return this.sessions.get(session.sessionId).unpublish(this);
  }
}

class Subscriber { }

function getDevices() {
  return navigator.mediaDevices.enumerateDevices();
}

function createSession(sessionId, options) {
  return new Session(sessionId, options);
}

function createPublisher(options) {
  return new Publisher(options);
}

// debugger
(function classDebugger(debug) {
  if (!debug) return;

  const debugObjects = [
    Dispatcher,
    Session,
    SessionConnectionError,
    PeerConnection,
    StreamEvent,
    Stream,
    Publisher,
    Subscriber,
    getDevices,
    createSession,
    createPublisher
  ];

  const getHue = index =>
    `${Math.floor((index / debugObjects.length) * 256)}`;

  // log function calls
  for (let i = 0; i < debugObjects.length; i++) {
    const debugObject = debugObjects[i];
    const debugObjectName = debugObject.name;
    const debugObjectPrototype = debugObject.prototype;
    const hue = getHue(i);

    for (const prop of Object.getOwnPropertyNames(debugObjectPrototype)) {
      if (typeof debugObjectPrototype[prop] === 'function') {
        const method = debugObjectPrototype[prop];

        debugObjectPrototype[prop] = function () {
          console.log(`%c ${debugObjectName} `,
            `background: hsl(${hue}, 76%, 61%); color: #000`,
            `.${prop}(`, ...arguments, ')');

          return method.apply(this, arguments);
        };
      }
    }
  }

})(DEBUG);
