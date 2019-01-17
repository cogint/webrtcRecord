// Inspired by webrtcNotify & adapter.js by Philipp Hancke

const inject = '(' + function () {
  const RECORDERINTERVAL = 1000; // Length of each recorder chunk
  const MINRECORDLENGTH = 2000; // The minimum length in ms for a recording
  let recorders = [] // holder for recorder objects

  // Class for handling recording functions
  class Recorder {
    constructor (peerConnectionId, side) {
      this.stream = new MediaStream()
      this.audioOnly = true
      this.peerConnectionId = peerConnectionId
      this.side = side || 'unknown'
      this.blobs = []
      this.state = 'ready'
      this.options = { mimeType: 'audio/webm' }
      this.recInterval = RECORDERINTERVAL || 1000
      this.mediaRecorder = null
      this.startTime = null
      this.stopTime = null

      this.optionsCheck(this.options)
    }

    optionsCheck (options) {
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        console.error(`${options.mimeType} is not Supported`)
        this.state = 'error'
      } else {
        this.state = 'ready'
      }
    }

    setStream (stream) {
      if (this.audioOnly) {
        stream.getAudioTracks().forEach(track => {
          this.stream.addTrack(track);
        })
      } else {
        this.stream = stream;
      }
      this.state = 'ready';
    }

    addTrack (track) {
      if (this.audioOnly && track.kind === 'audio') {
        this.stream.addTrack(track);
      }
      this.state = 'ready';
    }

    record () {
      try {
        if (this.state === 'recording') {
          this.mediaRecorder.stop();
        }
        this.mediaRecorder = new MediaRecorder(this.stream, this.options);

        this.mediaRecorder.ondataavailable = function (event) {
          if (event.data && event.data.size > 0) {
            this.blobs.push(event.data);
          }
          console.log(this.side + ' ' + this.stream.id + ': chunk number ' + this.blobs.length + ' is ' + event.data.size + ' bytes ')
        }.bind(this);

        this.mediaRecorder.start(this.recInterval)
        if (this.startTime === null) {
          this.startTime = new Date();
        }
        console.log('recorder started: ' + this.side + '-' + this.peerConnectionId);

        this.state = 'recording'
      } catch (err) {
        console.error('Exception while creating MediaRecorder:', err)
      }
    }

    getUrl () {
      const combinedBlob = new Blob(this.blobs, { type: 'audio/webm' })
      return window.URL.createObjectURL(combinedBlob)
    }

    stop () {
      if (this.state === 'recording') {
        this.mediaRecorder.stop();
        this.stopTime = new Date();
        this.state = 'stopped';
      } else {
        console.error('No recording to stop on ' + this.side + '-' + this.peerConnectionId)
      }
    }

    ifExists (pcId, side) {
      let exists = (pcId === this.peerConnectionId) && (side === this.side);
      console.log(side + ' ' + pcId + ' exists: ' + exists);
      return exists
    }
  }

  function addRecorder (id, stream) {
    console.log('addTrack: adding recorder for ' + 'local_' + id)
    let r = new Recorder(id, 'local');
    recorders.push(r);
    r.setStream(stream);
    r.record();
  }

  // Get remote streams/tracks

  const origAddStream = window.RTCPeerConnection.prototype.addStream
  window.RTCPeerConnection.prototype.addStream = function (stream) {
    console.log('addStream shimmed', stream);
    let thisId = this.id;

    if (recorders.length > 0) {
      recorders.forEach(recorder => {
        if (recorder.ifExists(thisId, 'local')) {
          console.log('addStream: recorder already exists on peerConnection local_' + thisId);
          recorder.stop();
          recorder.setStream(stream);
          // r.record();
        } else {
          addRecorder(thisId, stream);
        }
      })
    } else {
      addRecorder(thisId, stream);
    }

    this.addEventListener('connectionstatechange', (e) => {
      console.log('PeerConnection ' + this.id + ' changed to', this.connectionState)
    });

    return origAddStream.apply(this, arguments);
  }

  const origAddTrack = window.RTCPeerConnection.prototype.addTrack
  window.RTCPeerConnection.prototype.addTrack = function (track, stream) {
    console.log('addTrack shimmed', track, stream)
    let thisId = this.id

    if (recorders.length > 0) {
      recorders.forEach(recorder => {
        if (recorder.ifExists(thisId, 'local')) {
          console.log('addTrack: recorder already exists on peerConnection ' + thisId)
          recorder.stop()
          recorder.addTrack(track)
          // recorder.record()
        } else {
          addRecorder(thisId, stream);
        }
      })
    } else {
      addRecorder(thisId, stream);
    }

    this.addEventListener('connectionstatechange', (e) => {
      let pcId = this.id;
      console.log('PeerConnection ' + pcId + ' changed to', this.connectionState)
      if (this.connectionState === 'connected') {
        recorders
          .filter(r => r.peerConnectionId === pcId)
          .forEach(r => r.record());
      }
    });

    return origAddTrack.apply(this, arguments)
  }

  // Get remote streams/tracks
  const origSRD = RTCPeerConnection.prototype.setRemoteDescription
  RTCPeerConnection.prototype.setRemoteDescription = function () {
    this.addEventListener('track', (e) => {
      console.log('setRemoteDescription track event shimmed', e.track)
      let r = new Recorder(this.id, 'remote');
      recorders.push(r)
      r.addTrack(e.track);
      if (this.connectionState === 'connected') {
        r.record();
      }
    })

    this.addEventListener('stream', (e) => {
      console.log('setRemoteDescription stream event shimmed', e.stream)
      let r = new Recorder(this.id, 'remote');
      recorders.push(r)
      r.setStream(e.stream)
      if (this.connectionState === 'connected') {
        r.record();
      }
    })

    // ToDo: start recording if the peerConnection is already 'connected'if (this.connectionState === 'connected') {
    return origSRD.apply(this, arguments)
  }

  // Close & transfer functions
  function transfer (recorder) {
  // ToDo: verify this works
    if (recorder.blobs.length === 0) {
      console.log(recorder.side + '-' + recorder.peerConnectionId + ': recording was empty')
    } else if (recorder.blobs.length * recorder.RECORDERINTERVAL < MINRECORDLENGTH) {
      console.log(recorder.side + '-' + recorder.peerConnectionId + ': recording too short');
    } else {
      let filename = 'recorder_' + recorder.side + '_' + recorder.startTime.toJSON() + '.webm'
      window.postMessage(['webrtcRecord', window.location.href, 'recording', recorder.getUrl(), filename], '*')
      console.log('transferred')
    }
  }

  const origClose = RTCPeerConnection.prototype.close
  RTCPeerConnection.prototype.close = function () {
    let pcId = this.id;
    console.log('closing PeerConnection ' + pcId)

    // ToDo: make sure this all works synchronously
    // stop and transfer
    async function stopAndTransfer () {
      recorders
        .filter(r => r.peerConnectionId === pcId)
        .forEach(r => {
          r.stop()
          transfer(r)
          r.blobs = []
        });
    }

    stopAndTransfer().then(() => {
      // now remove those recorders
      recorders = recorders
        .filter(r => r.peerConnectionId !== pcId);
    })

    return origClose.apply(this, arguments)
  }

  window.addEventListener('beforeunload', () => {
    recorders.forEach((r) => {
      r.stop();
      transfer(r);
      r.blobs = [];
    })
  })
} +
')();'

let script = document.createElement('script')
script.textContent = inject;
(document.head || document.documentElement).appendChild(script)
script.parentNode.removeChild(script)

let channel = chrome.runtime.connect()
window.addEventListener('message', function (event) {
  // if (typeof(event.data) === 'string') return;
  if (event.data[0] !== 'webrtcRecord') return
  if (event.data[2] === 'recording') {
    let url = event.data[3]
    let filename = event.data[4]
    channel.postMessage(['recording', url, filename])
  } else {
    channel.postMessage(event.data)
  }
})
