import { State } from './state.js';

export const Sound = {
    ctx: null,
    getCtx: function () {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        return this.ctx;
    },
    play: function (type) {
        if (!State.soundEnabled) return;
        try {
            const ctx = this.getCtx();
            if (ctx.state === 'suspended') ctx.resume();
            const t = ctx.currentTime;
            switch (type) {
                case 'dice': {
                    for (let i = 0; i < 5; i++) {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.connect(g); g.connect(ctx.destination);
                        o.type = 'square';
                        o.frequency.setValueAtTime(200 + Math.random() * 400, t + i * 0.06);
                        g.gain.setValueAtTime(0.06, t + i * 0.06);
                        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.05);
                        o.start(t + i * 0.06);
                        o.stop(t + i * 0.06 + 0.05);
                    }
                    break;
                }
                case 'crit': {
                    [523, 659, 784].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.connect(g); g.connect(ctx.destination);
                        o.type = 'triangle';
                        o.frequency.value = freq;
                        g.gain.setValueAtTime(0, t + i * 0.05);
                        g.gain.linearRampToValueAtTime(0.1, t + i * 0.05 + 0.05);
                        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.05 + 0.5);
                        o.start(t + i * 0.05);
                        o.stop(t + i * 0.05 + 0.5);
                    });
                    break;
                }
                case 'fail': {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.connect(g); g.connect(ctx.destination);
                    o.type = 'sawtooth';
                    o.frequency.setValueAtTime(300, t);
                    o.frequency.linearRampToValueAtTime(100, t + 0.4);
                    g.gain.setValueAtTime(0.08, t);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
                    o.start(t); o.stop(t + 0.4);
                    break;
                }
                case 'sword': {
                    const o1 = ctx.createOscillator();
                    const g1 = ctx.createGain();
                    o1.connect(g1); g1.connect(ctx.destination);
                    o1.type = 'sawtooth';
                    o1.frequency.setValueAtTime(980, t);
                    o1.frequency.exponentialRampToValueAtTime(240, t + 0.12);
                    g1.gain.setValueAtTime(0.035, t);
                    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
                    o1.start(t); o1.stop(t + 0.12);

                    const o2 = ctx.createOscillator();
                    const g2 = ctx.createGain();
                    o2.connect(g2); g2.connect(ctx.destination);
                    o2.type = 'triangle';
                    o2.frequency.setValueAtTime(330, t + 0.02);
                    o2.frequency.exponentialRampToValueAtTime(140, t + 0.14);
                    g2.gain.setValueAtTime(0.025, t + 0.02);
                    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
                    o2.start(t + 0.02); o2.stop(t + 0.14);
                    break;
                }
                case 'hit': {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.connect(g); g.connect(ctx.destination);
                    o.type = 'sine';
                    o.frequency.setValueAtTime(80, t);
                    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
                    g.gain.setValueAtTime(0.2, t);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
                    o.start(t); o.stop(t + 0.15);
                    break;
                }
                case 'heal': {
                    [523, 659, 784, 1047].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.connect(g); g.connect(ctx.destination);
                        o.type = 'sine';
                        o.frequency.value = freq;
                        g.gain.setValueAtTime(0.0, t + i * 0.07);
                        g.gain.linearRampToValueAtTime(0.07, t + i * 0.07 + 0.04);
                        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.25);
                        o.start(t + i * 0.07);
                        o.stop(t + i * 0.07 + 0.25);
                    });
                    break;
                }
                case 'levelup': {
                    const notes = [523, 659, 784, 1047, 1319];
                    notes.forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.connect(g); g.connect(ctx.destination);
                        o.type = 'triangle';
                        o.frequency.value = freq;
                        g.gain.setValueAtTime(0.12, t + i * 0.08);
                        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.3);
                        o.start(t + i * 0.08);
                        o.stop(t + i * 0.08 + 0.3);
                    });
                    break;
                }
                case 'loot': {
                    const notes = [800, 1000, 1200, 1400];
                    notes.forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.connect(g); g.connect(ctx.destination);
                        o.type = 'sine';
                        o.frequency.value = freq;
                        g.gain.setValueAtTime(0.0, t + i * 0.12);
                        g.gain.linearRampToValueAtTime(0.05, t + i * 0.12 + 0.08);
                        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.4);
                        o.start(t + i * 0.12);
                        o.stop(t + i * 0.12 + 0.4);
                    });
                    break;
                }
                case 'click': {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.connect(g); g.connect(ctx.destination);
                    o.type = 'sine';
                    o.frequency.setValueAtTime(800, t);
                    o.frequency.exponentialRampToValueAtTime(400, t + 0.05);
                    g.gain.setValueAtTime(0.1, t);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
                    o.start(t); o.stop(t + 0.05);
                    break;
                }
            }
        } catch (e) { console.warn('Sound playback failed:', e); }
    }
};
