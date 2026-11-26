// Voice gate: learns the background noise level and quietly lowers everything that isn't speech.
class VoiceGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.noise = 0.004;   // running estimate of the noise floor
    this.gain = 0.1;
    this.hold = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!input || !output) return true;

    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);

    // Noise floor: follow quiet moments quickly, loud moments very slowly.
    if (rms < this.noise) this.noise = this.noise * 0.95 + rms * 0.05;
    else this.noise = this.noise * 0.9997 + rms * 0.0003;
    this.noise = Math.min(Math.max(this.noise, 0.0008), 0.05);

    const threshold = Math.max(this.noise * 3.2, 0.006);
    if (rms > threshold) this.hold = 70; // keep open ~200 ms after speech so word endings aren't cut
    else if (this.hold > 0) this.hold--;

    const target = this.hold > 0 ? 1 : 0.06;
    const prev = this.gain;
    const coef = target > prev ? 0.45 : 0.04; // open fast, close gently
    const next = prev + (target - prev) * coef;
    for (let i = 0; i < input.length; i++) {
      const g = prev + ((next - prev) * (i + 1)) / input.length;
      output[i] = input[i] * g;
    }
    this.gain = next;
    return true;
  }
}
registerProcessor('voice-gate', VoiceGate);
