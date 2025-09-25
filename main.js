// --- 1. INITIALIZATION & AUDIO SETUP ---
let audioContext;
let masterGain, masterFilter, limiter, convolver, wetGain;
let flutterDelay, flutterFeedback;
let distortion, distortionWetGain; // For Warmth
let bassBus, mainBus; // Busses for routing audio
let lastFile = null;

// --- MUSICAL CONTEXT & STATE ---
let scaleType = 'major';
let harmonicPalette = [];
let sourceAudioBuffer;

// --- TIMERS ---
let generativeLoopInterval;

// --- UPDATED DEFAULT SETTINGS FROM YOUR SCREENSHOT ---
let tempo = 775, reverbLevel = 0.83, textureClarity = 7.09, noteAttackTime = 0.71;
let isPillarModeOn = false, isFlutterOn = true, flutterChance = 0.5;
let masterFilterCutoff = 10600;
let distortionLevel = 0.0;

// Layer Toggles & Densities
let isBassOn = true, isChordOn = true, isLeadOn = true;
let mainSynthProbability = 1.0;
let chordDensity = 0.25;
let leadDensity = 0.66;
let bassDensity = 0.75;

// Solos
let isBassSolo = false, isChordSolo = false, isLeadSolo = false;

// Oscillator types
const OSCILLATOR_TYPES = ['sine', 'triangle', 'sawtooth'];
let leadOscType = 'triangle', mainOscType = 'sawtooth', bassOscType = 'sawtooth';

// DOM Elements
const dropZone = document.getElementById('drop_zone');
const dropZoneText = document.getElementById('drop-zone-text');
const knobsContainer = document.getElementById('knobs-container');
const performanceContainer = document.getElementById('performance-container');
const modeDisplay = document.getElementById('mode-display');
const instructionsEl = document.getElementById('instructions');

const EQUAL_TEMPERAMENT_FREQUENCIES = [ 32.70, 34.65, 36.71, 38.89, 41.20, 43.65, 46.25, 49.00, 51.91, 55.00, 58.27, 61.74, 65.41, 69.30, 73.42, 77.78, 82.41, 87.31, 92.50, 98.00, 103.83, 110.00, 116.54, 123.47, 130.81, 138.59, 146.83, 155.56, 164.81, 174.61, 185.00, 196.00, 207.65, 220.00, 233.08, 246.94, 261.63, 277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.00, 415.30, 440.00, 466.16, 493.88, 523.25, 554.37, 587.33, 622.25, 659.26, 698.46, 739.99, 783.99, 830.61, 880.00, 932.33, 987.77, 1046.50, 1108.73, 1174.66, 1244.51, 1318.51, 1396.91, 1479.98, 1567.98, 1661.22, 1760.00, 1864.66, 1975.53 ];

// --- SETTINGS PERSISTENCE & AUDIO INIT ---
function saveSettings() {
    const settings = {
        tempo, reverbLevel, textureClarity, noteAttackTime, isPillarModeOn,
        isFlutterOn, flutterChance, isBassOn, isChordOn, isLeadOn, masterFilterCutoff,
        mainSynthProbability, chordDensity, leadDensity, bassDensity, distortionLevel,
        leadOscType, mainOscType, bassOscType, scaleType
    };
    localStorage.setItem('atmosphererSettings', JSON.stringify(settings));
}

function loadSettings() {
    const savedSettings = localStorage.getItem('atmosphererSettings');
    if (savedSettings) {
        try {
            const s = JSON.parse(savedSettings);
            tempo = s.tempo ?? 775; reverbLevel = s.reverbLevel ?? 0.83; textureClarity = s.textureClarity ?? 7.09;
            noteAttackTime = s.noteAttackTime ?? 0.71; isPillarModeOn = s.isPillarModeOn ?? false;
            masterFilterCutoff = s.masterFilterCutoff ?? 10600; isFlutterOn = s.isFlutterOn ?? true;
            flutterChance = s.flutterChance ?? 0.5; isBassOn = s.isBassOn ?? true;
            isChordOn = s.isChordOn ?? true; isLeadOn = s.isLeadOn ?? true;
            mainSynthProbability = s.mainSynthProbability ?? 1.0; chordDensity = s.chordDensity ?? 0.25;
            leadDensity = s.leadDensity ?? 0.66; bassDensity = s.bassDensity ?? 0.75;
            distortionLevel = s.distortionLevel ?? 0.0;
            leadOscType = s.leadOscType ?? 'triangle'; mainOscType = s.mainOscType ?? 'sawtooth';
            bassOscType = s.bassOscType ?? 'sawtooth'; scaleType = s.scaleType ?? 'major';
        } catch (e) { console.error("Failed to load settings:", e); }
    }
}

