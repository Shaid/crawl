/*
 * jr_decrunch.c — Standalone JR decompressor
 *
 * Implements the JR data cruncher algorithm reverse-engineered from
 * the XFD external slave binary at xfd_User/Libs/xfd/JR (528 bytes).
 *
 * ── JR Format ─────────────────────────────────────────────────────────
 *   Bytes 0-1:   magic "JR" (0x4A52)
 *   Bytes 2-3:   version/flags (usually 0x0002)
 *   Bytes 4-7:   uncompressed size, big-endian uint32
 *   Bytes 8+:    JR-compressed payload
 *
 * ── Algorithm ─────────────────────────────────────────────────────────
 * LZSS-style with variable-length codes. A 1-bit control stream
 * determines literal vs. back-reference operations.
 *
 * The bit extraction faithfully replicates the 68k sequence:
 *   add.b  D2, D2         ; shift left 1, C = old bit7, Z = (D2==0)
 *   bne.s  .skip          ; if D2 != 0, skip reload
 *   move.b (A0)+, D2      ; refill D2 from source
 *   addx.b D2, D2         ; D2 = (D2*2) + X, where X = old carry
 * .skip:                  ; C now holds the control bit
 *
 * Important: when D2 becomes 0 (triggering a reload), the C flag after
 * addx.b reflects bit7 of the NEW byte, NOT the bit that was shifted
 * out. The shifted-out bit is embedded as bit0 of the new D2 value.
 *
 * Control bits:
 *   0 → literal byte (copy one byte from source to dest)
 *   1 → reference/match with length and offset encoding
 *
 * Reference encoding:
 *   bits           meaning
 *   1,0            → short-offset mode; additional bits encode params
 *   1,1,0          → normal match, length=2
 *   1,1,1,0        → length=3
 *   1,1,1,1        → read full byte for length; if byte=0 → end; else length+=8
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *   // Decompress a JR file:
 *   size_t written = jr_decrunch(src, src_len, dst, dst_len);
 *   if (written == 0) { error; }
 *
 *   // Or from command line:
 *   ./jr_decrunch <input.jr> [output.bin]
 *
 * ── Build ─────────────────────────────────────────────────────────────
 *   gcc -O2 -o jr_decrunch jr_decrunch.c
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>

/* ==================================================================== */
/*  JR bit-read state                                                   */
/* ==================================================================== */
typedef struct {
    const uint8_t *A0;      /* source read pointer (advances)  */
    const uint8_t *A0_end;  /* source end (safety limit)       */
    uint8_t       *A1;      /* destination write pointer       */
    uint8_t       *A3;      /* destination end pointer         */
    uint8_t        D2;      /* bit buffer (8-bit)              */
} jr_state;

/* ── Extract one control bit ──────────────────────────────────────────
 *
 * Emulates the 68k sequence:
 *   add.b  D2, D2     ; D2 = D2*2, C = old bit7
 *   bne.s  .skip      ; skip reload if D2 != 0
 *   move.b (A0)+, D2  ; reload byte from source
 *   addx.b D2, D2     ; D2 = D2*2 + X (X = old carry)
 * .skip:
 *
 * Returns:  1 if carry was set, 0 if clear
 *            (this is the decoded control bit)
 *
 * Note: After a reload, the returned bit is bit7 of the NEW byte,
 * NOT the bit that was shifted out of the old D2. The shifted-out
 * bit is stored as bit0 of D2 (via addx.b's X input).
 */
static inline int jr_getbit(jr_state *st) {
    /* add.b D2, D2 — 8-bit left shift; C = old bit7; Z = (D2 == 0) */
    int carry = (st->D2 >> 7) & 1;
    st->D2 = (uint8_t)(st->D2 << 1);
    int reload = (st->D2 == 0);

    if (reload) {
        /* move.b (A0)+, D2 */
        st->D2 = (st->A0 < st->A0_end) ? *st->A0++ : 0;
        /* addx.b D2, D2 — D2 = byte*2 + old_carry */
        uint16_t tmp = (uint16_t)st->D2 + (uint16_t)st->D2 + (uint16_t)carry;
        st->D2 = (uint8_t)(tmp & 0xFF);
        carry = (tmp >> 8) & 1;  /* C = carry from addx = bit7 of loaded byte */
    }
    /* No reload: carry still = old bit7 (the bit we want) */

    return carry;
}


