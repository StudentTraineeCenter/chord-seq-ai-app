import * as Tone from "tone";
import { chordToNotes } from "@/data/chord_to_notes";
import { tokenToChord } from "@/data/token_to_chord";

let synth: Tone.Sampler;
let metronomeSynth: Tone.Sampler;
let metronomePart: Tone.Part;

let playing = false;
let bpm = 120; // Custom implementation of bpm is used to allow number input
let timeNoteDuration: { time: number; note: number; duration: number }[] = [];
let lastStartPlaying: number;

// Initialize Tone.js
Tone.loaded().then(() => {
  Tone.Destination.volume.value = -8;

  synth = new Tone.Sampler({
    urls: {
      C4: "C4.mp3",
      "D#4": "Ds4.mp3",
      "F#4": "Fs4.mp3",
      A4: "A4.mp3",
    },
    release: 1,
    baseUrl: "https://tonejs.github.io/audio/salamander/",
  }).toDestination();

  const reverb = new Tone.Reverb(3).toDestination();
  synth.connect(reverb);

  metronomeSynth = new Tone.Sampler({
    urls: {
      C4: "wood_box_1.mp3",
    },
    release: 1,
    baseUrl: "https://tonejs.github.io/audio/berklee/",
  }).toDestination();

  // Make the sound less harsh
  metronomeSynth.connect(new Tone.Reverb(0.5).toDestination());
  metronomeSynth.connect(new Tone.Filter(500, "lowpass").toDestination());
  metronomeSynth.volume.value = -10;
});

function MIDIToFreq(midi: number) {
  return Math.pow(2, (midi - 69) / 12) * 440;
}

function MIDIsToFreq(midi: number[]) {
  return midi.map((note) => MIDIToFreq(note));
}

export function playNotes(notes: number[]) {
  if (playing) return;

  // Limit the number of calls to triggerAttackRelease
  if (lastStartPlaying + 100 > Date.now()) return;
  lastStartPlaying = Date.now();

  notes = MIDIsToFreq(notes);

  Tone.loaded().then(() => {
    const now = Tone.now();
    notes.forEach((note) => {
      synth.triggerAttack(note, now);
    });
    synth.triggerRelease(notes, now + 0.5);
  });
}

export function playChord(chord: string) {
  if (chord === "?" || playing) return;

  // Limit the number of calls to triggerAttackRelease
  if (lastStartPlaying + 200 > Date.now()) return;
  lastStartPlaying = Date.now();

  const notes = MIDIsToFreq(chordToNotes[chord]);

  Tone.loaded().then(() => {
    const now = Tone.now();
    notes.forEach((note) => {
      synth.triggerAttack(note, now);
    });
    synth.triggerRelease(notes, now + 0.5);
  });
}

export function playSequence(
  chords: { index: number; token: number; duration: number; variant: number }[],
  playheadPosition: number,
  setPlayheadPosition: (position: number) => void,
  setPlaying: (playing: boolean) => void,
  metronome: boolean
) {
  // Prepare the sequence
  timeNoteDuration = [];
  let totalTime = 0;
  for (const chord of chords) {
    const duration = chord.duration / (bpm / 60); // Duration in seconds

    if (chord.token === -1) {
      totalTime += duration;
      continue;
    }

    const freqs = MIDIsToFreq(
      chordToNotes[tokenToChord[chord.token][chord.variant]]
    );

    for (const freq of freqs) {
      timeNoteDuration.push({
        time: totalTime,
        note: freq,
        duration: duration,
      });
    }

    totalTime += duration;
  }

  // Play the sequence
  Tone.loaded().then(() => {
    playing = true;

    // Start the sequence
    const part = new Tone.Part((time, value) => {
      synth.triggerAttackRelease(value.note, value.duration, time);
    }, timeNoteDuration);
    part.loop = false;
    part.loopEnd = "1m";

    Tone.Transport.start();
    part.start();

    // Start the metronome
    metronomePart = new Tone.Part(
      (time) => {
        metronomeSynth.triggerAttackRelease("C4", "8n", time);
      },
      [0]
    );
    metronomePart.loop = true;
    metronomePart.loopEnd = 1 / (bpm / 60);
    metronomePart.start();

    // Offset the current time by the playhead position
    const timePosition = playheadPosition / (bpm / 60);
    Tone.Transport.seconds = timePosition;

    // If the start time is in the middle of a chord, play the remaining part of the chord
    for (const note of timeNoteDuration) {
      const remainingDuration = note.time + note.duration - timePosition;

      if (note.time >= timePosition || remainingDuration <= 0) continue;

      synth.triggerAttackRelease(note.note, remainingDuration, Tone.now());
    }

    // Mute the metronome if needed (it is started either way to keep the timing and allow unpause)
    if (!metronome) metronomePart.mute = true;

    // Start moving the playhead
    updatePlayheadPosition(setPlayheadPosition, totalTime, setPlaying);
  });
}

// Move playhead to the current time
async function updatePlayheadPosition(
  setPlayheadPosition: (position: number) => void,
  partDuration: number,
  setPlaying: (playing: boolean) => void
) {
  // Stop the playback if it is not playing or the end of the sequence is reached
  const timePosition = Tone.Transport.seconds;
  if (!playing || timePosition > partDuration) {
    setPlaying(false);
    stopPlayback();

    // Reset the playhead position if the end of the sequence is reached
    if (timePosition > partDuration) setPlayheadPosition(0);

    return;
  }

  // Move the playhead, repeat the function
  setPlayheadPosition(timePosition * (bpm / 60));
  setTimeout(
    () => updatePlayheadPosition(setPlayheadPosition, partDuration, setPlaying),
    10
  );
}

// After user has clicked on a timeline to change the playhead position
export function onPlayheadPositionChange(playheadPosition: number) {
  if (!playing) return;

  const timePosition = playheadPosition / (bpm / 60);
  Tone.Transport.seconds = timePosition;

  // Limit the number of calls to triggerAttackRelease
  if (lastStartPlaying + 500 > Date.now()) return;
  lastStartPlaying = Date.now();

  // If the start time is in the middle  a chord, play the rest of the chord
  for (const note of timeNoteDuration) {
    const remainingDuration = note.time + note.duration - timePosition;

    if (note.time >= timePosition || remainingDuration <= 0) continue;

    synth.triggerAttackRelease(note.note, remainingDuration, Tone.now());
  }
}

export function stopPlayback() {
  playing = false;

  Tone.Transport.stop();
  Tone.Transport.cancel();
}

export function setMuteMetronome(mute: boolean) {
  if (!playing) return;

  metronomePart.mute = mute;
}

export function setBpm(newBpm: number) {
  bpm = newBpm;

  // To not fall out of sync, we stop the playback
  if (playing) stopPlayback();
}