loadSettings();

function makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = i * 2 / n_samples - 1;
        curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
    }
    return curve;
}

function initAudioContext() {
    if (audioContext) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioContext.createGain();
        
        convolver = audioContext.createConvolver(); wetGain = audioContext.createGain();
        convolver.connect(wetGain); wetGain.connect(masterGain);

        flutterDelay = audioContext.createDelay(0.5); flutterFeedback = audioContext.createGain();
        flutterDelay.delayTime.value = 0.15; flutterFeedback.gain.value = 0.6;
        flutterDelay.connect(flutterFeedback).connect(flutterDelay); flutterDelay.connect(masterGain);

        masterFilter = audioContext.createBiquadFilter();
        masterFilter.type = 'lowpass';
        masterFilter.frequency.setValueAtTime(masterFilterCutoff, audioContext.currentTime);
        masterFilter.Q.value = 0.7;

        distortion = audioContext.createWaveShaper();
        // A lower value here (e.g., 20) creates a softer, "warmer" curve instead of a harsh one.
        distortion.curve = makeDistortionCurve(20);
        distortion.oversample = '4x';
        distortionWetGain = audioContext.createGain();
        distortionWetGain.gain.value = distortionLevel;

        bassBus = audioContext.createGain();
        mainBus = audioContext.createGain();

        bassBus.connect(distortion).connect(distortionWetGain).connect(masterGain);
        bassBus.connect(masterGain);
        mainBus.connect(distortion).connect(distortionWetGain).connect(masterGain);
        mainBus.connect(masterGain);

        limiter = audioContext.createDynamicsCompressor();
        limiter.threshold.setValueAtTime(-3.0, audioContext.currentTime);
        limiter.knee.setValueAtTime(3.0, audioContext.currentTime);
        limiter.ratio.setValueAtTime(12.0, audioContext.currentTime);
        limiter.attack.setValueAtTime(0.005, audioContext.currentTime);

        masterGain.connect(masterFilter);
        masterFilter.connect(limiter);
        limiter.connect(audioContext.destination);
        
        createReverbImpulse(); updateReverb(); updateInstructions(); updateUI();
    } catch (e) {
        alert('Web Audio API is not supported in this browser.');
    }
}

dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    if (!audioContext) { alert("Please click the drop zone to enable audio first."); return; }
    dropZone.classList.remove('drag-over');
    const files = event.dataTransfer.files;
    if (files.length > 0) {
        lastFile = files[0];
        processFile(lastFile);
    }
});
dropZone.addEventListener('click', initAudioContext, { once: true });

function processFile(file) {
    dropZoneText.textContent = 'Analyzing audio...'; performanceContainer.innerHTML = '...';
    if (generativeLoopInterval) clearInterval(generativeLoopInterval);
    const reader = new FileReader();
    reader.onload = (e) => { audioContext.decodeAudioData(e.target.result, (buffer) => { analyzeBuffer(buffer); }); };
    reader.readAsArrayBuffer(file);
}

function analyzeBuffer(buffer) {
    sourceAudioBuffer = buffer; const REQUESTED_DURATION = 20.0; const fileDuration = buffer.duration;
    const analysisDuration = Math.min(fileDuration, REQUESTED_DURATION);
    let startTime = 0; if (fileDuration > analysisDuration) { const safeStartRange = fileDuration - analysisDuration; startTime = (safeStartRange * 0.2) + (Math.random() * safeStartRange * 0.6); }
    const offlineCtx = new OfflineAudioContext(1, audioContext.sampleRate * analysisDuration, audioContext.sampleRate);
    const source = offlineCtx.createBufferSource(); source.buffer = buffer; const analyser = offlineCtx.createAnalyser();
    analyser.fftSize = 8192; source.connect(analyser).connect(offlineCtx.destination); source.start(0, startTime, analysisDuration);
    const freqData = new Float32Array(analyser.frequencyBinCount);
    offlineCtx.startRendering().then((renderedBuffer) => {
        analyser.getFloatFrequencyData(freqData); findDominantFrequencies(freqData, audioContext.sampleRate);
    }).catch(err => console.error('Rendering failed:', err));
}

