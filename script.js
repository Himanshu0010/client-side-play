const connectButton = document.getElementById('connectButton');
const conversationLog = document.getElementById('conversationLog');

let socket;
let mediaRecorder;
let audioChunks = [];
let initialAudioStreamReceived = false;
let isRecording = false;
const MIN_CHUNK_SIZE = 16000;

connectButton.addEventListener('click', connectToAgent);

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function connectToAgent() {
    const socketUrl = 'ws://localhost:3000';
    socket = new WebSocket(socketUrl);

    socket.onopen = () => {
        console.log('WebSocket connection established');
        startRecording();

        if (!initialAudioStreamReceived) {
            console.log('Waiting for initial audio stream...');
        }
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    socket.onclose = () => {
        console.log('WebSocket connection closed');
    };
}

function startRecording() {
    const constraints = {
        audio: {
            channelCount: 1, // Ensure mono audio
            sampleRate: 16000 // Attempt to set sample rate to 16000Hz
        },
        video: false
    };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm; codecs=opus' }); // WebM format with Opus codec
            mediaRecorder.ondataavailable = handleAudioData;
            mediaRecorder.start(1000); // Collect data in chunks of 1000ms
        })
        .catch(error => console.error('Error accessing microphone:', error));
}

function handleAudioData(event) {
    if (event.data.size > 0) {
        event.data.arrayBuffer().then(buffer => {
            audioContext.decodeAudioData(buffer, function(decodedData) {
                // Assuming the decoded data is at the right sample rate and is mono
                // If not, you might need to resample here using an AudioContext
                let samples = decodedData.getChannelData(0); // Get PCM data from the first channel
                
                // Convert Float32Array data to Int16Array
                let pcmData = new Int16Array(samples.map(n => n * 32767));
                
                const muLawData = encodeToMuLaw(pcmData);
                const base64Data = btoa(String.fromCharCode.apply(null, new Uint8Array(muLawData.buffer)));
                socket.send(JSON.stringify({ "type": "audioIn", "data": base64Data }));
            });
        });
    }
}

function encodeToMuLaw(pcmData) {
    const mu = 255;
    const muLawData = new Uint8Array(pcmData.length / 2);
    for (let i = 0; i < pcmData.length; i++) {
        const s = Math.min(Math.max(-32768, pcmData[i]), 32767);
        const sign = s < 0 ? 0x80 : 0x00;
        const abs = Math.abs(s);
        const exponent = Math.floor(Math.log(abs / 32635 + 1) / Math.log(1 + 1 / 255));
        const mantissa = (abs >> (exponent + 1)) & 0x0f;
        muLawData[i] = ~(sign | (exponent << 4) | mantissa);
    }
    return muLawData;
}

let audioStreamTimeout = null;
let accumulatedAudioChunks = [];

let accumulatedAudioData = new Uint8Array();

let audioQueue = [];
let isPlayingAudio = false;

const MIN_AUDIO_SIZE_THRESHOLD = 16000;

function handleMessage(message) {
    switch (message.type) {
        case 'voiceActivityStart':
            console.log('Voice activity started');
            break;
        case 'voiceActivityEnd':
            console.log('Voice activity ended');
            break;
        case 'audioStream':
            const audioDataChunk = Uint8Array.from(atob(message.data), c => c.charCodeAt(0));
            const newAccumulatedAudioData = new Uint8Array(accumulatedAudioData.length + audioDataChunk.length);
            newAccumulatedAudioData.set(accumulatedAudioData);
            newAccumulatedAudioData.set(audioDataChunk, accumulatedAudioData.length);
            accumulatedAudioData = newAccumulatedAudioData;

            if (accumulatedAudioData.length >= MIN_AUDIO_SIZE_THRESHOLD) {
                audioQueue.push(accumulatedAudioData);
                accumulatedAudioData = new Uint8Array();  // Reset for next audio stream
                playNextInQueue();
            }
            break; 
        case 'newAudioStream':
            console.log('New audio stream started');
            break;
            case 'error':
                console.error(`Error ${message.code}: ${message.message}`);
                handleServerError(message.code, message.message);
                break;
        default:
            console.log('Unhandled message:', message);
    }
}

function handleServerError(code, message) {
    const errorMessageDisplay = document.getElementById('error-message-display');
    errorMessageDisplay.innerHTML = `Error ${code}: ${message}`;
    errorMessageDisplay.style.display = 'block';  // Make sure this element is visible

    console.error(`Server Error - Code ${code}: ${message}`);
}

function playNextInQueue() {
    if (!isPlayingAudio && audioQueue.length > 0) {
        const audioData = audioQueue.shift();
        playAudioData(audioData);
    }
}

function playAudioData(audioData) {
    isPlayingAudio = true;
    audioContext.decodeAudioData(audioData.buffer).then((decodedData) => {
        const source = audioContext.createBufferSource();
        source.buffer = decodedData;
        source.connect(audioContext.destination);
        source.start();

        source.onended = function() {
            isPlayingAudio = false;
            playNextInQueue();
        };
    }).catch((error) => {
        console.error('Error with decoding audio data', error);
        isPlayingAudio = false;
        playNextInQueue();
    });
}
