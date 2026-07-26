
	INCDIR	Includes:
	INCLUDE	whdload.i
	INCLUDE	whdmacros.i
	INCLUDE	lvo/dos.i

	IFD BARFLY
	OUTPUT	"BlackCrypt.Slave"
	BOPT	O+		;enable optimizing
	BOPT	OG+		;enable optimizing
	BOPT	ODd-		;disable mul optimizing
	BOPT	ODe-		;disable mul optimizing
	BOPT	w4-		;disable 64k warnings
	BOPT	wo-		;disable optimize warnings
	SUPER
	ENDC

; ── Character record offsets (from A5+0x1758 base) ──
; Character records are 0xA8 (168) bytes each, 4 characters total.
; From trainer code analysis (see _InGameTrainer):
;   +$00..$03: name (4 chars?)
;   +$4E: current HP (word)
;   +$50: max HP (word)
;   +$52: experience (long)
;   +$56: gold (word)
;   +$5E: some capped stat (cmp #63, inc)
;   +$64: current STR (byte)
;   +$65: current INT (byte)
;   +$66: current WIS (byte)
;   +$67: current CON (byte)
;   +$68: current CHR (byte)
;   +$6E: max STR (byte)
;   +$6F: max INT (byte)
;   +$70: max WIS (byte)
;   +$71: max CON (byte)
;   +$72: max CHR (byte)
;   +$A2: level/XP-related (word, +100 per trainer use)
; The 4 character records are at offsets: +0, +$A8, +$150, +$1F8 from $1758(A5)

	IFD BARFLY
	OUTPUT	"BlackCrypt.Slave"
	BOPT	O+		;enable optimizing
	BOPT	OG+		;enable optimizing
	BOPT	ODd-		;disable mul optimizing
	BOPT	ODe-		;disable mul optimizing
	BOPT	w4-		;disable 64k warnings
	BOPT	wo-		;disable optimize warnings
	SUPER
	ENDC

;============================================================================
;_Flash1
;_Flash2
;_Flash3		; AFTER LOAD GAME
;_Flash4
;_Flash5		; before install trainer

CHIPMEMSIZE	=	$80000*2
FASTMEMSIZE	=	$20000*1
NUMDRIVES	= 1
WPDRIVES	= 	1111

QUIT_AFTER_PROGRAM_EXIT
BLACKSCREEN
;BOOTBLOCK
BOOTDOS
;BOOTEARLY
CBDOSLOADSEG
;CBDOSREAD
;CACHE
;DEBUG
;DISKSONBOOT
DOSASSIGN
;FONTHEIGHT	=	8
HDINIT
HRTMON
IOCACHE		=	170953
;MEMFREE	=	$200
;NEEDFPU
;POINTERTICKS	=	1
;SETPATCH
;STACKSIZE	=	6000
;TRDCHANGEDISK

;============================================================================

slv_Version	=	17
slv_Flags	=	WHDLF_NoError|WHDLF_Examine|WHDLF_NoKbd
slv_keyexit	=	$59	;F10

;============================================================================

	INCLUDE	Sources:whdload/kick13.s

;============================================================================

	IFD BARFLY
	IFND	.passchk
	DOSCMD	"WDate	>T:date"
.passchk
	ENDC
	ENDC

slv_CurrentDir	dc.b	"data",0
slv_name	dc.b	"Black Crypt",0
slv_copy	dc.b	"1992 Raven Software.",0
slv_info	dc.b	"Coded by C-Fou!",10
	dc.b	"Version 2.1 "
	IFD BARFLY
	INCBIN	"T:date"
	ENDC
	dc.b	0
slv_config
		dc.b	"C1:B:Remove manual protection;"
		dc.b	"C2:B:Enable in game cheat keys;",0
		dc.b 	0

        EVEN
;============================================================================
; like a program from "startup-sequence" executed, full dos process,
; HDINIT is required

; the following example is extensive because it preserves all registers and
; is able to start BCPL programs and programs build by MANX Aztec-C
;
; usually a simpler routine is sufficient, check kick31.asm for an simpler one
;
; D0 = ULONG argument line length, including LF
; D2 = ULONG stack size
; D4 = D0
; A0 = CPTR	argument line
; A1 = APTR	BCPL stack, low end
; A2 = APTR	BCPL
; A4 = APTR	return address, frame (A7+4)
; A5 = BPTR	BCPL
; A6 = BPTR	BCPL
; (SP)	return address
; (4,SP)	stack size
; (8,SP)	previous stack frame -> +4 = A1,A2,A5,A6

	IFD BOOTDOS

_bootdos	lea	(_saveregs,pc),a0
		movem.l	d1-d3/d5-d7/a1-a2/a4-a6,(a0)
		move.l	(a7)+,(11*4,a0)
		move.l	(_resload,pc),a2	;A2 = resload

		movem.l	d0-a6,-(a7)
		;get tags
		lea	(_tag,pc),a0
		move.l	_resload(pc),a2
		jsr	(resload_Control,a2)
		movem.l	(a7)+,d0-a6

	;open doslib
		lea	(_dosname,pc),a1
		move.l	(4),a6
		jsr	(_LVOOldOpenLibrary,a6)
		lea	(_dosbase,pc),a0
		move.l	d0,(a0)
		move.l	d0,a6			;A6 = dosbase

	;assigns
		lea	(_disk1b,pc),a0
		sub.l	a1,a1
		bsr	_dos_assign
		lea	(_disk1,pc),a0
		sub.l	a1,a1
		bsr	_dos_assign
		lea	(_disk2,pc),a0
		sub.l	a1,a1
		bsr	_dos_assign
		lea	(_disk3,pc),a0
		sub.l	a1,a1
		bsr	_dos_assign
		lea	(_disk4,pc),a0
		sub.l	a1,a1
		bsr	_dos_assign

	;load exe
		lea	(_program,pc),a0
		move.l	a0,d1
		jsr	(_LVOLoadSeg,a6)
		move.l	d0,d7			;D7 = segment
		beq	.program_err

	;patch
		lea	(_pl_program,pc),a0
		move.l	d7,a1
		jsr	(resload_PatchSeg,a2)

	IFD DEBUG
	;set debug
		clr.l	-(a7)
		move.l	d7,-(a7)
		pea	WHDLTAG_DBGSEG_SET
		move.l	a7,a0
		jsr	(resload_Control,a2)
		add.w	#12,a7
	ENDC

	;call
		move.l	d7,d1
		moveq	#_args_end-_args,d0
		lea	(_args,pc),a0
		bsr	.call

	IFD QUIT_AFTER_PROGRAM_EXIT
		pea	TDREASON_OK
		move.l	(_resload,pc),a2
		jmp	(resload_Abort,a2)
	ELSE
	;remove exe
		move.l	d7,d1
		move.l	(_dosbase,pc),a6
		jsr	(_LVOUnLoadSeg,a6)

	;return to CLI
		moveq	#0,d0
		move.l	(_saverts,pc),-(a7)
		rts
	ENDC

.program_err	jsr	(_LVOIoErr,a6)
		pea	(_program,pc)
		move.l	d0,-(a7)
		pea	TDREASON_DOSREAD
		jmp	(resload_Abort,a2)

; D0 = ULONG arg length
; D1 = BPTR	segment
; A0 = CPTR	arg string

.call		lea	(_callregs,pc),a1
		movem.l	d2-d7/a2-a6,(a1)
		move.l	(a7)+,(11*4,a1)
		move.l	d0,d4
		lsl.l	#2,d1
		move.l	d1,a3
		move.l	a0,a4
	;create longword aligend copy of args
		lea	(_callargs,pc),a1
		move.l	a1,d2
.callca		move.b	(a0)+,(a1)+
		subq.w	#1,d0
		bne	.callca
	;set args
		move.l	(_dosbase,pc),a6
		jsr	(_LVOInput,a6)
		lsl.l	#2,d0		;BPTR -> APTR
		move.l	d0,a0
		lsr.l	#2,d2		;APTR -> BPTR
		move.l	d2,(fh_Buf,a0)
		clr.l	(fh_Pos,a0)
		move.l	d4,(fh_End,a0)
	;call
		move.l	d4,d0
		move.l	a4,a0
		movem.l	(_saveregs,pc),d1-d3/d5-d7/a1-a2/a4-a6
		jsr	(4,a3)
	;return
		movem.l	(_callregs,pc),d2-d7/a2-a6
		move.l	(_callrts,pc),a0
		jmp	(a0)

	IFD SIMPLE_CALL
.call		lsl.l	#2,d1
		move.l	d1,a3
		jmp	(4,a3)
	ENDC

_pl_program	PL_START
		PL_END

_disk1b		dc.b	"DF0",0		;for Assign
_disk1		dc.b	"GAMEDISK1",0		;for Assign
_disk2		dc.b	"GAMEDISK2",0		;for Assign
_disk3		dc.b	"GAMEDISK3",0		;for Assign
_disk4		dc.b	"GAMESAVE",0		;for Assign


_program	dc.b	"BlackCrypt",0
_args		dc.b	"",10	;must be LF terminated
_args_end
	EVEN

	CNOP 0,4
_saveregs	ds.l	11
_saverts	dc.l	0
_dosbase	dc.l	0
_callregs	ds.l	11
_callrts	dc.l	0
_callargs	ds.b	208

	ENDC
 
;============================================================================
; callback/hook which gets executed after each successful call to dos.LoadSeg
; can also be used instead of _bootdos, requires the presence of
; "startup-sequence"

; the following example uses a parameter table to patch different executables
; after they get loaded

	IFD CBDOSLOADSEG

; D0 = BSTR name of the loaded program as BCPL string
; D1 = BPTR segment list of the loaded program as BCPL pointer

_cb_dosLoadSeg	lsl.l	#2,d0	;-> APTR
	move.l	d0,a0
	moveq	#0,d0
	move.b	(a0)+,d0	;D0 = name length
	;remove leading path
	move.l	a0,a1
	move.l	d0,d2
.2	move.b	(a1)+,d3
	subq.l	#1,d2
	cmp.b	#":",d3
	beq	.1
	cmp.b	#"/",d3
	beq	.1
	tst.l	d2
	bne	.2
	bra	.3
.1	move.l	a1,a0	;A0 = name
	move.l	d2,d0	;D0 = name length
	bra	.2
.3	;get hunk length sum
	move.l	d1,a1	;D1 = segment
	moveq	#0,d2
.add	add.l	a1,a1
	add.l	a1,a1
	add.l	(-4,a1),d2	;D2 = hunks length
	subq.l	#8,d2	;hunk header
	move.l	(a1),a1
	move.l	a1,d7
	bne	.add
	;search patch
	lea	(.patch,pc),a1
.next	move.l	(a1)+,d3
	movem.w	(a1)+,d4-d5
	beq	.end
 IFD _Flash1
.t move.w	#$f0,$dff180
 btst	#6,$bfe001
 bne	.t
 ENDC
	cmp.l	d2,d3	;length match?
	bne	.next
 IFD _Flash2
.tt move.w	#$f00,$dff180
 btst	#6,$bfe001
 bne	.tt
 ENDC
	;compare name
	lea	(.patch,pc,d4.w),a2
	move.l	a0,a3
	move.l	d0,d6
.cmp	move.b	(a3)+,d7
	cmp.b	#"a",d7
	blo	.l
	cmp.b	#"z",d7
	bhi	.l
	sub.b	#$20,d7
.l	cmp.b	(a2)+,d7
	bne	.next
	subq.l	#1,d6
	bne	.cmp
	tst.b	(a2)
	bne	.next
	;set debug
	IFD DEBUG
	clr.l	-(a7)
	move.l	d1,-(a7)
	pea	WHDLTAG_DBGSEG_SET
	move.l	a7,a0
	move.l	(_resload,pc),a2
	jsr	(resload_Control,a2)
	move.l	(4,a7),d1
	add.w	#12,a7
	ENDC
	;patch
	lea	(.patch,pc,d5.w),a0
	move.l	d1,a1
	bsr	_crack
	move.l	(_resload,pc),a2
	jsr	(resload_PatchSeg,a2)
	;end
.end	rts

PATCH	MACRO
	dc.l	\1	;cumulated size of hunks (not filesize!)
	dc.w	\2-.patch	;name
	dc.w	\3-.patch	;patch list
	ENDM

.patch	;	PATCH	$323c,_n_run,_p_run	; BLACKCRYPT
		PATCH	$4c1ac,_n_run1,_p_run	; BCDFT
	dc.l	0

	;all upper case!
_n_run		dc.b	"BLACKCRYPT",0
	EVEN
_n_run1		dc.b	"BCDFT",0
	EVEN
_p_run		PL_START
	;	PL_P	0,.1
		PL_END

	ENDC

_crack		movem.l	d0-d7/a0-a6,-(a7)
		add.l	d1,d1
		add.l	d1,d1
		move.l	d1,a0
		move.l	a0,a1
 IFD _Flash4
.t:
	move.w	#$ff,$dff180
	btst	#6,$bfe001
	bne	.t
 ENDC
		move.l	a1,d0
		add.l	#$496c2-$4968c,d0
		move.l	d0,a0
		cmp.l	#$2f49003c,(a0)
		bne	.pas
		lea	patch(pc),a1
		move.w	#$4ef9,(a0)+
		move.l	a1,(a0)
.pas

		move.l	a1,d0
		add.l	#$496ba-$4968c,d0
		move.l	d0,a0
		cmp.l	#$2f49003c,(a0)
		bne	.pas1
		lea	patch(pc),a1
		move.w	#$4ef9,(a0)+
		move.l	a1,(a0)
.pas1		movem.l	(a7)+,d0-d7/a0-a6
		rts


_InstallTainer
 IFD _Flash5
.t:
	move.w	#$f0,$dff180
	btst	#6,$bfe001
	bne	.t
 ENDC
	bsr	_IntallInGameTrainer

	move.w	#$2378,d1
	rts

patch:

 IFD _Flash3
.t:
	move.w	#$f,$dff180
	btst	#6,$bfe001
	bne	.t
 ENDC
	movem.l	d0/a0-A1,-(a7)
	move.l	_custom2(pc),d0
	beq	.noTrainer
	move.l	a1,a0
	add.l	#$1e930,a0
	add.l	#$2812c,a1
	cmp.l	#$323c2378,(a1)
	bne	.noTrainer
	cmp.l	#$2c6d050c,(a0)
	bne	.noTrainer
	patch	$100,_InstallTainer
	move.l	#$4eb80100,(a1)
	patchs	0(a0),_InGameTrainer
	move.w	#$4e71,6(a0)
	bsr	_FlushCache
.noTrainer
	movem.l	(a7)+,d0/a0-a1


	IFD Translation
		bsr	_TakeHunkMainFile
	ENDC


		move.l	a1,a2

		move.l	_custom1(pc),d0
		tst.l	d0
		beq	.pas
		move.l	a2,a1
		add.l	#$16306,a1
		cmp.w	#$6640,(a1)
		bne	.pas
		move.w	#$4e71,(a1) ; crack game
			move.w	#$f0,$dff180
			move.w	#$f0,$dff180
			move.w	#$f0,$dff180
			move.w	#$f0,$dff180
			move.w	#$f0,$dff180
			move.w	#$f0,$dff180
.pas
		move.l	a2,a3	
		SUB.L	#4,a2
		move.l	a2,a0
		bra .first
.next
		move.l	a2,a1
		move.l	(a1),d0
		tst.l	d0
		beq .end
		lsl.l	#2,d0
		move.l	d0,a0
.first
		move.l	a0,a1
		add.l	-4(a1),a1
		move.l	a0,a2
		bsr	cherche
		bra	.next
.end
		move.l	a3,$3c(a7)
		movem.l	(a7)+,d0-d7/a0-a6
		rts

cherche
.enc		tst.w	(a0)+
		cmp.l	a0,a1
		beq	.fin
		cmp.l	#$20300800,(a0)
		bne	.enc
		move.l	#$20300000,(a0)
		move.w	#$40,$dff180
		bra	.enc
.fin		rts

;======================================================================
_FlushCache
		movem.l	d0-d1/a0-a2,-(a7)
		move.l	_resload(pc),a2
		jsr	resload_FlushCache(a2)
		movem.l	(sp)+,d0-d1/a0-a2
		rts
;======================================================================
_CRC16
		movem.l	d1/a0-a2,-(a7)
		move.l	_resload(pc),a2
		jsr	resload_CRC16(a2)
		movem.l	(sp)+,d1/a0-a2
		rts
;======================================================================
_GetFileSize	movem.l	d1/a0-a2,-(a7)
		;lea	_Highs(pc),a0
		move.l	_resload(pc),a2
		jsr	resload_GetFileSize(a2)
		movem.l	(a7)+,d1/a0-a2
		rts

;======================================================================
;======================================================================
_LoadFile	movem.l	d1/a0-a2,-(a7)
		;lea	_Highs(pc),a0
		move.l	_resload(pc),a2
		jsr	resload_LoadFileDecrunch(a2)
		movem.l	(a7)+,d1/a0-a2
		rts

;======================================================================
;======================================================================
_LoadFileOffset	movem.l	d1/a0-a2,-(a7)
		;lea	_Highs(pc),a0
		move.l	_resload(pc),a2
		jsr	resload_LoadFileOffset(a2)
		movem.l	(a7)+,d1/a0-a2
		rts

;======================================================================

_exit		pea	TDREASON_OK
		bra	_end
_debug		pea	TDREASON_DEBUG
		bra	_end
_wrongver	pea	TDREASON_WRONGVER
		bra	_end
_mustregister	pea	TDREASON_MUSTREG
_end		move.l	(_resload),-(a7)
		add.l	#resload_Abort,(a7)
		rts

;======================================================================
;======================================================================

_tag
		dc.l	WHDLTAG_CUSTOM1_GET
_custom1	dc.l	0
		dc.l	WHDLTAG_CUSTOM2_GET
_custom2	dc.l	0
		dc.l	0	; End
;======================================================================
;======================================================================




_IntallInGameTrainer
	move.l	a1,a2


	LEA	($1758,A4),A1
	LEA	(_CurrentCharactADR,PC),A6
	MOVE.L	A1,(A6)

;	LEA	(lbL00007E,PC),A6
	lea	_CharacterBASE(pc),a6
;	MOVE.L	A1,(A6)
	MOVE.L	A1,(A6)+
	LEA	($A8,A1),A1
;	MOVE.L	A1,(12,A6)
	MOVE.L	A1,(A6)+
	LEA	($A8,A1),A1
;	MOVE.L	A1,($18,A6)
	MOVE.L	A1,(A6)+
	LEA	($A8,A1),A1
;	MOVE.L	A1,($24,A6)
	MOVE.L	A1,(A6)+

	MOVEA.L	A2,A1
	RTS

_PreviousKey		dw	0

_CurrentCharactADR	dl	0

_CharacterBASE
_Charact1_BASE_ADR	dl	0
_Charact2_BASE_ADR	dl	0
_Charact3_BASE_ADR	dl	0
_Charact4_BASE_ADR	dl	0

_InGameTrainer
	MOVEM.L	D0/A0,-(SP)
	MOVEA.L	($50C,A5),A6		; original code 
	NOT.B	($515,A5)		; original code
	
	LEA	(_PreviousKey,PC),A0
	MOVE.B	($BFEC01).L,D0
	CMP.B	(A0),D0
	BEQ.W	.skip
	MOVE.B	D0,(A0)
	LEA	(_CurrentCharactADR,PC),A0

	CMPI.B	#$FD,D0		; 1
	BNE.B	.no1
	move.l	_Charact1_BASE_ADR(pc),(a0)	; select Charac1
	move.w	#$f0,$dff180
.no1

	CMPI.B	#$FB,D0		; 2
	BNE.B	.no2
	move.l	_Charact2_BASE_ADR(pc),(a0)	; select Charac2
	move.w	#$f0,$dff180
.no2

	CMPI.B	#$F9,D0		; 3
	BNE.B	.no3
	move.l	_Charact3_BASE_ADR(pc),(a0)	; select Charac3
	move.w	#$f0,$dff180
.no3

	CMPI.B	#$F7,D0		; 4
	BNE.B	.no4
	move.l	_Charact4_BASE_ADR(pc),(a0)	; select Charac4
	move.w	#$f0,$dff180
.no4

	MOVEA.L	(A0),A0
	CMPI.B	#$B5,D0
	BNE.B	.noH
	MOVE.W	($50,A0),($4E,A0)	;
	move.w	#$f0,$dff180
.noH

	CMPI.B	#$BD,D0
	BNE.B	.noS
	MOVE.B	($6E,A0),($64,A0)
	move.w	#$f0,$dff180
.noS

	CMPI.B	#$DD,D0
	BNE.B	.noW_Z
	MOVE.B	($6F,A0),($65,A0)
	move.w	#$f0,$dff180
.noW_Z

	CMPI.B	#$D1,D0
	BNE.B	.noI
	MOVE.B	($70,A0),($66,A0)
	move.w	#$f0,$dff180
.noI

	CMPI.B	#$99,D0
	BNE.B	.noC
	MOVE.B	($71,A0),($67,A0)
	move.w	#$f0,$dff180
.noC

	CMPI.B	#$BB,D0
	BNE.B	.noD
	MOVE.B	($72,A0),($68,A0)
	move.w	#$f0,$dff180
.noD

	CMPI.B	#$91,D0
	BNE.B	.noM
	MOVE.L	#$19191919,($6E,A0)
	MOVE.B	#$19,($72,A0)
	MOVE.L	#$19191919,($64,A0)
	MOVE.B	#$19,($68,A0)
	move.w	#$f0,$dff180
.noM

	CMPI.B	#$B7,D0
	BNE.B	.noG
	MOVE.W	#$2710,($56,A0)
	move.w	#$f0,$dff180
.noG

	CMPI.B	#$B9,D0
	BNE.B	.noF
	MOVE.L	#$13881388,($52,A0)
	move.w	#$f0,$dff180
.noF

	CMPI.B	#$DB,D0
	BNE.B	.noE
	ADDI.W	#$64,($A2,A0)
	move.w	#$f0,$dff180
.noE

	CMPI.B	#$AF,D0
	BNE.B	.noL
	CMPI.B	#$63,($5E,A0)
	BEQ.B	.noL
	ADDI.B	#1,($5E,A0)
	move.w	#$f0,$dff180
.noL

	CMPI.B	#$BF,D0
	BNE.B	.noQ_A
	move.l	_Charact1_BASE_ADR(pc),a0
	MOVE.W	($50,A0),($4E,A0)
	move.l	_Charact2_BASE_ADR(pc),a0
	MOVE.W	($50,A0),($4E,A0)
	move.l	_Charact3_BASE_ADR(pc),a0
	MOVE.W	($50,A0),($4E,A0)
	move.l	_Charact4_BASE_ADR(pc),a0
	MOVE.W	($50,A0),($4E,A0)
	move.w	#$f0,$dff180
.noQ_A

.skip

	MOVEM.L	(SP)+,D0/A0
	RTS

	END
	

	include	'BlackCrypt-translation.s'

	end