function generateScale(rootFreq, intervals, octaves) {
    const scale = []; for (let i = 0; i < octaves; i++) { for (const interval of intervals) { const note = rootFreq * Math.pow(2, i) * Math.pow(2, interval / 12); if (note < 4000) { scale.push(note); } } } return [...new Set(scale)];
}

function findDominantFrequencies(freqData, sampleRate) {
    const peaks = []; const fftSize = freqData.length * 2;
    for (let i = 1; i < freqData.length - 1; i++) { if (freqData[i] > freqData[i - 1] && freqData[i] > freqData[i + 1] && freqData[i] > -90) { peaks.push({ freq: (i * sampleRate) / fftSize, magnitude: freqData[i] }); } }
    const filteredPeaks = peaks.filter(p => p.freq > 30 && p.freq < 2800); filteredPeaks.sort((a, b) => b.magnitude - a.magnitude);
    if (filteredPeaks.length === 0) { dropZoneText.textContent = "Analysis failed. No peaks found."; return; }
    const lowestPeaks = filteredPeaks.filter(p => p.freq < 200).sort((a,b) => b.magnitude - a.magnitude);
    const rootNote = EQUAL_TEMPERAMENT_FREQUENCIES.reduce((p, c) => (Math.abs(c - (lowestPeaks.length > 0 ? lowestPeaks[0].freq : filteredPeaks[0].freq)) < Math.abs(p - (lowestPeaks.length > 0 ? lowestPeaks[0].freq : filteredPeaks[0].freq)) ? c : p));
    const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10];
    const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
    harmonicPalette = generateScale(rootNote, scaleType === 'minor' ? MINOR_SCALE_INTERVALS : MAJOR_SCALE_INTERVALS, 3);
    dropZoneText.textContent = 'Analysis complete!';
    startLoops(); updateUI();
}

function generativeLoop() {
    if (harmonicPalette.length < 4) return;
    
    const canPlayBass = (isBassOn && !isChordSolo && !isLeadSolo) || isBassSolo;
    const canPlayChord = (isChordOn && !isBassSolo && !isLeadSolo) || isChordSolo;
    const canPlayLead = (isLeadOn && !isBassSolo && !isChordSolo) || isLeadSolo;

    if (canPlayBass && Math.random() < bassDensity) {
        const duration = (tempo / 1000) * (2 + Math.random() * 4);
        playNote(harmonicPalette, 0.6, duration, 'bass');
    }
    if (canPlayChord && Math.random() < chordDensity) {
        const duration = (tempo / 1000) * (1.5 + Math.random() * 2);
        playNote(harmonicPalette, 0.45, duration, 'chord');
    }
    if (canPlayLead && Math.random() < leadDensity) {
        const duration = (tempo / 1000) * (1 + Math.random() * 2);
        playNote(harmonicPalette, 0.5, duration, 'lead');
    }
}

