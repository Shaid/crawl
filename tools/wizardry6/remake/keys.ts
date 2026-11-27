/**
 * Keyboard policy for the step-based Wizardry 6 shell and walker-page hook: which key becomes which engine command in which mode. Shell policy, not the game's UI (the party
 * command menus are not harnessed); pure, no DOM, so it is testable. One command per player action; there is no clock.
 */
import type { W6Cmd, W6View } from './engine';

export class W6Keys {
  /** the party member the digit keys selected */
  sel = 0;
  /** the trap id the disarm key will name (cycled by N; the real game shows a menu of 16) */
  guess = 1;

  key(code: string, v: W6View): W6Cmd | null {
    if (v.gameOver) return null;
    const digit = /^Digit([1-6])$/.exec(code);
    if (digit) { this.sel = Math.min(+digit[1] - 1, Math.max(0, v.party.length - 1)); return null; }
    switch (v.mode) {
      case 'combat':
        switch (code) {
          case 'Space': case 'Enter': return { kind: 'round' };
          case 'KeyF': return { kind: 'planAll', plan: { act: 'run' } };
          case 'KeyH': return { kind: 'planAll', plan: { act: 'hide' } };
          case 'KeyZ': return { kind: 'plan', member: this.sel, plan: { act: 'attack' } };
          case 'KeyC': {
            const sp = v.party[this.sel]?.spells[0];
            return sp ? { kind: 'plan', member: this.sel, plan: { act: 'cast', spell: sp.id, power: 1, tg: 1, ti: -3 } } : null;
          }
        }
        return null;
      case 'loot':
        if (code === 'KeyT') return { kind: 'takeAll' };
        if (code === 'KeyL') return { kind: 'leaveLoot' };
        return null;
      case 'chest':
        switch (code) {
          case 'KeyI': return { kind: 'chestInspect', who: this.sel };
          case 'KeyD': return { kind: 'chestDisarm', who: this.sel, trap: this.guess };
          case 'KeyN': this.guess = (this.guess % 15) + 1; return null;
          case 'KeyO': return { kind: 'chestOpen', who: this.sel };
          case 'KeyL': return { kind: 'chestLeave' };
        }
        return null;
      default: break;
    }
    switch (code) {
      case 'KeyW': case 'ArrowUp': return { kind: 'move', dir: 'forward' };
      case 'KeyS': case 'ArrowDown': return { kind: 'move', dir: 'back' };
      case 'KeyA': return { kind: 'move', dir: 'left' };
      case 'KeyD': return { kind: 'move', dir: 'right' };
      case 'KeyQ': case 'ArrowLeft': return { kind: 'turn', by: -1 };
      case 'KeyE': case 'ArrowRight': return { kind: 'turn', by: 1 };
      case 'KeyR': return { kind: 'camp' };
      case 'KeyU': return { kind: 'pickLock', who: this.sel };
      case 'KeyM': return { kind: 'encounter' };
      case 'KeyK': return { kind: 'chest' };
    }
    return null;
  }
}

/** the HUD as plain text lines (the shell only prints them) */
export function hudLines(v: W6View, k: W6Keys, log: string[]): string[] {
  const out: string[] = [];
  out.push(`level ${v.levelId} region ${v.region} (${v.local.x},${v.local.y}) ${'NESW'[v.pose.facing]}  clock ${v.clock}  ${v.mode.toUpperCase()}${v.gameOver ? ' - GAME OVER' : ''}  ahead: ${v.ahead.door === 'none' ? ['open', 'doorway', 'wall', 'door'][v.ahead.code] : v.ahead.door + ' door'}`);
  v.party.forEach((p, i) => out.push(`${i === k.sel ? '>' : ' '}${i + 1} ${p.name.padEnd(9)} ${p.cls.padEnd(9)} L${String(p.level).padEnd(2)} ${String(p.hp).padStart(3)}/${String(p.maxHp).padEnd(3)} st${String(p.stamina).padStart(3)} xp${p.xp}${p.cond ? ` cond ${p.cond}` : ''}${p.tired ? ' tired' : ''}`));
  if (v.fight) out.push(`round ${v.fight.round}${v.fight.scripted ? ' (scripted)' : ''}: ${v.fight.groups.map(g => `${g.name} x${g.living}`).join(', ')}   Space round, 1-6 select, Z attack, C cast, F run, H hide`);
  if (v.loot.length) out.push(`loot: ${v.loot.map(l => `${l.name}${l.qty > 1 ? ` x${l.qty}` : ''}${l.mustTake ? '!' : ''}`).join(', ')}   T take all, L leave`);
  if (v.chest) out.push(`chest${v.chest.disarmed ? ' (disarmed)' : v.chest.sprung ? ' (sprung)' : ''}: ${v.chest.letters || '?'}   I inspect, D disarm as trap ${k.guess} (N next), O open, L leave`);
  out.push('', ...log.slice(-12));
  out.push('', 'W/S/A/D move, Q/E turn, R camp, U pick lock, M wandering fight, K chest (debug)');
  return out;
}
