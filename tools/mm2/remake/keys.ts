/**
 * Keyboard policy for the turn-based Might & Magic II shell: which key becomes which engine command in which mode. Shell policy, not the game's UI (the original party command
 * menu CODE+0x119C2 is not harnessed, game-rules 14.7); pure, no DOM, so it is testable. The engine takes one command per player action; there is no clock.
 */
import type { Mm2Cmd, Mm2View, Order } from './engine';
import { CB_SPELLS } from '../rules4';

export class Mm2Keys {
  /** the party member the digit keys selected */
  sel = 0;
  /** orders queued for the next battle round, by party slot */
  pending: (Order | null)[] = [];

  key(code: string, v: Mm2View): Mm2Cmd | null {
    if (v.gameOver) return null;
    const digit = /^Digit([1-6])$/.exec(code);
    if (digit) { this.sel = Math.min(+digit[1] - 1, Math.max(0, v.party.length - 1)); return null; }
    if (v.mode === 'prompt') {
      switch (code) {
        case 'KeyA': return { kind: 'prompt', choice: 'attack' };
        case 'KeyH': return { kind: 'prompt', choice: 'hide' };
        case 'KeyR': return { kind: 'prompt', choice: 'run' };
        case 'KeyB': return { kind: 'prompt', choice: 'bribe', bribe: { what: 'gold', amount: 100 } };
      }
      return null;
    }
    if (v.mode === 'battle') {
      switch (code) {
        case 'Space': case 'Enter': { const orders = this.pending; this.pending = []; return { kind: 'round', orders }; }
        case 'KeyC': {
          const spell = v.party[this.sel]?.spells.find(s => CB_SPELLS.includes(s));
          if (spell !== undefined) this.pending[this.sel] = { kind: 'cast', spell, target: 0 };
          return null;
        }
        case 'KeyF': this.pending[this.sel] = { kind: 'run' }; return null;
        case 'KeyX': this.pending[this.sel] = { kind: 'wait' }; return null;
        case 'KeyV': this.pending[this.sel] = { kind: 'shoot', target: 0 }; return null;
      }
      return null;
    }
    switch (code) {
      case 'KeyW': case 'ArrowUp': return { kind: 'move', dir: 'forward' };
      case 'KeyS': case 'ArrowDown': return { kind: 'move', dir: 'back' };
      case 'KeyQ': case 'ArrowLeft': return { kind: 'turn', by: -1 };
      case 'KeyE': case 'ArrowRight': return { kind: 'turn', by: 1 };
      case 'KeyR': return { kind: 'rest' };
      case 'KeyU': return { kind: 'unlock', char: this.sel };
      case 'KeyB': return { kind: 'bash' };
      case 'KeyM': return { kind: 'encounter' };
      case 'KeyT': return { kind: 'train', char: this.sel };
      case 'KeyL': return { kind: 'takeLoot', char: this.sel };
    }
    return null;
  }
}

/** the HUD as plain text lines (the shell only prints them) */
export function hudLines(v: Mm2View, k: Mm2Keys, log: string[]): string[] {
  const out: string[] = [];
  out.push(`screen ${v.pose.screen} (${v.pose.x},${v.pose.y}) ${'NESW'[v.pose.facing]}  day ${v.clock.day} y${v.clock.year}  ${v.mode.toUpperCase()}${v.gameOver ? ' - GAME OVER' : ''}  ahead: ${['open', 'wall', v.ahead.locked ? 'locked door' : 'door', 'wall'][v.ahead.code]}`);
  v.party.forEach((p, i) => out.push(`${i === k.sel ? '>' : ' '}${i + 1} ${p.name.padEnd(11)} ${p.cls.padEnd(8)} L${String(p.level).padEnd(2)} ${String(p.hp).padStart(3)}/${String(p.maxHp).padEnd(3)} SP${String(p.sp).padStart(2)} g${p.gold}${p.cond ? ` cond ${p.cond.toString(16)}` : ''}${p.spells.length ? ` [${p.spells.join(' ')}]` : ''}`));
  if (v.prompt) out.push(`ENCOUNTER${v.prompt.surprise === 2 ? ' (you surprise them)' : ''}: ${v.prompt.count} - ${v.prompt.monsters.map(m => m.name).join(', ')}   A attack  H hide  R run  B bribe 100 gold`);
  if (v.battle) out.push(`round ${v.battle.round}: ${v.battle.monsters.map(m => `${m.name} ${m.hp}${m.status ? '*' : ''}`).join(', ')}${v.battle.queued ? ` (+${v.battle.queued} queued)` : ''}   Space round, 1-6 select, C cast, F run, X wait, V shoot`);
  if (v.loot.length) out.push(`loot: ${v.loot.map(l => l.name).join(', ')} (L takes it)`);
  out.push('', ...log.slice(-12));
  out.push('', 'W/S move, Q/E turn, R rest, U unlock, B bash, T train, M meet monsters (debug)');
  return out;
}