function playNote(noteArray, peakGain, duration, instrumentType) {
    if (!audioContext || !sourceAudioBuffer || !noteArray || noteArray.length === 0) return;
    let freq, freqIndex; 
    const paletteSize = noteArray.length;
    
    // An octave in our generated scale has 7 notes.
    const notesPerOctave = 7;

    switch (instrumentType) {
        case 'bass':
            const bassWeights = [0.4, 0.3, 0.15, 0.1, 0.05, 0.05, 0.05];
            const cumulativeWeights = [];
            bassWeights.reduce((a, b, i) => cumulativeWeights[i] = a + b, 0);
            const rand = Math.random() * cumulativeWeights[cumulativeWeights.length - 1];
            freqIndex = cumulativeWeights.findIndex(w => rand <= w);
            freqIndex = Math.min(freqIndex, Math.min(notesPerOctave, paletteSize - 1));
            break;

        case 'chord': // This is our "Melody"
            // NEW: Restrict melody to a specific range.
            // Starts halfway through the 1st octave (index 3) and ends halfway through the 2nd octave (index 10).
            const chordStartIndex = 3; 
            const chordEndIndex = 10;
            const effectiveChordEnd = Math.min(chordEndIndex, paletteSize - 1);
            const effectiveChordRange = effectiveChordEnd - chordStartIndex + 1;
            
            freqIndex = effectiveChordRange > 0 ? chordStartIndex + Math.floor(Math.random() * effectiveChordRange) : Math.floor(Math.random() * paletteSize);
            break;

        case 'lead':
            // NEW: Restrict lead to two separate, non-contiguous ranges.
            let leadRangeStart, leadRangeSize;
            
            // We'll give it a 75% chance to play in the low range and a 25% chance to jump to the high one.
            if (Math.random() < 0.75) {
                // Range 1: The first octave (indices 0 through 6).
                leadRangeStart = 0;
                leadRangeSize = notesPerOctave;
            } else {
                // Range 2: The first three notes of the third octave.
                // The third octave starts at index 14 (0-6 is 1st, 7-13 is 2nd).
                leadRangeStart = notesPerOctave * 2; // Index 14
                leadRangeSize = 3;
            }

            const effectiveLeadEnd = Math.min(leadRangeStart + leadRangeSize, paletteSize);
            const effectiveLeadRange = effectiveLeadEnd - leadRangeStart;
            
            freqIndex = effectiveLeadRange > 0 ? leadRangeStart + Math.floor(Math.random() * effectiveLeadRange) : Math.floor(Math.random() * paletteSize);
            break;
    }

    freq = noteArray[freqIndex]; 
    if (!freq) return;
    
    const textureGain = peakGain * 0.7;
    const synthGain = peakGain * 0.5;

    playTextureLayer(freq, textureGain, duration, noteAttackTime, instrumentType);
    if (Math.random() < mainSynthProbability) {
        if (instrumentType === 'bass') playSynthLayer(freq, synthGain, duration, noteAttackTime, bassOscType, isPillarModeOn, instrumentType);
        else if (instrumentType === 'chord') playSynthLayer(freq, synthGain, duration, noteAttackTime, mainOscType, isPillarModeOn, instrumentType);
        else if (instrumentType === 'lead') playSynthLayer(freq, synthGain, duration, noteAttackTime, leadOscType, isPillarModeOn, instrumentType);
    }
}

function playTextureLayer(freq, peakGain, duration, attack, instrumentType) {
    const now = audioContext.currentTime; const source = audioContext.createBufferSource(); source.buffer = sourceAudioBuffer;
    const snippetDuration = 1.5; const snippetStart = Math.random() * (sourceAudioBuffer.duration - snippetDuration);
    source.playbackRate.value = 1.0; const filter1 = audioContext.createBiquadFilter(); const filter2 = audioContext.createBiquadFilter();
    filter1.type = 'lowpass'; filter2.type = 'lowpass'; const cutoffFreq = Math.min(4000, freq * textureClarity);
    filter1.frequency.value = cutoffFreq; filter2.frequency.value = cutoffFreq; const envelope = audioContext.createGain();
    const releaseTime = duration * 0.5; envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(peakGain, now + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration + releaseTime);
    const output = source.connect(filter1).connect(filter2).connect(envelope);

    if (instrumentType === 'bass') { output.connect(bassBus); } 
    else { output.connect(mainBus); }

    output.connect(convolver); 
    if (isFlutterOn && Math.random() < flutterChance) { output.connect(flutterDelay); }
    source.start(now, snippetStart, snippetDuration); source.stop(now + duration + releaseTime + 0.1);
}

