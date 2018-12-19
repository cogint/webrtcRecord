const inject = '(' + function () {
    // taken from adapter.js, written by me

    //'addTrack', 'addStream', 'ontrack', 'onaddstream', 'getLocalStreams', 'getRemoteStreams', 'close'
    //illegal: 'ontrack???'
    /*
    ['createOffer', 'createAnswer', 'addStream', 'getLocalStreams', 'getRemoteStreams', 'close',
        'setLocalDescription', 'setRemoteDescription', 'getReceivers'].forEach(function (method) {
        var nativeMethod = webkitRTCPeerConnection.prototype[method];
        webkitRTCPeerConnection.prototype[method] = function () {
            // TODO: serialize arguments
            var self = this;

            this.addEventListener('icecandidate', function () {
                console.log('ice candidate', arguments);
            }, false);



            //part of getReceivers??
            this.addEventListener('track', (track) => {
                console.log("got track: ", track.id)
            }, false);

            window.postMessage(['webrtcRecord', window.location.href, method], '*');
            return nativeMethod.apply(this, arguments);
        };
    });
    */


    let recorders = [];

    class Recorder {

        constructor(stream, remote) {
            this.stream = stream;
            this.remote = "unknown";
            this.blobs = [];
            this.state = "initializing";

            let options = {mimeType: 'audio/webm'};
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.error(`${options.mimeType} is not Supported`);
            }

            try {
                let mediaRecorder = new MediaRecorder(this.stream, options);

                //Look at MediaRecord.requestData() and then aggregate the blobs

                mediaRecorder.ondataavailable = function (event) {
                    if (event.data && event.data.size > 0) {
                        this.blobs.push(event.data);
                    }

                    console.log((this.remote ? "remote " : "local ") + this.stream.id + ": chunk number " + this.blobs.length + " is " + event.data.size + " bytes ");
                }.bind(this);


                mediaRecorder.start(1000);
                this.state = "started";
                console.log("recorder started");

            } catch (e) {
                console.error('Exception while creating MediaRecorder:', e);
            }
        }

    }


    const origSRD = RTCPeerConnection.prototype.setRemoteDescription;
    RTCPeerConnection.prototype.setRemoteDescription = function() {
        this.addEventListener('track', (e) => {
            if (e.track.kind === "audio") {
                let recordStream = new MediaStream();
                recordStream.addTrack(e.track);
                let r = new Recorder(recordStream, "remote");
                recorders.push(r);
                console.log('ONTRACK POLY', e.track);
            }
        });
        return origSRD.apply(this, arguments);
    };


    const origAddStream = window.RTCPeerConnection.prototype.addStream;
    window.RTCPeerConnection.prototype.addStream = function (stream) {
        console.log("stream shimmed", stream);
        let recordStream = new MediaStream();
        let remote = false;
        stream.getAudioTracks().forEach(track => {
            recordStream.addTrack(track);
            remote = track.remote;  //ToDo: this should always be local?
        });
        //record(recordStream);
        //Assumes all tracks are the same (remote vs. local)
        let r = new Recorder(recordStream, remote);
        recorders.push(r);

        return origAddStream.apply(this, arguments);
    };


    const origAddTrack = window.RTCPeerConnection.prototype.addTrack;
    if (origAddTrack) {
        window.RTCPeerConnection.prototype.addTrack = function (track, stream) {
            console.log("track shimmed", track, stream);
            if (track.kind === "audio") {
                let recordStream = new MediaStream();
                recordStream.addTrack(track);
                //record(recordStream);
                let r = new Recorder(recordStream, track.remote);
                recorders.push(r);
            }

            return origAddTrack.apply(this, arguments);
        };
    }
    else {
        console.log("no addTrack")
    }

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
    //moved to class
    function record(stream) {
        let recordedBlobs = [];

        let options = {mimeType: 'audio/webm'};
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.error(`${options.mimeType} is not Supported`);
        }
        try {
            let mediaRecorder = new MediaRecorder(stream, options);

            //ToDo: redo the logic here to handle switching streams
            //Look at MediaRecord.requestData() and then aggregate the blobs

            mediaRecorder.ondataavailable = function (e) {
                if (event.data && event.data.size > 0) {
                    recordedBlobs.push(event.data);
                }
                console.log(recordedBlobs.length + ":" + e.data.size + "B chunk");
            };

            mediaRecorder.start(1000);
            console.log("recorder started");

        } catch (e) {
            console.error('Exception while creating MediaRecorder:', e);
        }

    }
    */


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

    function transfer(blob, filename) {
        console.log("transferring");
        const url = window.URL.createObjectURL(blob);
        window.postMessage(['webrtcRecord', window.location.href, 'recording', url, filename], '*');
        //window.URL.revokeObjectURL(blob);
    }

    //ToDo: Stop & transfer recording when the peerConnection is closed

    window.addEventListener("beforeunload", function (event) {
        //ToDo: adjust the minimum recording length

        recorders.forEach((recorder) => {
            if (recorder.blobs.length < 3) {
                console.log("No recording or too short");
                return;
            }

            const combinedBlob = new Blob(recorder.blobs, {type: 'audio/webm'});
            let filename = "recorder_" + (recorder.remote ? "remote " : "local ") + (new Date()).toJSON() + ".webm";
            window.postMessage(['webrtcRecord', window.location.href, 'saving', filename, recorder.remote], '*');
            transfer(combinedBlob, filename);
        });

    });

} + ')();';

let script = document.createElement('script');
script.textContent = inject;
(document.head || document.documentElement).appendChild(script);
script.parentNode.removeChild(script);

let channel = chrome.runtime.connect();
window.addEventListener('message', function (event) {
    //if (typeof(event.data) === 'string') return;
    if (event.data[0] !== 'webrtcRecord') return;
    if (event.data[2] === 'recording') {
        let url = event.data[3];
        let filename = event.data[4];
        channel.postMessage(['recording', url, filename]);
    }
    else {
        channel.postMessage(event.data);
    }
});