/** Real-time pacing with a fake clock: no browser, no retail data. */
import { describe, it, expect } from 'vitest';
import { BcEngine, type BcState } from './engine';
import { MapBuilder, world } from './synth';
import { PlayLoop, TICK_MS } from './play-loop';

const long = (): BcState => { const m = new MapBuilder().room(5, 10, 60, 12); return BcEngine.newGame(world([m.build()]), 3, { pose: { x: 6, y: 11, facing: 1 } }); };
const px = (st: BcState) => BcEngine.view(st).pose.x;
const press = (l: PlayLoop, code: string, ms: number, frame = 16) => { l.keyDown(code); let n = 0; for (let t = 0; t < ms; t += frame) n += l.update(frame).ticks; l.keyUp(code); return n; };

describe('tick clock', () => {
  it('runs one engine tick per 160 ms (PAL) and none early', () => {
    const l = new PlayLoop(long());
    expect(l.update(159).ticks).toBe(0); expect(l.update(1).ticks).toBe(1);
    let n = 0; for (let i = 0; i < 100; i++) n += l.update(16).ticks;   // 1600 ms
    expect(n).toBe(10);
    expect(l.ticks).toBe(11);
  });
  it('NTSC is 10 vblanks = 166.7 ms: 6 ticks per second, PAL 6.25', () => {
    const sec = (r: 'PAL' | 'NTSC') => { const l = new PlayLoop(long(), { region: r }); let n = 0; for (let i = 0; i < 1000; i++) n += l.update(1).ticks; return n; };
    expect(TICK_MS.NTSC).toBeCloseTo(166.67, 1);
    expect(sec('NTSC')).toBe(6); expect(sec('PAL')).toBe(6);   // 1000/160 = 6.25 -> 6 whole ticks in the first second
    const two = (r: 'PAL' | 'NTSC') => { const l = new PlayLoop(long(), { region: r }); let n = 0; for (let i = 0; i < 4000; i++) n += l.update(1).ticks; return n; };
    expect(two('PAL')).toBe(25); expect(two('NTSC')).toBe(24);
  });
  it('a stalled host replays at most the catch-up cap and then drops the backlog', () => {
    const l = new PlayLoop(long());
    expect(l.update(60000).ticks).toBe(5);
    expect(l.update(160).ticks).toBe(1);   // not 'the remaining backlog'
  });
  it('a paused loop does not run ticks and does not bank time', () => {
    const l = new PlayLoop(long()); l.paused = true;
    expect(l.update(5000).ticks).toBe(0); l.paused = false;
    expect(l.update(100).ticks).toBe(0);
  });
});

describe('keys', () => {
  it('a tap shorter than a tick still moves once (null control: no key, no move)', () => {
    const l = new PlayLoop(long()); const x0 = px(l.st);
    l.keyDown('KeyW'); l.update(10); l.keyUp('KeyW');
    l.update(160);
    expect(px(l.st)).toBe(x0 + 1);
    const idle = new PlayLoop(long()); idle.update(1600);
    expect(px(idle.st)).toBe(x0);
  });
  it('a held key repeats after the delay, one per tick; without repeat it moves once', () => {
    const l = new PlayLoop(long()); const x0 = px(l.st);
    press(l, 'KeyW', 1600);   // 10 ticks starting at 0, 160, ... 1440 ms: tick 0 fires, 160 / 320 ms (< 400) do not, then 480 ... 1440 every tick = 1 + 7
    expect(px(l.st) - x0).toBe(8);
    const once = new PlayLoop(long(), { repeatDelayMs: Infinity }); press(once, 'KeyW', 1600);
    expect(px(once.st) - x0).toBe(1);
    const fast = new PlayLoop(long(), { repeatDelayMs: 0 }); press(fast, 'KeyW', 1600);
    expect(px(fast.st) - x0).toBe(10);
  });
  it('a key that does not repeat (open door) fires once however long it is held', () => {
    const l = new PlayLoop(long()); let opens = 0;
    l.keyDown('KeyO'); for (let i = 0; i < 100; i++) opens += l.update(16).events.filter(e => e.what === 'blocked' || e.what === 'door open' || e.what === 'door locked').length; l.keyUp('KeyO');
    expect(opens).toBeLessThanOrEqual(1);
  });
  it('releaseAll (window blur) stops a repeating key', () => {
    const l = new PlayLoop(long()); l.keyDown('KeyW'); for (let i = 0; i < 40; i++) l.update(16);
    const x = px(l.st); l.releaseAll(); for (let i = 0; i < 40; i++) l.update(16);
    expect(px(l.st)).toBe(x);
  });
  it('an OS auto-repeat keydown for a key already down does not double the rate', () => {
    const a = new PlayLoop(long()), b = new PlayLoop(long());
    a.keyDown('KeyW'); b.keyDown('KeyW');
    for (let i = 0; i < 100; i++) { b.keyDown('KeyW'); a.update(16); b.update(16); }
    expect(px(b.st)).toBe(px(a.st));
  });
  it('the command budget caps the commands a tick may carry', () => {
    const l = new PlayLoop(long(), { maxCmdsPerTick: 1, repeatDelayMs: 0 });
    l.keyDown('KeyW'); l.keyDown('ArrowUp'); l.update(160);
    expect(px(l.st)).toBe(7);   // two held forward keys, one command per tick
  });
  it('a queued command (a click) is played on the next tick', () => {
    const l = new PlayLoop(long()); l.command({ kind: 'turn', by: 1 }); expect(BcEngine.view(l.st).pose.facing).toBe(1);
    l.update(160); expect(BcEngine.view(l.st).pose.facing).toBe(2);
  });
});

describe('frame-rate independence', () => {
  it('the same key schedule gives byte-identical saves at 16 ms and 40 ms frames', () => {
    const run = (frame: number) => { const l = new PlayLoop(long()); l.keyDown('KeyW'); for (let t = 0; t < 3200; t += frame) { l.update(frame); if (t === 1600) { l.keyUp('KeyW'); l.keyDown('KeyE'); } } l.keyUp('KeyE'); l.update(320); return Buffer.from(BcEngine.save(l.st)).toString('base64'); };
    expect(run(16)).toBe(run(40));
    expect(run(16)).not.toBe(run(40).replace('A', 'B'));   // the comparison can fail
  });
});