function playSynthLayer(freq, peakGain, duration, attack, oscType, isPillar, instrumentType) {
    const now = audioContext.currentTime; const mainOsc = audioContext.createOscillator();
    let filterFreq = Math.min(4000, Math.max(200, freq * 1.5));
    if (oscType !== 'sine') { filterFreq *= 0.6; }

    mainOsc.type = oscType; mainOsc.frequency.setValueAtTime(freq, now); mainOsc.detune.setValueAtTime(5, now);
    const subOsc = audioContext.createOscillator(); subOsc.type = 'sine'; subOsc.frequency.setValueAtTime(freq / 2, now);
    const mainOscGain = audioContext.createGain(); mainOscGain.gain.value = 1.0; const subOscGain = audioContext.createGain();
    subOscGain.gain.value = 0.5; const synthFilter = audioContext.createBiquadFilter(); synthFilter.type = 'lowpass';
    synthFilter.frequency.value = filterFreq; synthFilter.Q.value = 0.7; const envelope = audioContext.createGain();
    const effectiveAttack = isPillar ? attack * 0.2 : attack; const release = duration * 1.5;
    envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(peakGain, now + effectiveAttack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);
    mainOsc.connect(synthFilter).connect(mainOscGain).connect(envelope); subOsc.connect(subOscGain).connect(envelope);
    const output = envelope;
    
    if (instrumentType === 'bass') { output.connect(bassBus); } 
    else { output.connect(mainBus); }

    output.connect(convolver);
    if (isFlutterOn && Math.random() < flutterChance) { output.connect(flutterDelay); }
    mainOsc.start(now); mainOsc.stop(now + duration + release + 0.1); subOsc.start(now); subOsc.stop(now + duration + release + 0.1);
}

function createReverbImpulse() {
    if (!audioContext) return; const rate = audioContext.sampleRate; const length = rate * 2.0; const impulse = audioContext.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0); const right = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) { const n = i / length; left[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, 3); right[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, 3); }
    convolver.buffer = impulse;
}

function clearAllTimers() {
    if (generativeLoopInterval) clearInterval(generativeLoopInterval);
    generativeLoopInterval = null;
}

function startLoops() {
    clearAllTimers();
    generativeLoopInterval = setInterval(generativeLoop, tempo);
}

window.addEventListener('keydown', (event) => {
    if (!audioContext || event.repeat) return;
    const key = event.key.toLowerCase();
    const DENSITY_LEVELS = [1.0, 0.75, 0.5, 0.25, 0.0];
    const DISTORTION_LEVELS = [0.0, 0.01, 0.02, 0.03, 0.04, 0.05];
    const cycleDensity = (current) => DENSITY_LEVELS[(DENSITY_LEVELS.indexOf(current) + 1) % DENSITY_LEVELS.length];
    const cycleOsc = (current) => OSCILLATOR_TYPES[(OSCILLATOR_TYPES.indexOf(current) + 1) % OSCILLATOR_TYPES.length];
    const cycleWarmth = (current) => {
        const currentIndex = DISTORTION_LEVELS.findIndex(l => Math.abs(l - current) < 0.001);
        return DISTORTION_LEVELS[(currentIndex + 1) % DISTORTION_LEVELS.length];
    };

    if (event.shiftKey) {
        event.preventDefault();
        switch (key) {
            case 'arrowleft': textureClarity = Math.max(1.0, textureClarity / 1.25); break;
            case 'arrowright': textureClarity = Math.min(16.0, textureClarity * 1.25); break;
            case 'o': bassOscType = cycleOsc(bassOscType); break;
            case 'm': isChordSolo = !isChordSolo; isLeadSolo = isBassSolo = false; break;
            case 'l': isLeadSolo = !isLeadSolo; isChordSolo = isBassSolo = false; break;
            case 'b': isBassSolo = !isBassSolo; isChordSolo = isLeadSolo = false; break;
        }
    } else if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        switch (key) {
            case 'arrowleft': noteAttackTime = Math.max(0.05, noteAttackTime - 0.1); break;
            case 'arrowright': noteAttackTime = Math.min(4.0, noteAttackTime + 0.1); break;
            case 'o': mainOscType = cycleOsc(mainOscType); break;
            case 'm': chordDensity = cycleDensity(chordDensity); break;
            case 'l': leadDensity = cycleDensity(leadDensity); break;
            case 'b': bassDensity = cycleDensity(bassDensity); break;
            case 'f': flutterChance = cycleDensity(flutterChance); break;
            case 'd':
                distortionLevel = cycleWarmth(distortionLevel);
                if (distortionWetGain) distortionWetGain.gain.setTargetAtTime(distortionLevel, audioContext.currentTime, 0.01);
                break;
        }
    } else {
        switch (key) {
            case 'arrowup': tempo = Math.max(50, tempo - 25); startLoops(); break;
            case 'arrowdown': tempo = Math.min(1000, tempo + 25); startLoops(); break;
            case 'arrowleft': reverbLevel = Math.max(0.0, reverbLevel - 0.05); updateReverb(); break;
            case 'arrowright': reverbLevel = Math.min(1.0, reverbLevel + 0.05); updateReverb(); break;
            case 'c': isPillarModeOn = !isPillarModeOn; break;
            case 'b': isBassOn = !isBassOn; break;
            case 'v': isChordOn = !isChordOn; break;
            case 'l': isLeadOn = !isLeadOn; break;
            case 'm': mainSynthProbability = mainSynthProbability > 0 ? 0.0 : 1.0; break;
            case 'o': leadOscType = cycleOsc(leadOscType); break;
            case 'f': isFlutterOn = !isFlutterOn; break;
            case 's':
                scaleType = scaleType === 'minor' ? 'major' : 'minor';
                if (lastFile) { processFile(lastFile); }
                break;
            case '[': masterFilterCutoff = Math.max(100, masterFilterCutoff / 1.2); if(masterFilter) masterFilter.frequency.setTargetAtTime(masterFilterCutoff, audioContext.currentTime, 0.01); break;
            case ']': masterFilterCutoff = Math.min(20000, masterFilterCutoff * 1.2); if(masterFilter) masterFilter.frequency.setTargetAtTime(masterFilterCutoff, audioContext.currentTime, 0.01); break;
        }
    }
    saveSettings(); updateUI();
});

