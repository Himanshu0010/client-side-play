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

function sendAudioData() {
    const audioContext = new AudioContext();
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
                // Append the new chunk to the accumulated audio data
                const audioDataChunk = Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0));
                accumulatedAudioChunks.push(audioDataChunk);
    
                // Clear the previous timeout if it's set
                if (audioStreamTimeout) {
                    clearTimeout(audioStreamTimeout);
                }
    
                // Set a new timeout to process audio after 8 seconds
                audioStreamTimeout = setTimeout(() => {
                    const completeAudioData = concatenateUint8Arrays(accumulatedAudioChunks);
    
                    // Now convert this complete audio data to base64
                    const completeBase64Data = btoa(String.fromCharCode.apply(null, completeAudioData));
    
                    // Attempt to download the full audio file and play it
                    downloadBase64AsFile(completeBase64Data, 'complete_audio.mp3', 'audio/mp3');
                    playAudioData(completeBase64Data, 'audio/mp3');
    
                    // Reset the accumulated chunks and timeout reference
                    accumulatedAudioChunks = [];
                    audioStreamTimeout = null;
                }, 8000); // 8 seconds
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

function playAudioData(base64Data) {
    try {
        // Convert base64 string to a Blob object
        const binaryString = window.atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });

        // Debugging: Log the blob size to see if it seems reasonable
        console.log('Blob size:', blob.size);

        // Create an object URL for the Blob
        const audioURL = URL.createObjectURL(blob);
        console.log('Audio URL:', audioURL); // Check the URL

        // Create a link for downloading the blob as a file
        const downloadLink = document.createElement('a');
        downloadLink.href = audioURL;
        downloadLink.download = 'audio.mp3';
        downloadLink.innerText = 'Download MP3 file';
        downloadLink.style.display = 'block';
        document.body.appendChild(downloadLink);

        // Create an audio element for playback
        const audioElement = new Audio(audioURL);
        audioElement.controls = true;
        document.body.appendChild(audioElement); // Add the controls to the page for testing
        
        audioElement.addEventListener('error', () => {
            const error = audioElement.error;
            console.error('Error code:', error.code, 'Error message:', error.message);
        });
        // Play the audio or log an error when it fails to play
        audioElement.play().catch((e) => console.error('Error playing audio:', e));

        // Remove the object URL when it's no longer needed to free up memory
        audioElement.onended = audioElement.onerror = () => {
            URL.revokeObjectURL(audioURL);
            audioElement.remove(); // Clean up the audio element from the DOM
            downloadLink.remove(); // Clean up the download link from the DOM
        };
    } catch (e) {
        console.error('Error converting base64 data to audio:', e);
    }
}