/* ==================================================================== */
/*  JR decompressor                                                     */
/* ==================================================================== */
/* Returns number of bytes written to dst, or 0 on error.
 * Reads from src[0..src_len-1], writes to dst[0..dst_len-1]. */
size_t jr_decrunch(const uint8_t *src, size_t src_len,
                   uint8_t *dst, size_t dst_len) {
    jr_state st;

    /* Skip 8-byte JR header */
    st.A0 = src + 8;
    st.A0_end = src + src_len;
    st.A1 = dst;
    st.A3 = dst + dst_len;
    st.D2 = 0x80;  /* $80 triggers immediate reload on first getbit */

    uint16_t D0, D1;
    uint8_t *A2;

    /* ── L016E: Main entry — first control bit ── */
    if (jr_getbit(&st))
        goto L0188;              /* 1 → reference mode */

    /* ── L0178: Literal byte copy loop ── */
L0178:
    if (st.A1 >= st.A3 || st.A0 >= st.A0_end) return 0;
    *st.A1++ = *st.A0++;

L017E:
    if (!jr_getbit(&st))
        goto L0178;              /* 0 → another literal */
    /* fall through → 1 → reference mode */

    /* ── L0188: Reference/match mode ── */
L0188:
    D1 = 2;                       /* base match length */
    D0 = 0;                       /* offset accumulator */

    if (!jr_getbit(&st))
        goto L00FE;              /* 1,0 → short-offset mode */

    /* 1,1,… */
    if (!jr_getbit(&st))
        goto L0152;              /* 1,1,0 → normal copy len=2 */

    /* 1,1,1,… */
    D1 = 3;                       /* length = 3 */
    if (!jr_getbit(&st))
        goto L0124;              /* 1,1,1,0 → length=3, build offset */

    /* 1,1,1,1 — read full byte for length */
    if (st.A0 >= st.A0_end) return 0;
    D1 = *st.A0++;
    if (D1 == 0) goto L01D6;    /* length=0 → end-of-stream check */
    D1 += 8;                      /* addq.w #8, D1 */
    goto L0124;

    /* ── L00FE: Short-offset mode ── */
L00FE:
    /* D1 started as 2; read 2 bits into D1 */
    D1 = (uint16_t)(D1 << 1) | jr_getbit(&st);  /* D1 = 4|5 */
    if (jr_getbit(&st)) {
        /* 1,1,1 — very short match */
        D1--;
        D1 = (uint16_t)(D1 << 1) | jr_getbit(&st);  /* D1 = 6-9 */
        if (D1 == 9)
            goto L00CC;          /* 1,1,1 → D1=9: long literal copy */
    }
    /* else: 1,0 — fall through to build offset with D1 = 4|5 */
    goto L0124;

    /* ── L00CC: Long literal copy ── */
L00CC:
    D1 >>= 1;                     /* lsr: 9 → 4 */
    D1--;                         /* subq: 4 → 3 */
    {
        /* Read (orig>>1) bits into D0 */
        int nbits = D1 + 1;       /* = orig>>1 = 4 */
        D0 = 0;
        for (int i = 0; i < nbits; i++)
            D0 = (D0 << 1) | jr_getbit(&st);
    }
    D1 = 3 + D0;                  /* D1 = 3 + D0 */
    D1 += D1;                     /* D1 = 2*(3+D0) words to copy */

    /* Copy D1 words (= 2*D1 bytes) from source to dest */
    {
        int nwords = D1;
        uint8_t *end = st.A1 + nwords * 2;
        if (end > st.A3) return 0;
        for (int i = 0; i < nwords; i++) {
            if (st.A0 + 1 >= st.A0_end) return 0;
            *st.A1++ = *st.A0++;
            *st.A1++ = *st.A0++;
        }
    }
    goto L017E;

    /* ── L0124: Build offset and copy back-reference ── */
L0124:
    if (!jr_getbit(&st))
        goto L0152;              /* 0 → short offset, just read offset byte */

    /* Build offset bits in D0 */
    D0 = (D0 << 1) | jr_getbit(&st);
    if (jr_getbit(&st))
        goto L01BA;              /* 1 → extended offset */

    if (D0 != 0)
        goto L0152;              /* D0 != 0, continue to build offset */

    /* D0 == 0: special case offset = 1 + extra bit */
    D0 = 1;
L0148:
    D0 = (D0 << 1) | jr_getbit(&st);

    /* ── L0152: Assemble final offset and copy ── */
L0152:
    /* rol.w #8, D0 — swap bytes of lower word */
    D0 = (uint16_t)((D0 << 8) | (D0 >> 8));
    /* move.b (A0)+, D0 — read low byte of offset */
    if (st.A0 >= st.A0_end) return 0;
    D0 = (D0 & 0xFF00) | *st.A0++;

    A2 = st.A1 - D0 - 1;          /* source = dest - offset - 1 */
    {
        uint8_t *end = st.A1 + D1;
        if (end > st.A3) return 0;
        /* Copy D1 bytes (subq + dbra pattern) */
        for (uint16_t i = 0; i < D1; i++)
            *st.A1++ = *A2++;
    }
    goto L017E;

    /* ── L01BA: Extended offset ── */
L01BA:
    D0 = (D0 << 1) | jr_getbit(&st);
    D0 |= 4;                      /* ori.w #4, D0 */
    if (jr_getbit(&st))
        goto L0152;              /* 1 → done */
    goto L0148;                  /* 0 → more bits */

    /* ── L01D6: End-of-stream check ── */
L01D6:
    if (st.A1 != st.A3) return 0;  /* buffer must be exactly filled */
    return (size_t)(st.A1 - dst);   /* success! */
}