const atmosphereKnob = document.getElementById('atmosphere-knob');

function updateAtmosphere(value) {
    // 'value' will be 0-1000 from the slider
    const atmosphere = value / 1000.0; // Normalize to 0.0 - 1.0

    // --- Map the single atmosphere value to multiple parameters based on new rules ---

    // Tempo: Ranges from +300ms to -300ms around a base of 775ms
    // Range: 1075ms (slow) down to 475ms (fast)
    tempo = 1075 - (atmosphere * 600);
    startLoops(); // Important: Restart the loop to apply the new tempo

    // Filter: 1kHz to 9kHz
    masterFilterCutoff = 1000 + (atmosphere * 8000);

    // Warmth: 0% to 5%
    distortionLevel = atmosphere * 0.05;

    // Reverb: From a base of 63% (83% - 20%) up to 100%
    reverbLevel = 0.63 + (atmosphere * 0.37);

    // Clarity: From a base of 5.59 (7.09 - 1.5) up to 9.0
    textureClarity = 5.59 + (atmosphere * (9.0 - 5.59));

    // Attack: Ranges from -400ms to +400ms around a base of 710ms
    // Range: 310ms (fast attack) up to 1110ms (slow attack)
    noteAttackTime = 0.31 + (atmosphere * 0.8);

    // Densities
    leadDensity = 0.1 + (atmosphere * 0.4);   // 10% to 50%
    bassDensity = 0.4 + (atmosphere * 0.3);   // 40% to 70%
    chordDensity = 0.25 + (atmosphere * 0.5); // 25% to 75%

    // --- Apply the changes to the audio engine immediately ---
    updateReverb();
    if(distortionWetGain) distortionWetGain.gain.setTargetAtTime(distortionLevel, audioContext.currentTime, 0.01);
    if(masterFilter) masterFilter.frequency.setTargetAtTime(masterFilterCutoff, audioContext.currentTime, 0.01);

    // Update the UI so you can see the values change
    updateUI();
}


// Listen for changes on the slider
atmosphereKnob.addEventListener('input', (event) => {
    updateAtmosphere(event.target.value);
});

// Set initial values on load
document.addEventListener('DOMContentLoaded', () => {
    updateAtmosphere(atmosphereKnob.value);
});

function updateReverb() { if (!wetGain) return; wetGain.gain.setValueAtTime(reverbLevel, audioContext.currentTime); }

function updateInstructions() {
    instructionsEl.innerHTML = `[Arrows]: Tempo/Reverb | [Shift+Arrows]: Surroundings | [Ctrl+Arrows]: Attack<br>
                                [B/V/L/M/F]: Toggles | [S]: Scale | [[]/[]]: Filter | [Shift+...]: Solos`;
}

