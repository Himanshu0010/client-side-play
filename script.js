const API_KEY = 'Bearer ak-11a540091f994b2fbbdfac05c61f63b1';
const AGENT_ID = 'My-AI-api-maplw-RLOeYdc7spH-rH_';
const WebSocket = window.WebSocket || window.MozWebSocket;

const connectButton = document.getElementById('connectButton');
const conversationLog = document.getElementById('conversationLog');

let socket;
let mediaRecorder;
let audioChunks = [];

connectButton.addEventListener('click', connectToAgent);

let initialAudioStreamReceived = false;

function connectToAgent() {
    const socketUrl = `wss://api.play.ai/v1/agent-conversation?agentId=${AGENT_ID}`;
    socket = new WebSocket(socketUrl);

    socket.onopen = () => {
        console.log('WebSocket connection established');
        const setupMessage = {
            type: 'setup',
            apiKey: API_KEY,
            enableVad: true,
            outputFormat: 'mp3',
            outputSampleRate: 24000,
        };
        socket.send(JSON.stringify(setupMessage));
        startRecording();
    
        // Check if the initial audio stream has been received
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

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

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

//to check
function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

function downloadBase64AsFile(base64Data, filename, mimeType) {
    const blob = base64ToBlob(base64Data, mimeType);
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    document.body.appendChild(a);
    a.style = 'display: none';
    a.href = url;
    a.download = filename;
    a.click();

    window.URL.revokeObjectURL(url);
    a.remove();
}

let audioStreamTimeout = null;
let accumulatedAudioChunks = [];

function concatenateUint8Arrays(arrays) {
    let totalLength = arrays.reduce((acc, value) => acc + value.length, 0);
    let result = new Uint8Array(totalLength);
    let offset = 0;
    for (let array of arrays) {
        result.set(array, offset);
        offset += array.length;
    }
    return result;
}

let accumulatedAudioData = new Uint8Array();

// Define a minimum size threshold for audio data before attempting to decode
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
                // Convert the base64 string to a Uint8Array and accumulate it
                const audioDataChunk = Uint8Array.from(atob(message.data), c => c.charCodeAt(0));
                const newAccumulatedAudioData = new Uint8Array(accumulatedAudioData.length + audioDataChunk.length);
                newAccumulatedAudioData.set(accumulatedAudioData);
                newAccumulatedAudioData.set(audioDataChunk, accumulatedAudioData.length);
                accumulatedAudioData = newAccumulatedAudioData;
    
                // If the accumulated data size exceeds the threshold, attempt to decode and play
                if (accumulatedAudioData.length >= MIN_AUDIO_SIZE_THRESHOLD) {
                    playAudioData(accumulatedAudioData);
                    accumulatedAudioData = new Uint8Array(); // Reset for next audio stream
                }
                break;  
        case 'newAudioStream':
            console.log('New audio stream started');
            break;
        case 'error':
            console.error(`Error ${message.code}: ${message.message}`);
            break;
        default:
            console.log('Unhandled message:', message);
    }
}

function playAudioData(audioData) {
    // Convert the accumulated Uint8Array to an ArrayBuffer for the decodeAudioData method
    audioContext.decodeAudioData(audioData.buffer).then((decodedData) => {
        const source = audioContext.createBufferSource();
        source.buffer = decodedData;
        source.connect(audioContext.destination);
        source.start();
    }).catch((error) => {
        console.error('Error with decoding audio data', error);
    });
}