/* ==================================================================== */
/*  Command-line driver                                                  */
/* ==================================================================== */
int main(int argc, char **argv) {
    const char *path_in  = (argc > 1) ? argv[1] : "test.jr";
    const char *path_out = (argc > 2) ? argv[2] : "test.out";
    int verbose = (argc > 3) ? atoi(argv[3]) : 1;

    /* Read input */
    FILE *f = fopen(path_in, "rb");
    if (!f) { perror("fopen input"); return 1; }
    fseek(f, 0, SEEK_END);
    long src_len = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *src = malloc(src_len);
    if (!src) { perror("malloc"); fclose(f); return 1; }
    fread(src, 1, src_len, f);
    fclose(f);

    /* Verify magic */
    if (src_len < 8 || src[0] != 'J' || src[1] != 'R') {
        fprintf(stderr, "Not a JR file (missing 'JR' magic)\n");
        free(src);
        return 1;
    }

    uint32_t dst_len = ((uint32_t)src[4] << 24) | ((uint32_t)src[5] << 16)
                     | ((uint32_t)src[6] << 8)  | (uint32_t)src[7];
    if (verbose) printf("JR: %ld → %u bytes\n", src_len, dst_len);

    if (dst_len == 0 || dst_len > 16U*1024*1024) {
        fprintf(stderr, "Bad uncompressed size: %u\n", dst_len);
        free(src);
        return 1;
    }

    uint8_t *dst = calloc(1, dst_len);
    if (!dst) { perror("calloc"); free(src); return 1; }

    size_t written = jr_decrunch(src, src_len, dst, dst_len);
    if (written == 0) {
        fprintf(stderr, "JR decompression FAILED\n");
        /* Write partial output for analysis */
        f = fopen(path_out, "wb");
        if (f) { fwrite(dst, 1, dst_len, f); fclose(f); }
        free(src); free(dst);
        return 1;
    }

    int nz = 0;
    for (size_t i = 0; i < dst_len; i++) if (dst[i]) nz++;
    if (verbose) printf("Decompressed: %zu bytes (%d non-zero)\n", written, nz);

    f = fopen(path_out, "wb");
    if (!f) { perror("fopen output"); free(src); free(dst); return 1; }
    fwrite(dst, 1, dst_len, f);
    fclose(f);
    if (verbose) printf("Wrote %u bytes to %s\n", dst_len, path_out);

    free(src);
    free(dst);
    return 0;
}