function updateUI() {
    if (!audioContext) return;
    const formatHz = (hz) => hz > 1000 ? `${(hz/1000).toFixed(1)}kHz` : `${Math.round(hz)}Hz`;
    knobsContainer.innerHTML = `
        <div class="control-item"><span class="label">Tempo: </span><span class="value">${Math.round(tempo)}ms</span><br><span class="shortcut">[Arrows]</span></div>
        <div class="control-item"><span class="label">Reverb: </span><span class="value">${Math.round(reverbLevel*100)}%</span><br><span class="shortcut">[Arrows]</span></div>
        <div class="control-item"><span class="label">Clarity: </span><span class="value">x${textureClarity.toFixed(2)}</span><br><span class="shortcut">[Shift+Arr]</span></div>
        <div class="control-item"><span class="label">Attack: </span><span class="value">${(noteAttackTime * 1000).toFixed(0)}ms</span><br><span class="shortcut">[Ctrl+Arr]</span></div>
        <div class="control-item"><span class="label">Filter: </span><span class="value">${formatHz(masterFilterCutoff)}</span><br><span class="shortcut">[ [ ] / [ ] ]</span></div>
        <div class="control-item"><span class="label">Scale: </span><span class="value">${scaleType}</span><br><span class="shortcut">[S]</span></div>
        <div class="control-item"><span class="label">Warmth: </span><span class="value">${Math.round(distortionLevel*100)}%</span><br><span class="shortcut">[Ctrl+D]</span></div>
        `;
    let mode = "Normal";
    if (isBassSolo) mode = "BASS SOLO"; if (isChordSolo) mode = "MELODY SOLO"; if (isLeadSolo) mode = "LEAD SOLO";
    modeDisplay.textContent = `Mode: ${mode}`;
    const chordDensityText = `${(chordDensity * 100).toFixed(0)}%`;
    const leadDensityText = `${(leadDensity * 100).toFixed(0)}%`;
    const bassDensityText = `${(bassDensity * 100).toFixed(0)}%`;
    performanceContainer.innerHTML = `
        <div class="performance-column"><h3>Toggles</h3>
            <div>Synth: ${mainSynthProbability > 0 ? 'ON' : 'OFF'} <span class="shortcut">[M]</span></div>
            <div>Lead: ${isLeadOn ? 'ON' : 'OFF'} <span class="shortcut">[L]</span></div>
            <div>Melody: ${isChordOn ? 'ON' : 'OFF'} <span class="shortcut">[V]</span></div>
            <div>Bass: ${isBassOn ? 'ON' : 'OFF'} <span class="shortcut">[B]</span></div>
            <div>Pillar: ${isPillarModeOn ? 'ON' : 'OFF'} <span class="shortcut">[C]</span></div>
            <div>Flutter: ${isFlutterOn ? 'ON' : 'OFF'} <span class="shortcut">[F]</span></div></div>
        <div class="performance-column"><h3>Solos</h3>
            <div>Melody <span class="shortcut">[Shift+M]</span></div>
            <div>Lead <span class="shortcut">[Shift+L]</span></div>
            <div>Bass <span class="shortcut">[Shift+B]</span></div></div>
        <div class="performance-column"><h3>Density</h3>
            <div>Melody: ${chordDensityText} <span class="shortcut">[Ctrl+M]</span></div>
            <div>Lead: ${leadDensityText} <span class="shortcut">[Ctrl+L]</span></div>
            <div>Bass: ${bassDensityText} <span class="shortcut">[Ctrl+B]</span></div>
            <div>Flutter: ${(flutterChance*100).toFixed(0)}% <span class="shortcut">[Ctrl+F]</span></div></div>
        <div class="performance-column"><h3>Oscillators</h3>
            <div>Main: ${mainOscType} <span class="shortcut">[Ctrl+O]</span></div>
            <div>Lead: ${leadOscType} <span class="shortcut">[O]</span></div>
            <div>Bass: ${bassOscType} <span class="shortcut">[Shift+O]</span></div></div>`;
}

// Ensure UI is initialized on page load
loadSettings();
document.addEventListener('DOMContentLoaded', updateUI);