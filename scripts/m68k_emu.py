#!/usr/bin/env python3
"""
Minimal Motorola 68000 interpreter — enough to run the S_4 decompression engine.
Executes the 496 bytes of S_4 code directly, reading from S_5 and writing to memory.
"""
import struct

# ── Instruction utilities ──

def sign_extend(value, bits):
    """Sign-extend a value from `bits` to 32 bits."""
    if value & (1 << (bits - 1)):
        return value - (1 << bits)
    return value

# ── 68000 CPU state ──

class CPU:
    def __init__(self, memory, code_base, code_size):
        self.reg = [0] * 16  # d0-d7 (0-7), a0-a7 (8-15)
        self.pc = code_base
        self.mem = memory     # memory: dict or bytearray
        self.code = memory[code_base:code_base + code_size]  # code bytes
        self.code_base = code_base
        self.code_size = code_size
        self.flags = {'c': 0, 'v': 0, 'z': 0, 'n': 0, 'x': 0}
        self.halted = False
        self.trace = []
        self.max_instr = 5000000  # safety limit
        self.instr_count = 0
        
        # Stack
        self.reg[15] = 0x100000  # SP (a7)
    
    def r(self, n):
        """Read register."""
        return self.reg[n]
    
    def w(self, n, val):
        """Write register (32-bit)."""
        self.reg[n] = val & 0xFFFFFFFF
    
    def get_d(self, n):
        return self.reg[n]
    
    def set_d(self, n, val):
        self.reg[n] = val & 0xFFFFFFFF
    
    def get_a(self, n):
        return self.reg[8 + n]
    
    def set_a(self, n, val):
        self.reg[8 + n] = val & 0xFFFFFFFF
    
    # ── Memory access ──
    
    def rb(self, addr):
        addr &= 0xFFFFFF
        if addr in self.mem:
            return self.mem[addr] & 0xFF
        return 0
    
    def rw(self, addr):
        addr &= 0xFFFFFF
        b1 = self.rb(addr)
        b2 = self.rb(addr + 1)
        return (b1 << 8) | b2
    
    def rl(self, addr):
        addr &= 0xFFFFFF
        b1 = self.rb(addr)
        b2 = self.rb(addr + 1)
        b3 = self.rb(addr + 2)
        b4 = self.rb(addr + 3)
        return (b1 << 24) | (b2 << 16) | (b3 << 8) | b4
    
    def wb(self, addr, val):
        addr &= 0xFFFFFF
        self.mem[addr] = val & 0xFF
    
    def ww(self, addr, val):
        addr &= 0xFFFFFF
        self.wb(addr, (val >> 8) & 0xFF)
        self.wb(addr + 1, val & 0xFF)
    
    def wl(self, addr, val):
        addr &= 0xFFFFFF
        self.wb(addr, (val >> 24) & 0xFF)
        self.wb(addr + 1, (val >> 16) & 0xFF)
        self.wb(addr + 2, (val >> 8) & 0xFF)
        self.wb(addr + 3, val & 0xFF)
    
    # ── ALU flags ──
    
    def set_nz(self, val, size=32):
        if size == 8:
            self.flags['n'] = 1 if (val & 0x80) else 0
            self.flags['z'] = 1 if (val & 0xFF) == 0 else 0
        elif size == 16:
            self.flags['n'] = 1 if (val & 0x8000) else 0
            self.flags['z'] = 1 if (val & 0xFFFF) == 0 else 0
        else:
            self.flags['n'] = 1 if (val & 0x80000000) else 0
            self.flags['z'] = 1 if val == 0 else 0
    
    def cond(self, cc):
        """68000 condition code evaluation."""
        n, z, v, c = self.flags['n'], self.flags['z'], self.flags['v'], self.flags['c']
        conds = {
            0x0: True,           # T
            0x1: False,          # F
            0x2: not c and not z,# HI
            0x3: c or z,         # LS
            0x4: not c,          # CC/HS
            0x5: c,              # CS/LO
            0x6: not z,          # NE
            0x7: z,              # EQ
            0x8: not v,          # VC
            0x9: v,              # VS
            0xa: not n,          # PL
            0xb: n,              # MI
            0xc: not (n ^ v),    # GE
            0xd: n ^ v,          # LT
            0xe: not (z or (n ^ v)),  # GT
            0xf: z or (n ^ v),   # LE
        }
        return conds.get(cc, False)
    
    # ── Effective Address decoding ──
    
    def decode_ea(self, mode, reg, size=32):
        """
        Decode effective address and return (value, next_pc_offset).
        mode: 3-bit mode field
        reg: 3-bit register field
        size: operand size (8, 16, 32)
        Returns (address_or_value, is_register, extra_words)
        Where is_register=True means the value is directly in a register
        """
        if mode == 0:  # Dn
            return ('d', reg, 0)
        elif mode == 1:  # An
            return ('a', reg, 0)
        elif mode == 2:  # (An)
            return ('m', self.get_a(reg), 0)  # memory at An
        elif mode == 3:  # (An)+
            val = self.get_a(reg)
            if size == 8:
                self.set_a(reg, val + 1)
            elif size == 16:
                self.set_a(reg, val + 2)
            else:
                self.set_a(reg, val + 4)
            return ('m', val, 0)
        elif mode == 4:  # -(An)
            if size == 8:
                self.set_a(reg, self.get_a(reg) - 1)
            elif size == 16:
                self.set_a(reg, self.get_a(reg) - 2)
            else:
                self.set_a(reg, self.get_a(reg) - 4)
            return ('m', self.get_a(reg), 0)
        elif mode == 5:  # d(An)
            disp = sign_extend(self.fetch_word(), 16)
            return ('m', self.get_a(reg) + disp, 2)
        elif mode == 6:  # d(An, Xi)
            disp = sign_extend(self.fetch_word() & 0xFF, 8)
            return ('m', self.get_a(reg) + disp, 2)
        elif mode == 7:
            if reg == 0:  # (xxx).W = Absolute Short
                addr = sign_extend(self.fetch_word(), 16)
                return ('m', addr, 2)
            elif reg == 1:  # (xxx).L = Absolute Long
                addr = self.fetch_long()
                return ('m', addr, 4)
            elif reg == 2:  # d(PC)
                disp = sign_extend(self.fetch_word(), 16)
                return ('m', self.pc + disp, 2)
            elif reg == 3:  # d(PC, Xi)
                ext = self.fetch_word()
                disp = sign_extend(ext & 0xFF, 8)
                idx_reg = (ext >> 12) & 7
                idx_is_a = (ext >> 15) & 1
                idx_val = self.get_a(idx_reg) if idx_is_a else self.get_d(idx_reg)
                idx_val = sign_extend(idx_val & 0xFFFF, 16)  # word index
                return ('m', self.pc + disp + idx_val, 2)
            elif reg == 4:  # #imm (immediate)
                if size == 8:
                    return ('i', self.fetch_word() & 0xFF, 2)
                elif size == 16:
                    return ('i', self.fetch_word(), 2)
                else:
                    return ('i', self.fetch_long(), 4)
            else:
                raise ValueError(f"Unknown EA mode=7 reg={reg}")
        else:
            raise ValueError(f"Unknown EA mode={mode}")
    
    def read_ea_value(self, ea_info, size=32):
        """Read value from effective address."""
        typ, val, _ = ea_info
        if typ == 'd':
            rv = self.get_d(val)
            if size == 8: return rv & 0xFF
            if size == 16: return rv & 0xFFFF
            return rv
        elif typ == 'a':
            rv = self.get_a(val)
            if size == 16: return rv & 0xFFFF
            return rv
        elif typ == 'i':
            return val
        elif typ == 'm':
            if size == 8: return self.rb(val)
            if size == 16: return self.rw(val)
            return self.rl(val)
        return 0
    
    def write_ea_value(self, ea_info, value, size=32):
        """Write value to effective address."""
        typ, val, _ = ea_info
        if typ == 'd':
            if size == 8:
                self.set_d(val, (self.get_d(val) & ~0xFF) | (value & 0xFF))
            elif size == 16:
                self.set_d(val, (self.get_d(val) & ~0xFFFF) | (value & 0xFFFF))
            else:
                self.set_d(val, value)
        elif typ == 'm':
            if size == 8:
                self.wb(val, value)
            elif size == 16:
                self.ww(val, value)
            else:
                self.wl(val, value)
    
    def ea_address(self, ea_info):
        """Get address from EA (for memory EAs)."""
        typ, val, _ = ea_info
        if typ == 'm':
            return val
        return None
    
    # ── Instruction fetch ──
    
    def fetch_word(self):
        """Read word at PC, advance PC by 2."""
        v = (self.code[self.pc - self.code_base] << 8) | \
            self.code[self.pc - self.code_base + 1]
        self.pc += 2
        return v
    
    def fetch_long(self):
        """Read longword at PC, advance PC by 4."""
        v = (self.code[self.pc - self.code_base] << 24) | \
            self.code[self.pc - self.code_base + 1] << 16 | \
            self.code[self.pc - self.code_base + 2] << 8 | \
            self.code[self.pc - self.code_base + 3]
        self.pc += 4
        return v
    
    def peek_word(self):
        """Read word at PC without advancing."""
        return (self.code[self.pc - self.code_base] << 8) | \
               self.code[self.pc - self.code_base + 1]
    
    # ── Execution ──
    
    def run(self, callback_a4=None):
        """Execute until RTS or halt."""
        self.callback_a4 = callback_a4
        
        while not self.halted and self.instr_count < self.max_instr:
            self.instr_count += 1
            if self.pc < self.code_base or self.pc >= self.code_base + self.code_size:
                if self.pc == 0 or self.r(15) == 0:
                    break
                # Fall through — might be in a callback
                break
            
            op = self.fetch_word()
            self.execute(op)
        
        return self.instr_count
    
    def execute(self, op):
        """Execute a single instruction given its first word."""
        major = (op >> 12) & 0xF
        
        # Dispatch by major opcode group
        if major == 0x0:
            self._group_0(op)
        elif major == 0x1:
            self._group_1(op)
        elif major == 0x2:
            self._group_2(op)
        elif major == 0x3:
            self._group_3(op)
        elif major == 0x4:
            self._group_4(op)
        elif major == 0x5:
            self._group_5(op)
        elif major == 0x6:
            self._group_6(op)
        elif major == 0x7:
            self._group_7(op)
        elif major == 0x8:
            self._group_8(op)
        elif major == 0x9:
            self._group_9(op)
        elif major == 0xa:
            self._group_a(op)
        elif major == 0xb:
            self._group_b(op)
        elif major == 0xc:
            self._group_c(op)
        elif major == 0xd:
            self._group_d(op)
        elif major == 0xe:
            self._group_e(op)
        elif major == 0xf:
            self._group_f(op)
    
    def _group_0(self, op):
        """Group 0: Bit manipulation, immediate, etc."""
        sub = (op >> 8) & 0xF
        
        if sub == 0x0 and (op & 0xFF) < 0x40:
            # OR immediate to CCR/SR
            size = 8 if (op & 0x00C0) == 0x0040 else 16
            self.pc -= 2  # un-fetch
            immediate = self.fetch_word()
            self.fetch_word()  # skip the rest
            return
        
        if (op & 0xF3FF) == 0x4200:  # CLR
            mode = (op >> 3) & 7
            reg = op & 7
            size_code = (op >> 6) & 3
            sizes = {0: 8, 1: 16, 2: 32}
            size = sizes.get(size_code, 32)
            ea = self.decode_ea(mode, reg, size)
            self.write_ea_value(ea, 0, size)
            self.flags['n'] = 0
            self.flags['z'] = 1
            self.flags['v'] = 0
            self.flags['c'] = 0
            return
        
        if op == 0x4a42:  # tst.w d2
            self.set_nz(self.get_d(2), 16)
            self.flags['v'] = 0
            self.flags['c'] = 0
            return
        
        if op == 0x48c4:  # ext.l d4
            val = self.get_d(4) & 0xFFFF
            self.set_d(4, sign_extend(val, 16))
            self.set_nz(self.get_d(4), 32)
            return
        
        if op == 0x48e7:  # MOVEM.L regs, -(A7)
            mask = self.fetch_word()
            count = bin(mask & 0xFFFF).count('1')
            sp = self.get_a(7)
            for r in range(15, -1, -1):
                if mask & (1 << r):
                    sp -= 4
                    if r < 8:
                        self.wl(sp, self.get_d(r))
                    else:
                        self.wl(sp, self.get_a(r - 8))
            self.set_a(7, sp)
            return
        
        if op == 0x4cdf:  # MOVEM.L (A7)+, regs
            mask = self.fetch_word()
            sp = self.get_a(7)
            for r in range(16):
                if mask & (1 << r):
                    if r < 8:
                        self.set_d(r, self.rl(sp))
                    else:
                        self.set_a(r - 8, self.rl(sp))
                    sp += 4
            self.set_a(7, sp)
            return
        
        # ORI, ANDI, SUBI, ADDI to CCR
        # Skip these
        for _ in range(4):
            self.pc -= 2
            break
        # Just skip 2 more bytes
        self.pc += 2
        return
    
    def _group_1(self, op):
        """Group 1: MOVE byte, MOVEP."""
        # MOVE.B <ea>, Dn
        reg = (op >> 9) & 7
        mode = (op >> 3) & 7
        rm = op & 7  # register in mode
        ea = self.decode_ea(mode, rm, 8)
        val = self.read_ea_value(ea, 8)
        self.set_d(reg, (self.get_d(reg) & ~0xFF) | (val & 0xFF))
        self.set_nz(val, 8)
        self.flags['v'] = 0
        self.flags['c'] = 0
        
        # Handle BSR/JSR specially
        if op == 0x6136:  # bsr.b
            disp = sign_extend(self.code[self.pc - self.code_base], 8)
            self.pc += 1
            sp = self.get_a(7) - 4
            self.wl(sp, self.pc)
            self.set_a(7, sp)
            self.pc += disp
            return
        
        if op == 0x6108:  # bsr.b
            disp = sign_extend(self.code[self.pc - self.code_base], 8)
            self.pc += 1
            sp = self.get_a(7) - 4
            self.wl(sp, self.pc)
            self.set_a(7, sp)
            self.pc += disp
            return
        
        if op == 0x6114:  # bsr.b
            disp = sign_extend(self.code[self.pc - self.code_base], 8)
            self.pc += 1
            sp = self.get_a(7) - 4
            self.wl(sp, self.pc)
            self.set_a(7, sp)
            self.pc += disp
            return
        
        if op == 0x611e:  # bsr.b
            disp = sign_extend(self.code[self.pc - self.code_base], 8)
            self.pc += 1
            sp = self.get_a(7) - 4
            self.wl(sp, self.pc)
            self.set_a(7, sp)
            self.pc += disp
            return
        
        if op == 0x6124:  # bsr.b
            disp = sign_extend(self.code[self.pc - self.code_base], 8)
            self.pc += 1
            sp = self.get_a(7) - 4
            self.wl(sp, self.pc)
            self.set_a(7, sp)
            self.pc += disp
            return
        
        if op == 0x4e94:  # jsr (a4)
            self._jsr_a4()
            return
        
        if op == 0x4e91:  # jsr (a1)
            self._jsr_a1()
            return
        
        if op == 0x4e75:  # rts
            sp = self.get_a(7)
            self.pc = self.rl(sp)
            self.set_a(7, sp + 4)
            return
        
        if op == 0x4e4e:  # (trap) — might appear as data
            return
        
        # Other group 1: handle as MOVE.B from <ea> to Dn
        # Already handled above
        return
    
    def _group_2(self, op):
        """Group 2: MOVE.L, MOVE.W."""
        size = 32 if (op & 0x1000) else 16
        dest_reg = (op >> 9) & 7
        mode = (op >> 3) & 7
        rm = op & 7
        
        if mode == 1:  # MOVE An -> ...
            val = self.get_a(rm)
            if size == 16:
                val &= 0xFFFF
        else:
            ea = self.decode_ea(mode, rm, size)
            val = self.read_ea_value(ea, size)
        
        # Destination: always Dn or An
        if op & 0x2000:  # destination is An (MOVE to A)
            self.set_a(dest_reg, val)
            if size == 16:
                self.set_nz(val, 32)
        else:
            self.set_d(dest_reg, val)
            if size == 16:
                self.set_d(dest_reg, self.get_d(dest_reg) & 0xFFFF)
            self.set_nz(val, size)
        
        self.flags['v'] = 0
        self.flags['c'] = 0
        return
    
    def _group_3(self, op):
        """Group 3: MEA, LEA, etc."""
        # Check for LEA
        if (op & 0xF1C0) == 0x41C0:  # LEA
            mode = (op >> 3) & 7
            reg = op & 7
            ea = self.decode_ea(mode, reg, 32)
            addr = self.ea_address(ea)
            dest_reg = (op >> 9) & 7
            self.set_a(dest_reg, addr)
            return
        
        # CHK, otherwise
        # Might be MOVE.W to/from CCR
        self.pc += 2  # skip extension word
        return
    
    def _group_4(self, op):
        """Group 4: LEA (already in group 3), CHK, etc."""
        # Actually LEA is 0x41C0-0x43FF which is group 4
        if (op & 0xF1C0) == 0x41C0:
            mode = (op >> 3) & 7
            reg = op & 7
            ext = 0
            if mode == 5 or (mode == 7 and reg in (0, 2)):  # d(An) or d(PC)
                ext = 2
            elif mode == 6 or (mode == 7 and reg == 3):  # d(An, Xi) or d(PC, Xi)
                ext = 2
            elif mode == 7 and reg == 1:  # (xxx).L
                ext = 4
            # Read extension words
            for _ in range(ext // 2):
                self.fetch_word()
            
            # Actually let me compute the EA more carefully
            ea_mode = (op >> 3) & 7
            ea_reg = op & 7
            dest_reg = (op >> 9) & 7
            
            if ea_mode == 2:  # (An)
                addr = self.get_a(ea_reg)
            elif ea_mode == 5:  # d(An)
                disp = sign_extend(self.code[self.pc - self.code_base], 16)
                self.pc += 2
                addr = self.get_a(ea_reg) + disp
            elif ea_mode == 7 and ea_reg == 1:  # (xxx).L
                addr = (self.code[self.pc - self.code_base] << 24) | \
                       self.code[self.pc - self.code_base + 1] << 16 | \
                       self.code[self.pc - self.code_base + 2] << 8 | \
                       self.code[self.pc - self.code_base + 3]
                self.pc += 4
            elif ea_mode == 7 and ea_reg == 2:  # d(PC)
                disp = sign_extend(self.code[self.pc - self.code_base], 16)
                self.pc += 2
                addr = self.pc + disp
            elif ea_mode == 7 and ea_reg == 3:  # d(PC, Xi)
                ext = self.code[self.pc - self.code_base] << 8 | \
                      self.code[self.pc - self.code_base + 1]
                self.pc += 2
                disp = sign_extend(ext & 0xFF, 8)
                idx_reg = (ext >> 12) & 7
                idx_is_a = (ext >> 15) & 1
                idx_val = self.get_a(idx_reg) if idx_is_a else self.get_d(idx_reg)
                idx_val = sign_extend(idx_val & 0xFFFF, 16)
                addr = self.pc + disp + idx_val
            else:
                raise ValueError(f"LEA unknown mode={ea_mode} reg={ea_reg}")
            
            self.set_a(dest_reg, addr & 0xFFFFFF)
            return
        
        # Other group 4
        self.pc += 2
        return
    
    def _group_5(self, op):
        """Group 5: ADDA, SUBA, etc."""
        sub = (op >> 6) & 0x3
        
        if sub == 3:  # SUBA
            size = 32 if (op & 0x100) else 16
            mode = (op >> 3) & 7
            reg = op & 7
            dest = (op >> 9) & 7
            
            ea = self.decode_ea(mode, reg, size)
            val = self.read_ea_value(ea, size)
            result = self.get_a(dest) - val
            self.set_a(dest, result)
            return
        
        # ADDA
        size = 32 if (op & 0x100) else 16
        mode = (op >> 3) & 7
        reg = op & 7
        dest = (op >> 9) & 7
        
        ea = self.decode_ea(mode, reg, size)
        val = self.read_ea_value(ea, size)
        result = self.get_a(dest) + val
        self.set_a(dest, result)
        return
    
    def _group_6(self, op):
        """Group 6: Bcc (conditional branches)."""
        cc = (op >> 8) & 0xF
        disp8 = sign_extend(op & 0xFF, 8)
        
        if self.cond(cc):
            self.pc += disp8
        
        # Handle BRA, BSR (cc=0, 1)
        # BRA: 0x60xx
        if op == 0x6000:  # bra.w
            disp = sign_extend(self.code[self.pc - self.code_base] << 8 | \
                               self.code[self.pc - self.code_base + 1], 16)
            self.pc += 2 + disp
            return
        
        if (op & 0xFF00) == 0x6000 and op != 0x6000:  # bra.b
            disp = sign_extend(op & 0xFF, 8)
            self.pc += disp
            return
        
        # Other Bcc 
        if disp8 != 0:
            return  # handled above
        
        # If disp8 == 0, it's a word displacement
        if op & 0xFF == 0:
            disp = sign_extend(self.code[self.pc - self.code_base] << 8 | \
                               self.code[self.pc - self.code_base + 1], 16)
            self.pc += 2
            if self.cond(cc):
                self.pc += disp
        return
    
    def _group_7(self, op):
        """Group 7: MOVEQ, DBcc, TRAP, etc."""
        if (op & 0xFC00) == 0x7000:  # MOVEQ #imm, Dn
            reg = (op >> 9) & 7
            imm = sign_extend(op & 0xFF, 8)
            self.set_d(reg, imm)
            self.set_nz(imm, 32)
            self.flags['v'] = 0
            self.flags['c'] = 0
            return
        
        if (op & 0xF0F8) == 0x50C8:  # DBcc Dn, label
            cc = (op >> 8) & 0xF
            reg = op & 7
            disp = sign_extend(self.code[self.pc - self.code_base] << 8 | \
                               self.code[self.pc - self.code_base + 1], 16)
            self.pc += 2
            
            # Decrement counter
            val = self.get_d(reg) & 0xFFFF
            val = (val - 1) & 0xFFFF
            self.set_d(reg, (self.get_d(reg) & ~0xFFFF) | val)
            
            if val != 0xFFFF:
                if not self.cond(cc):
                    self.pc += disp
            return
        
        if op == 0x51c8:  # DBF D0
            disp = sign_extend(self.code[self.pc - self.code_base] << 8 | \
                               self.code[self.pc - self.code_base + 1], 16)
            self.pc += 2
            val = self.get_d(0) & 0xFFFF
            val = (val - 1) & 0xFFFF
            self.set_d(0, (self.get_d(0) & ~0xFFFF) | val)
            if val != 0xFFFF:
                self.pc += disp
            return
        
        # TRAP, etc.
        return
    
    def _group_8(self, op):
        """Group 8: OR, DIV, SBCD."""
        # SUBQ, ADDQ
        if (op & 0xFE00) == 0x5000:  # ADDQ
            data = ((op >> 9) - 1) & 7
            if data == 0: data = 8
            mode = (op >> 3) & 7
            reg = op & 7
            size = 32 if (op & 0x0100) else (16 if (op & 0x0040) else 8)
            ea = self.decode_ea(mode, reg, size)
            val = self.read_ea_value(ea, size)
            result = val + data
            self.write_ea_value(ea, result, size)
            self.set_nz(result, size)
            self.flags['v'] = self._calc_v_add(val, data, size)
            self.flags['c'] = self._calc_c_add(val, data, size)
            return
        
        if (op & 0xFE00) == 0x5200:  # SUBQ
            data = ((op >> 9) - 1) & 7
            if data == 0: data = 8
            mode = (op >> 3) & 7
            reg = op & 7
            size = 32 if (op & 0x0100) else (16 if (op & 0x0040) else 8)
            ea = self.decode_ea(mode, reg, size)
            val = self.read_ea_value(ea, size)
            result = val - data
            self.write_ea_value(ea, result, size)
            self.set_nz(result, size)
            self.flags['v'] = self._calc_v_sub(val, data, size)
            self.flags['c'] = self._calc_c_sub(val, data, size)
            return
        
        # Other
        return
    
    def _calc_v_add(self, a, b, size):
        max_val = (1 << (size - 1)) - 1
        result = (a + b) & ((1 << size) - 1)
        if a > max_val and b > max_val:
            return 1
        if a <= max_val and b <= max_val and result > max_val:
            return 1
        return 0
    
    def _calc_c_add(self, a, b, size):
        max_unsigned = (1 << size)
        return 1 if (a + b) >= max_unsigned else 0
    
    def _calc_v_sub(self, a, b, size):
        max_val = (1 << (size - 1)) - 1
        result = (a - b) & ((1 << size) - 1)
        if a > max_val and result <= max_val:
            return 1
        if a <= max_val and result > max_val:
            return 1
        return 0
    
    def _calc_c_sub(self, a, b, size):
        return 1 if a < b else 0
    
    def _group_9(self, op):
        """Group 9: SUB, SUBX."""
        # SUB
        mode = (op >> 3) & 7
        reg = op & 7
        size = 32 if (op & 0x100) else (16 if (op & 0x040) else 8)
        ea = self.decode_ea(mode, reg, size)
        src_val = self.read_ea_value(ea, size)
        
        dest_reg = (op >> 9) & 7
        dest_val = self.get_d(dest_reg)
        
        result = dest_val - src_val
        self.set_d(dest_reg, result)
        self.set_nz(result, size)
        self.flags['v'] = self._calc_v_sub(dest_val, src_val, size)
        self.flags['c'] = self._calc_c_sub(dest_val, src_val, size)
        self.flags['x'] = self.flags['c']
        return
    
    def _group_a(self, op):
        """Group A."""
        self.pc += 2
        return
    
    def _group_b(self, op):
        """Group B: CMP, CMPA, EOR."""
        # CMP
        mode = (op >> 3) & 7
        reg = op & 7
        size = 32 if (op & 0x100) else (16 if (op & 0x040) else 8)
        ea = self.decode_ea(mode, reg, size)
        src_val = self.read_ea_value(ea, size)
        
        dest_reg = (op >> 9) & 7
        dest_val = self.get_d(dest_reg)
        
        result = dest_val - src_val
        self.set_nz(result, size)
        self.flags['v'] = self._calc_v_sub(dest_val, src_val, size)
        self.flags['c'] = self._calc_c_sub(dest_val, src_val, size)
        return
    
    def _group_c(self, op):
        """Group C: AND, OR, ADD, etc."""
        # ADD
        mode = (op >> 3) & 7
        reg = op & 7
        size = 32 if (op & 0x100) else (16 if (op & 0x040) else 8)
        ea = self.decode_ea(mode, reg, size)
        src_val = self.read_ea_value(ea, size)
        
        dest_reg = (op >> 9) & 7
        dest_val = self.get_d(dest_reg)
        
        result = dest_val + src_val
        self.set_d(dest_reg, result)
        self.set_nz(result, size)
        self.flags['v'] = self._calc_v_add(dest_val, src_val, size)
        self.flags['c'] = self._calc_c_add(dest_val, src_val, size)
        self.flags['x'] = self.flags['c']
        return
    
    def _group_d(self, op):
        """Group D: ADDA (already), SUBA, ADDI, SUBI, ADDA to An."""
        # ADDA to An
        if op & 0x0100:
            size = 32
        else:
            size = 16
        mode = (op >> 3) & 7
        reg = op & 7
        dest = (op >> 9) & 7
        ea = self.decode_ea(mode, reg, size)
        val = self.read_ea_value(ea, size)
        result = self.get_a(dest) + val
        self.set_a(dest, result)
        return
    
    def _group_e(self, op):
        """Group E."""
        self.pc += 2
        return
    
    def _group_f(self, op):
        """Group F."""
        self.pc += 2
        return
    
    def _jsr_a4(self):
        """JSR (A4) — chain resolver callback."""
        if self.callback_a4:
            self.callback_a4(self)
        # Simulate return from jsr
        # We just return — the callback modifies registers directly
    
    def _jsr_a1(self):
        """JSR (A1) — call the address in A1."""
        target = self.get_a(1)
        sp = self.get_a(7) - 4
        self.wl(sp, self.pc)
        self.set_a(7, sp)
        
        # Check if target is S_3 BSS (4 bytes of zeros)
        # On Amiga, this would crash or fall through to S_4
        # In our emulator, just return immediately
        pass
