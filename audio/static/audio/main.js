/* Audio recording and streaming demo by Miguel Grinberg.

   Adapted from https://webaudiodemos.appspot.com/AudioRecorder
   Copyright 2013 Chris Wilson

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

window.AudioContext = window.AudioContext || window.webkitAudioContext;

let audioContext = new AudioContext();
let audioInput = null,
    analyserNode = null,
    realAudioInput = null,
    inputPoint = null,
    scriptNode = null,
    recording = false;
let rafID = null;
let analyserContext = null;
let canvasWidth, canvasHeight;
let socketio = io.connect(location.origin + '/audio', {transports: ['websocket']});

socketio.on('add-wavefile', function(url) {
    // add new recording to page
    audio = document.createElement('p');
    audio.innerHTML = '<audio src="' + url + '" controls>';
    document.getElementById('wavefiles').appendChild(audio);
});

function toggleRecording( e ) {
    if (e.classList.contains('recording')) {
        // stop recording
        e.classList.remove('recording');
        recording = false;
        socketio.emit('end-recording');
        console.log ('stop recording...');
    } else {
        // start recording
        e.classList.add('recording');
        recording = true;
        // retrieve the current sample rate to be used for WAV packaging
        let sampleRate = audioContext.sampleRate;
        socketio.emit('start-recording', {numChannels: 1, bps: 16, fps: parseInt(sampleRate)});
        console.log ('start recording...');

    }
}

function convertToMono( input ) {
    let splitter = audioContext.createChannelSplitter(2);
    let merger = audioContext.createChannelMerger(2);

    input.connect( splitter );
    splitter.connect( merger, 0, 0 );
    splitter.connect( merger, 0, 1 );
    return merger;
}

function cancelAnalyserUpdates() {
    window.cancelAnimationFrame( rafID );
    rafID = null;
}

function updateAnalysers(time) {
    console.log("got analyser...");
    if (!analyserContext) {
        let canvas = document.getElementById('analyser');
        canvasWidth = canvas.width;
        canvasHeight = canvas.height;
        analyserContext = canvas.getContext('2d');
    }

    // analyzer draw code here
    {
        let SPACING = 3;
        let BAR_WIDTH = 1;
        let numBars = Math.round(canvasWidth / SPACING);
        let freqByteData = new Uint8Array(analyserNode.frequencyBinCount);

        analyserNode.getByteFrequencyData(freqByteData); 

        analyserContext.clearRect(0, 0, canvasWidth, canvasHeight);
        analyserContext.fillStyle = '#F6D565';
        analyserContext.lineCap = 'round';
        let multiplier = analyserNode.frequencyBinCount / numBars;
        console.log("analyser start");

        // Draw rectangle for each frequency bin.
        for (let i = 0; i < numBars; ++i) {
            let magnitude = 0;
            let offset = Math.floor( i * multiplier );
            // gotta sum/average the block, or we miss narrow-bandwidth spikes
            for (let j = 0; j< multiplier; j++)
                magnitude += freqByteData[offset + j];
            magnitude = magnitude / multiplier;
            let magnitude2 = freqByteData[i * multiplier];
            analyserContext.fillStyle = "hsl( " + Math.round((i*360)/numBars) + ", 100%, 50%)";
            analyserContext.fillRect(i * SPACING, canvasHeight, BAR_WIDTH, -magnitude);
        }
    }
    
    rafID = window.requestAnimationFrame( updateAnalysers );
}

function toggleMono() {
    if (audioInput != realAudioInput) {
        audioInput.disconnect();
        realAudioInput.disconnect();
        audioInput = realAudioInput;
    } else {
        realAudioInput.disconnect();
        audioInput = convertToMono( realAudioInput );
    }

    audioInput.connect(inputPoint);
}

function gotStream(stream) {
    console.log ('gotStream...');
    // creates a gain node
    inputPoint = audioContext.createGain();

    // Create an AudioNode from the stream.
    // creates an audio node from the microphone incoming stream
    realAudioInput = audioContext.createMediaStreamSource(stream);
    audioInput = realAudioInput;

    audioInput = convertToMono( audioInput );

    // connect the stream to the gain node
    audioInput.connect(inputPoint);

    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    inputPoint.connect( analyserNode );

    let bufferSize = 1024;

    /* From the spec: This value controls how frequently the audioprocess event is
    dispatched and how many sample-frames need to be processed each call.
    Lower values for buffer size will result in a lower (better) latency.
    Higher values will be necessary to avoid audio breakup and glitches */
    scriptNode = (audioContext.createScriptProcessor || audioContext.createJavaScriptNode).call(audioContext, bufferSize, 1, 1);

    scriptNode.onaudioprocess = function (audioEvent) {
        if (recording) {
            console.log ('recording...');
            input = audioEvent.inputBuffer.getChannelData(0);

            // convert float audio data to 16-bit PCM
            let buffer = new ArrayBuffer(input.length * 2)
            let output = new DataView(buffer);
            for (let i = 0, offset = 0; i < input.length; i++, offset += 2) {
                let s = Math.max(-1, Math.min(1, input[i]));
                output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }
            console.log(buffer);
            socketio.emit('write-audio', buffer);
            console.log("sent buffer...")
        }
    }
    // we connect the recorder
    inputPoint.connect(scriptNode);
    scriptNode.connect(audioContext.destination);

    zeroGain = audioContext.createGain();
    zeroGain.gain.value = 0.0;
    inputPoint.connect( zeroGain );
    zeroGain.connect( audioContext.destination );
    updateAnalysers();
}

function initAudio() {
    if (!navigator.mediaDevices.getUserMedia)
        navigator.mediaDevices.getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    if (!navigator.cancelAnimationFrame)
        navigator.cancelAnimationFrame = navigator.webkitCancelAnimationFrame || navigator.mozCancelAnimationFrame;
    if (!navigator.requestAnimationFrame)
        navigator.requestAnimationFrame = navigator.webkitRequestAnimationFrame || navigator.mozRequestAnimationFrame;

    let constraints = { audio: true, video:false }
    navigator.mediaDevices.getUserMedia(constraints)
        .then(gotStream)
        .catch((error) => {
            alert('Error getting audio');
            console.log(error);
          });

    console.log ('audio initialized...');
}

window.addEventListener('load', initAudio );
