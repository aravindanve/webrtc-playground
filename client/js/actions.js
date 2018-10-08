// media
const audioEnabledSelect = document.querySelector('#audioEnabledSelect');
const videoQualitySelect = document.querySelector('#videoQualitySelect');
const audioDeviceSelect = document.querySelector('#audioDeviceSelect');
const videoDeviceSelect = document.querySelector('#videoDeviceSelect');

const getPublisherConstraints = () => {
  const audioEnabled = audioEnabledSelect.value === 'true';
  const audioDeviceId = audioEnabled && audioDeviceSelect.value
    ? audioDeviceSelect.value : undefined;
  const audio = audioDeviceId
    ? { deviceId: audioDeviceId } : audioEnabled;
  const videoEnabled = videoQualitySelect.value !== 'false';
  const videoDeviceId = videoEnabled && videoDeviceSelect.value
    ? videoDeviceSelect.value : undefined;

  let video;
  if (videoEnabled) {
    const videoQualityParts = videoQualitySelect.value.split(/\:/g);
    const type = videoQualityParts[0];

    if (type === 'true') {
      video = videoDeviceId
        ? { deviceId: videoDeviceId } : true;

    } else {
      const dim = videoQualityParts[1].split(/x/gi);

      video = {
        ...videoDeviceId && { deviceId: videoDeviceId },
        width: { [type]: +dim[0] },
        height: { [type]: +dim[1] },
      };
    }
  }

  return { audio, video };
};

const mediaStartButton = document.querySelector('#mediaStartButton');
const mediaStopButton = document.querySelector('#mediaStopButton');
const localVideoElement = document.querySelector('video#local');

let publisher = createPublisher();

const playLocalStream = (stream, status = 'ready') => {
  const srcObject = stream.getSrcObject();

  if (!localVideoElement.srcObject ||
      localVideoElement.srcObject.id !== srcObject.id) {
    localVideoElement.srcObject = srcObject;
  }
  localVideoElement.setAttribute('data-status', status);
};

const stopLocalStream = stream => {
  const srcObject = stream.getSrcObject();

  if (localVideoElement.srcObject &&
      localVideoElement.srcObject.id === srcObject.id) {
    localVideoElement.srcObject = undefined;
    localVideoElement.setAttribute('data-status', 'off');
  }
};

const enableMediaStartControls = () => {
  audioEnabledSelect.disabled = false;
  videoQualitySelect.disabled = false;
  audioDeviceSelect.disabled = false;
  videoDeviceSelect.disabled = false;
  mediaStartButton.disabled = false;
};

const disableMediaStartControls = () => {
  audioEnabledSelect.disabled = true;
  videoQualitySelect.disabled = true;
  audioDeviceSelect.disabled = true;
  videoDeviceSelect.disabled = true;
  mediaStartButton.disabled = true;
};

const enableMediaStopControls = () => {
  mediaStopButton.disabled = false;
};

const disableMediaStopControls = () => {
  mediaStopButton.disabled = true;
};

const handleMediaStartClick = () => {
  disableMediaStartControls();
  publisher.setConstraints(getPublisherConstraints());
  publisher.getStream()
    .catch(err => {
      console.error('ERROR', err);
      enableMediaStartControls();
    });
};

const handleMediaStopClick = () => {
  disableMediaStopControls();
  publisher.clearStream()
    .catch(err => {
      console.error('ERROR', err);
      enableMediaStopControls();
    });
};

const handleStreamCreated = stream => {
  disableMediaStartControls();
  enableMediaStopControls();
  playLocalStream(stream, 'ready');
};

const handleStreamDestroyed = stream => {
  enableMediaStartControls();
  disableMediaStopControls();
  stopLocalStream(stream);
};

disableMediaStopControls();
publisher.on('stream_created', handleStreamCreated);
publisher.on('stream_destroyed', handleStreamDestroyed);
mediaStartButton.onclick = handleMediaStartClick;
mediaStopButton.onclick = handleMediaStopClick;

// session
const sessionSignalingServerUrlInput = document.querySelector('#sessionSignalingServerUrlInput');
const sessionIdInput = document.querySelector('#sessionIdInput');
const sessionUsernameInput = document.querySelector('#sessionUsernameInput');
const sessionConnectButton = document.querySelector('#sessionConnectButton');
const sessionDisconnectButton = document.querySelector('#sessionDisconnectButton');
const myPeerIdSpan = document.querySelector('#myPeerIdSpan');

