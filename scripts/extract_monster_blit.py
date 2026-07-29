import re

with open('data/blackcrypt/amiga/bcdfp.asm', 'r') as f:
    lines = f.readlines()

hex_bytes = bytearray()
for i in range(3233, 3274):
    line = lines[i].strip()
    m = re.findall(r'\$([0-9a-fA-F]+)', line)
    for h in m:
        hex_bytes.extend(bytes.fromhex(h))

print(f'Extracted {len(hex_bytes)} bytes from lines 3234-3274')

with open('/tmp/monster_blit.bin', 'wb') as f:
    f.write(hex_bytes)
