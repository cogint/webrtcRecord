// Inspired by webrtcNotify & adapter.js by Philipp Hancke

const inject = '(' + function () {
  let recorders = []; // holder for recorder objects

  // Class for handling recording functions
  class Recorder {
    constructor (peerConnectionId, side) {
      this.stream = new MediaStream();
      this.audioOnly = true;
      this.peerConnectionId = peerConnectionId;
      this.side = side || 'unknown';
      this.blobs = [];
      this.state = 'ready';
      this.options = { mimeType: 'audio/webm' };
      this.recInterval = 1000;
      this.mediaRecorder = null;
      this.startTime = null;
      this.stopTime = null;

      this.optionsCheck(this.options)
    }

    optionsCheck (options) {
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        console.error(`${options.mimeType} is not Supported`);
        this.state = 'error'
      } else {
        this.state = 'ready'
      }
    }

    // Look at MediaRecord.requestData() if recording chunks will be long

    recordStream (stream) {
      if (this.state !== 'ready') return;
      try {
        if (this.audioOnly) {
          stream.getAudioTracks().forEach(track => {
            this.stream.addTrack(track)
          })
        } else {
          this.stream = null
        }

        this.mediaRecorder = new MediaRecorder(stream, this.options);

        this.mediaRecorder.ondataavailable = function (event) {
          if (event.data && event.data.size > 0) {
            this.blobs.push(event.data)
          }
          console.log(this.side + ' ' + this.stream.id + ': chunk number ' + this.blobs.length + ' is ' + event.data.size + ' bytes ')
        }.bind(this);

        this.mediaRecorder.start(this.recInterval);
        this.state = 'recording';
        this.startTime = new Date();
        console.log('recorder started')
      } catch (e) {
        console.error('Exception while creating MediaRecorder:', e)
      }
    }

    // Need to stop and restart when added a track since MediaRecorder doesn't pick that up
    recordTrack (track) {
      this.mediaRecorder.stop();
      this.stream.addTrack(track);
      this.state = 'ready';
      this.recordStream(this.stream);
    }

    getUrl () {
      const combinedBlob = new Blob(this.blobs, { type: 'audio/webm' });
      return window.URL.createObjectURL(combinedBlob);
    }

    stop () {
      if (this.state === 'recording') {
        this.mediaRecorder.stop()
      }
      this.stopTime = new Date();
      this.state = 'stopped';
    }

    ifExists (pcId, side) {
      return (pcId === this.id) && (side === this.side)
    }
  }

  const origSRD = RTCPeerConnection.prototype.setRemoteDescription;
  RTCPeerConnection.prototype.setRemoteDescription = function () {
    this.addEventListener('track', (e) => {
      // ToDo: make sure the track doesn't exist already
      let thisId = e.track.id;

      let trackIds = [];
      // .map better here?
      recorders.forEach(recorder => recorder.stream.getTracks().forEach(track => trackIds.push(track.id)));

      // console.log("check: ", trackIds.find(id => thisId === trackIds));

      console.log('recorders before filter: ' + recorders.length);
      recorders = recorders.filter(recorder => recorder.stream.getTracks()
        .filter(track => track === thisId) === undefined);
      console.log('recorders after filter: ' + recorders.length);

      // ToDo: the first track seems to be bad? maybe overwrite it with the second?
      /*
            if (trackIds.find(id => id === thisId) !== undefined) {
                console.log("this track " + thisId + " already exits");
                recorders = recorders.filter(recorder => recorder.stream.getTracks().filter(track => track === thisId).length > 0);
            }
            */

      let r = new Recorder(this.id, 'remote');
      r.recordTrack(e.track);
      recorders.push(r);
      console.log('setRemoteDescription track event shimmed', e.track)
    });
    return origSRD.apply(this, arguments)
  };

  const origAddStream = window.RTCPeerConnection.prototype.addStream;
  window.RTCPeerConnection.prototype.addStream = function (stream) {
    console.log('addStream shimmed', stream);

    let r = new Recorder(this.id, 'local');
    r.recordStream(stream);
    recorders.push(r);

    return origAddStream.apply(this, arguments)
  };

  const origAddTrack = window.RTCPeerConnection.prototype.addTrack;
  if (origAddTrack) {
    window.RTCPeerConnection.prototype.addTrack = function (track, stream) {
      console.log('addTrack shimmed', track, stream);
      if (track.kind === 'audio') {
        let r = new Recorder(this.id, 'local');
        r.recordTrack(track);
        recorders.push(r)
      }

      return origAddTrack.apply(this, arguments)
    }
  } else {
    console.log('no addTrack')
  }

  const origClose = RTCPeerConnection.prototype.close;
  RTCPeerConnection.prototype.close = function () {
    // console.log("closing PeerConnection " + this.id);
    recorders.forEach((recorder) => {
      if (recorder.peerConnectionID === this.id) {
        recorder.stop();
        transfer(recorder);
      }
    }, this);

    return origClose.apply(this, arguments)
  };

  /*
        //ToDo: save getUserMedia recording before a peerConnection is setup for later
        const enableGUM = false;

        if (enableGUM === true) {
            const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

            //ToDo: this is going to get messy when the user decides to switch devices
            navigator.mediaDevices.getUserMedia = function (cs) {
                console.log("navigator.mediaDevices.getUserMedia shimmed");
                return origGetUserMedia(cs).then(stream => {
                    window.postMessage(['webrtcRecord', window.location.href, 'getUserMedia'], '*');
                    let localRecordStream = new MediaStream();
                    stream.getAudioTracks().forEach(track => localRecordStream.addTrack(track));

                    //Per https://github.com/w3c/mediacapture-record/issues/4, MediaRecorder does record
                    // added tracks yet
                    record(localRecordStream);

                    return stream;
                }, e => Promise.reject(e))
            };
        }
    */

  /*
    function download(blob, filename) {
        console.log("downloading");
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        window.postMessage(['webrtcRecord', window.location.href, 'saved', filename], '*');
        window.URL.revokeObjectURL(blob);
    }
    */

  function transfer (recorder) {
    // ToDo: set a proper minimum length
    if (recorder.blobs.length < 2) {
      console.log('No recording or too short');
      return
    }

    let filename = 'recorder_' + recorder.side + '_' + recorder.startTime.toJSON() + '.webm';
    window.postMessage(['webrtcRecord', window.location.href, 'recording', recorder.getUrl(), filename], '*')
    // window.postMessage(['webrtcRecord', window.location.href, 'saving', filename], '*');
    console.log('transferred');
  }

  // ToDo: Stop & transfer recording when the peerConnection is closed

  window.addEventListener('beforeunload', () => {
    recorders.forEach((recorder) => {
      recorder.stop();
      transfer(recorder);
    })
  })
} + ')();';

let script = document.createElement('script');
script.textContent = inject;
(document.head || document.documentElement).appendChild(script);
script.parentNode.removeChild(script);

let channel = chrome.runtime.connect();
window.addEventListener('message', function (event) {
  // if (typeof(event.data) === 'string') return;
  if (event.data[0] !== 'webrtcRecord') return;
  if (event.data[2] === 'recording') {
    let url = event.data[3];
    let filename = event.data[4];
    channel.postMessage(['recording', url, filename]);
  } else {
    channel.postMessage(event.data);
  }
});
