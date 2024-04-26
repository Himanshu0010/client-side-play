const connectButton = document.getElementById('connectButton');
const conversationLog = document.getElementById('conversationLog');

let socket;
let mediaRecorder;
let audioChunks = [];
let initialAudioStreamReceived = false;

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
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };
            mediaRecorder.start();
            console.log('Recording started');
        })
        .catch((error) => {
            console.error('Error accessing microphone:', error);
        });
}

function stopRecording() {
    mediaRecorder.stop();
    console.log('Recording stopped');
}


function sendAudioData() {
    audioContext.decodeMultipleChunks(audioChunks)
        .then(async (audioBuffer) => {
            const mulawData = encodeToMuLaw(audioBuffer);
            const base64Data = btoa(String.fromCharCode.apply(null, mulawData));
            const audioMessage = {
                type: 'audioIn',
                data: base64Data,
            };
            socket.send(JSON.stringify(audioMessage));
            audioChunks = [];
        })
        .catch((error) => {
            console.error('Error decoding audio chunks:', error);
        });
}

function encodeToMuLaw(audioBuffer) {
    const pcmData = audioBuffer.getChannelData(0);
    const mulawData = new Uint8Array(pcmData.length);

    for (let i = 0; i < pcmData.length; i++) {
        const sample = Math.max(-1, Math.min(1, pcmData[i]));
        const muLawSample = muLawEncode(sample);
        mulawData[i] = muLawSample;
    }

    return mulawData;
}

function muLawEncode(sample) {
    const muLawClip = 32;
    const muLawBias = 0;

    const sign = sample < 0 ? 1 : 0;
    const encoded = Math.floor(Math.log(1 + muLawClip * Math.abs(sample)) / Math.log(1 + muLawClip));
    const muLawSample = (sign << 7) | (encoded << 4) | (encoded << 1) | muLawBias;

    return muLawSample;
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
            stopRecording();
            sendAudioData();
            startRecording();
            break;
        case 'voiceActivityEnd':
            console.log('Voice activity ended');
            stopRecording();
            sendAudioData();
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
    // Example display in the web interface, or perform any other appropriate error handling
    const errorMessageDisplay = document.getElementById('error-message-display');
    errorMessageDisplay.innerHTML = `Error ${code}: ${message}`;
    errorMessageDisplay.style.display = 'block';  // Make sure this element is visible

    // Log to console as well
    console.error(`Server Error - Code ${code}: ${message}`);
}

function playNextInQueue() {
    if (!isPlayingAudio && audioQueue.length > 0) {
        const audioData = audioQueue.shift();  // Take the first item from queue
        playAudioData(audioData);
    }
}

function playAudioData(audioData) {
    isPlayingAudio = true;
    // Convert the accumulated Uint8Array to an ArrayBuffer for the decodeAudioData method
    audioContext.decodeAudioData(audioData.buffer).then((decodedData) => {
        const source = audioContext.createBufferSource();
        source.buffer = decodedData;
        source.connect(audioContext.destination);
        source.start();

        source.onended = function() {
            isPlayingAudio = false;
            playNextInQueue();  // Call to play the next audio in the queue if exists
        };
    }).catch((error) => {
        console.error('Error with decoding audio data', error);
        isPlayingAudio = false;
        playNextInQueue();  // Attempt to play next even if current one fails
    });
}
