# Pixel comparison of screenshot pairs <name>-a.png / <name>-b.png in a folder (a: the page as its own document,
# b: the published fragment inside the host's document). Prints one line per pair that differs and a summary line
# "<same> pairs identical, <near> pairs within 2 levels, <diff> pairs differ" (within 2 levels: every pixel is within
# 2 of 255 levels of its counterpart, which no eye sees).
import sys, glob, os
from PIL import Image, ImageChops
import numpy as np
d = sys.argv[1]
same = diff = near = 0
for a in sorted(glob.glob(os.path.join(d, '*-a.png'))):
    b = a[:-6] + '-b.png'
    name = os.path.basename(a)[:-6]
    if not os.path.exists(b):
        diff += 1; print(f'MISSING {name}'); continue
    ia, ib = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    if ia.size != ib.size:
        diff += 1; print(f'SIZE {name}: {ia.size} vs {ib.size}'); continue
    x = np.asarray(ImageChops.difference(ia, ib)).max(axis=2)
    n = int((x > 0).sum())
    if n == 0:
        same += 1
    elif int(x.max()) <= 2:
        # the same picture; a few edge pixels of rounded corners come out one or two levels (of 255) apart from one drawing to the next
        near += 1; print(f'NEAR {name}: {n} pixels of {x.size} differ by at most {int(x.max())} of 255 levels')
    else:
        diff += 1; ys, xs = np.nonzero(x > 2)
        print(f'DIFF {name}: {int((x > 2).sum())} pixels of {x.size} differ by more than 2 levels, largest step {int(x.max())}, box x {xs.min()}..{xs.max()} y {ys.min()}..{ys.max()}')
print(f'{same} pairs identical, {near} pairs within 2 levels, {diff} pairs differ')