let session;

const autoSetSessionSignalingServerUrlInput = () =>
  sessionSignalingServerUrlInput.value = window.location.href;

const enableSessionConnectControls = () => {
  sessionSignalingServerUrlInput.disabled = false;
  sessionIdInput.disabled = false;
  sessionUsernameInput.disabled = false;
  sessionConnectButton.disabled = false;
};

const disableSessionConnectControls = () => {
  sessionSignalingServerUrlInput.disabled = true;
  sessionIdInput.disabled = true;
  sessionUsernameInput.disabled = true;
  sessionConnectButton.disabled = true;
};

const enableSessionDisconnectControls = () => {
  sessionDisconnectButton.disabled = false;
};

const disableSessionDisconnectControls = () => {
  sessionDisconnectButton.disabled = true;
};

const handleStreamEvent = e => {
  const { stream } = e;

  playRemoteStream(stream);
};

const handleSessionConnectClick = () => {
  disableSessionConnectControls();
  session = createSession(sessionIdInput.value, {
    signalingServerUrl: sessionSignalingServerUrlInput.value,
    username: sessionUsernameInput.value
  });

  session.on('peers', e => console.log('peers', e));
  session.on('peer_joined', e => console.log('peer_joined', e));
  session.on('peer_left', e => console.log('peer_left', e));

  session.on('stream', handleStreamEvent);

  session.connect()
    .then(() => {
      myPeerIdSpan.innerHTML = session.myPeerId;
      enableSessionDisconnectControls();
      enablePeerPublishControls();
      disablePeerUnpublishControls();
    })
    .catch(err => {
      console.error('ERROR', err);
      enableSessionConnectControls();
    });
};

const handleSessionDisconnectClick = () => {
  disableSessionDisconnectControls();
  session.disconnect()
    .then(() => {
      session = undefined;
      enableSessionConnectControls();
      disablePeerPublishControls();
      disablePeerUnpublishControls();
    })
    .catch(err => {
      console.error('ERROR', err);
      enableSessionDisconnectControls();
    });
};

disableSessionDisconnectControls();
autoSetSessionSignalingServerUrlInput();
sessionConnectButton.onclick = handleSessionConnectClick;
sessionDisconnectButton.onclick = handleSessionDisconnectClick;

// peers
const peerPublishButton = document.querySelector('#peerPublishButton');
const peerUnpublishButton = document.querySelector('#peerUnpublishButton');
const videoElements = document.querySelectorAll('video.remote');

const playRemoteStream = stream => {
  let videoElement;
  for (let i = 0; i < videoElements.length; i++) {
    if (videoElements[i].getAttribute('data-streaming') !== 'true') {
      videoElement = videoElements[i];
      break;
    }
  }

  if (!videoElement) {
    console.error('No slots left to play stream', stream);
    return;
  }

  videoElement.setAttribute('data-streaming', 'true');
  videoElement.srcObject = stream.getSrcObject();
};

const enablePeerPublishControls = () => {
  peerPublishButton.disabled = false;
};

const disablePeerPublishControls = () => {
  peerPublishButton.disabled = true;
};

const enablePeerUnpublishControls = () => {
  peerUnpublishButton.disabled = false;
};

const disablePeerUnpublishControls = () => {
  peerUnpublishButton.disabled = true;
};

const handlePeerPublishClick = () => {
  disablePeerPublishControls();
  session.publish(publisher)
    .catch(err => {
      console.error('ERROR', err);
      enablePeerPublishControls();
    })
};

const handlePeerUnpublishClick = () => {
  disablePeerUnpublishControls();

  session.unpublish(publisher)
    .catch(err => {
      console.error('ERROR', err);
      enablePeerUnpublishControls();
    });
};

const handleStreamPublished = stream => {
  disablePeerPublishControls();
  playLocalStream(stream, 'on');
  enablePeerUnpublishControls();
};

const handleStreamUnpublished = stream => {
  disablePeerUnpublishControls();
  playLocalStream(stream, 'ready');
  enablePeerPublishControls();
};

disablePeerPublishControls();
disablePeerUnpublishControls();
publisher.on('stream_published', handleStreamPublished);
publisher.on('stream_unpublished', handleStreamUnpublished);
peerPublishButton.onclick = handlePeerPublishClick;
peerUnpublishButton.onclick = handlePeerUnpublishClick;
