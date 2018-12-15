const inject = '(' + function () {
    // taken from adapter.js, written by me

    ['createOffer', 'createAnswer',
        'setLocalDescription', 'setRemoteDescription'].forEach(function (method) {
        var nativeMethod = webkitRTCPeerConnection.prototype[method];
        webkitRTCPeerConnection.prototype[method] = function () {
            // TODO: serialize arguments
            var self = this;
            this.addEventListener('icecandidate', function () {
                //console.log('ice candidate', arguments);
            }, false);
            window.postMessage(['webrtcRecord', window.location.href, method], '*');
            return nativeMethod.apply(this, arguments);
        };
    });

    let recordedBlobs = [];

    /*const gumOverride = function () {
        window.postMessage(['WebRTCSnoop', window.location.href, 'getUserMedia'], '*');
        return navigator.getUserMedia.apply(this, arguments)
    };

    navigator.getUserMedia = navigator.mediaDevices.getUserMedia = gumOverride;
  */
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = function (cs) {
        console.log("navigator.mediaDevices.getUserMedia shimmed");
        return origGetUserMedia(cs).then(stream => {
            window.postMessage(['webrtcRecord', window.location.href, 'getUserMedia'], '*');
            record(stream, postMessage);
            return stream;
        }, e => Promise.reject(e))
    };


    function record(stream, postMessage) {
        let count = 0;

        let options = {mimeType: 'audio/webm'}; //'audio/wav'
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.error(`${options.mimeType} is not Supported`);
        }
        try {
            let mediaRecorder = new MediaRecorder(stream, options);

            mediaRecorder.ondataavailable = function (e) {
                if (event.data && event.data.size > 0) {
                    recordedBlobs.push(event.data);
                }
                console.log(recordedBlobs.length + ":" + e.data.size + "B chunk");
            };

            //ToDo: Remove - this never fires
            mediaRecorder.onstop = (event) => {
                audio.controls = true;
                var blob = new Blob(chunks, {'type': 'audio/webm'});
                chunks = [];
                url = URL.createObjectURL(blob);
                console.log("recorder stopped");
                console.log(url);
                window.postMessage(['webrtcRecord', window.location.href, 'recording', url, 1], '*');
            };

            mediaRecorder.start(1000);
            console.log("recorder started");

        } catch (e) {
            console.error('Exception while creating MediaRecorder:', e);
        }

    }

    window.addEventListener("beforeunload", function(event) {
        console.log("window unloading - sending recording");
        const combinedBlob = new Blob(recordedBlobs, {type: 'audio/webm'});
        const url = window.URL.createObjectURL(combinedBlob);
        window.postMessage(['webrtcRecord', window.location.href, 'recording', url], '*');
    });

} + ')();';

let script = document.createElement('script');
script.textContent = inject;
(document.head || document.documentElement).appendChild(script);
script.parentNode.removeChild(script);

let recordingUrl;
let channel = chrome.runtime.connect();
window.addEventListener('message', function (event) {
    //if (typeof(event.data) === 'string') return;
    if (event.data[0] !== 'webrtcRecord') return;
    if (event.data[2] === 'recording'){
        recordingUrl = event.data[3];
        channel.postMessage(['recording', window.location.href, recordingUrl]);
    }
    else {
        channel.postMessage(event.data);
    }
});
