# Faction designs: materials, bodies, animation styles and meshes for every unit variant.
# All models are original work made for this project (no third-party meshes).
import math
from mathutils import Vector
from kit import (perm_yzx, Body, P, P2, Part, rbox, cyl, sphere, ellipsoid, cut, fill_holes, lathe, torus, extrude, tube, copy,
                 mirror_x, join_bm, array, radial, jitter, xf, srgb, mat_node_setup, blend, along, M)
from anims import Style


# =============================================================================== shared hand / weapon pieces
def fist(rig, side, scale=1.0, mat='black', glove=None, bone=None):
    """Closed hand in hand-local space (y = fingers, z = back of hand). Thumb on -x for the right hand."""
    s = scale
    sx = -1 if side == 'R' else 1
    palm = rbox(0.085 * s, 0.10 * s, 0.045 * s, bev=0.018 * s, seg=2)
    xf(palm, (0, 0.055 * s, 0))
    fing = rbox(0.088 * s, 0.04 * s, 0.06 * s, bev=0.016 * s, seg=2)
    xf(fing, (0, 0.11 * s, -0.026 * s))
    knuck = rbox(0.09 * s, 0.03 * s, 0.025 * s, bev=0.01 * s)
    xf(knuck, (0, 0.10 * s, 0.018 * s))
    th = rbox(0.03 * s, 0.07 * s, 0.03 * s, bev=0.011 * s)
    xf(th, (sx * 0.05 * s, 0.05 * s, -0.025 * s), rot=(25, 0, -sx * 25))
    out = [Part(rig.to_bone(b, bone or 'hand.' + side), mat, bone or 'hand.' + side) for b in (palm, fing, th)]
    out.append(Part(rig.to_bone(knuck, bone or 'hand.' + side), glove or mat, bone or 'hand.' + side))
    return out


def G(rig, bm, mat, which='weapon', loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    xf(bm, loc, rot, scale)
    rig.to_gun(bm, which)
    return Part(bm, mat, which)


def purity_seal(rig, bind, loc, rot=(0, 0, 0), s=1.0):
    wax = cyl(0.032 * s, 0.014 * s, seg=12, bev=0.004 * s)
    xf(wax, rot=(90, 0, 0))
    xf(wax, loc, rot)
    parts = [Part(wax, 'red', bind)]
    for i, dx in enumerate((-0.012, 0.012)):
        strip = rbox(0.022 * s, 0.003 * s, 0.11 * s - i * 0.02 * s)
        xf(strip, (dx * s, 0.004, -0.07 * s - i * 0.01 * s), rot=(0, 0, (i * 2 - 1) * 6))
        xf(strip, loc, rot)
        parts.append(Part(strip, 'parchment', bind))
    return parts


# =============================================================================== guns (gun space: x right, y muzzle, z up)
def bolter(rig, which='weapon', s=1.0, mat='gunmetal', trim='trim', plasma=False):
    p = []
    p.append(G(rig, rbox(0.075 * s, 0.36 * s, 0.13 * s, bev=0.014 * s), mat, which, (0, 0.06 * s, 0.05 * s)))
    p.append(G(rig, rbox(0.05 * s, 0.22 * s, 0.03 * s, bev=0.006 * s), mat, which, (0, 0.08 * s, 0.13 * s)))
    p.append(G(rig, rbox(0.03 * s, 0.05 * s, 0.04 * s, bev=0.005 * s), 'black', which, (0, -0.03 * s, 0.155 * s)))
    if plasma:
        coil = cyl(0.05 * s, 0.24 * s, seg=16, bev=0.006 * s)
        p.append(G(rig, coil, mat, which, (0, 0.34 * s, 0.07 * s), rot=(90, 0, 0)))
        for i in range(4):
            ring = torus(0.052 * s, 0.009 * s, seg=16, seg2=6)
            p.append(G(rig, ring, 'plasma', which, (0, (0.25 + i * 0.055) * s, 0.07 * s), rot=(90, 0, 0)))
        p.append(G(rig, cyl(0.032 * s, 0.10 * s, seg=12, r2=0.026 * s), mat, which, (0, 0.50 * s, 0.07 * s), rot=(90, 0, 0)))
        p.append(G(rig, cyl(0.02 * s, 0.012 * s, seg=12), 'plasma', which, (0, 0.555 * s, 0.07 * s), rot=(90, 0, 0)))
        flask = cyl(0.035 * s, 0.13 * s, seg=12, bev=0.006 * s)
        p.append(G(rig, flask, 'plasma', which, (0.0, 0.12 * s, -0.07 * s), rot=(-20, 0, 0)))
    else:
        p.append(G(rig, rbox(0.062 * s, 0.22 * s, 0.075 * s, bev=0.012 * s), mat, which, (0, 0.33 * s, 0.07 * s)))
        p.append(G(rig, cyl(0.03 * s, 0.09 * s, seg=12), mat, which, (0, 0.48 * s, 0.07 * s), rot=(90, 0, 0)))
        p.append(G(rig, rbox(0.066 * s, 0.012 * s, 0.03 * s), 'black', which, (0, 0.47 * s, 0.07 * s)))
        p.append(G(rig, torus(0.034 * s, 0.007 * s, seg=12, seg2=6), trim, which, (0, 0.44 * s, 0.07 * s), rot=(90, 0, 0)))
        for k, (y, z, r) in enumerate(((0.12, -0.06, -8), (0.135, -0.135, -20), (0.158, -0.205, -34))):
            p.append(G(rig, rbox(0.052 * s, 0.07 * s, 0.085 * s, bev=0.01 * s), mat, which, (0, y * s, z * s), rot=(r, 0, 0)))
        p.append(G(rig, rbox(0.056 * s, 0.075 * s, 0.018 * s, bev=0.004 * s), trim, which, (0, 0.175 * s, -0.245 * s), rot=(-40, 0, 0)))
    p.append(G(rig, rbox(0.045 * s, 0.06 * s, 0.13 * s, bev=0.014 * s), 'black', which, (0, -0.015 * s, -0.06 * s), rot=(-16, 0, 0)))
    p.append(G(rig, rbox(0.012 * s, 0.07 * s, 0.012 * s), mat, which, (0, 0.035 * s, -0.035 * s)))
    p.append(G(rig, rbox(0.062 * s, 0.17 * s, 0.085 * s, bev=0.016 * s, taper=(1, 0.9)), mat, which, (0, -0.20 * s, 0.03 * s)))
    p.append(G(rig, rbox(0.066 * s, 0.03 * s, 0.10 * s, bev=0.01 * s), 'black', which, (0, -0.29 * s, 0.025 * s)))
    p.append(G(rig, rbox(0.006 * s, 0.11 * s, 0.05 * s, bev=0.002 * s), trim, which, (0.041 * s, 0.08 * s, 0.05 * s)))
    p.append(G(rig, rbox(0.006 * s, 0.11 * s, 0.05 * s, bev=0.002 * s), trim, which, (-0.041 * s, 0.08 * s, 0.05 * s)))
    p.append(G(rig, rbox(0.008 * s, 0.06 * s, 0.03 * s), 'black', which, (-0.04 * s, 0.13 * s, 0.085 * s)))
    return p


def bolt_pistol(rig, which='offhand', s=1.0, mat='gunmetal', trim='trim'):
    p = []
    p.append(G(rig, rbox(0.05 * s, 0.20 * s, 0.085 * s, bev=0.01 * s), mat, which, (0, 0.07 * s, 0.05 * s)))
    p.append(G(rig, cyl(0.022 * s, 0.06 * s, seg=10), mat, which, (0, 0.19 * s, 0.065 * s), rot=(90, 0, 0)))
    p.append(G(rig, rbox(0.04 * s, 0.055 * s, 0.12 * s, bev=0.012 * s), 'black', which, (0, -0.005 * s, -0.04 * s), rot=(-14, 0, 0)))
    p.append(G(rig, rbox(0.005 * s, 0.09 * s, 0.03 * s), trim, which, (0.027 * s, 0.07 * s, 0.05 * s)))
    return p


def chainsword(rig, which='weapon', s=1.0, housing='armor', trim='trim'):
    p = []
    grip = cyl(0.021 * s, 0.14 * s, seg=10, bev=0.004 * s)
    p.append(G(rig, grip, 'black', which, (0, -0.02 * s, 0), rot=(90, 0, 0)))
    p.append(G(rig, sphere(0.03 * s, 10, 6), trim, which, (0, -0.10 * s, 0)))
    p.append(G(rig, rbox(0.04 * s, 0.035 * s, 0.13 * s, bev=0.01 * s), trim, which, (0, 0.06 * s, 0)))
    p.append(G(rig, rbox(0.055 * s, 0.17 * s, 0.11 * s, bev=0.018 * s), housing, which, (0, 0.16 * s, 0)))
    p.append(G(rig, rbox(0.06 * s, 0.05 * s, 0.05 * s, bev=0.008 * s), 'gunmetal', which, (0, 0.13 * s, 0.07 * s)))
    p.append(G(rig, rbox(0.024 * s, 0.56 * s, 0.075 * s, bev=0.006 * s), 'steel', which, (0, 0.52 * s, 0.0)))
    p.append(G(rig, cyl(0.037 * s, 0.024 * s, seg=12), 'steel', which, (0, 0.80 * s, 0), rot=(0, 90, 0)))
    tooth = rbox(0.02 * s, 0.022 * s, 0.022 * s)
    xf(tooth, rot=(45, 0, 0))
    for zz in (0.046, -0.046):
        row = array(copy(tooth), 18, (0, 0.03 * s, 0))
        p.append(G(rig, row, 'black', which, (0, 0.26 * s, zz * s)))
    return p


def heavy_bolter(rig, which='weapon', s=1.0, mat='gunmetal', trim='trim', stubber=False):
    p = []
    body_len = 0.42 if not stubber else 0.36
    p.append(G(rig, rbox(0.12 * s, body_len * s, 0.17 * s, bev=0.018 * s), mat, which, (0, 0.14 * s, 0.07 * s)))
    p.append(G(rig, rbox(0.09 * s, 0.30 * s, 0.05 * s, bev=0.01 * s), mat, which, (0, 0.10 * s, 0.17 * s)))
    if stubber:
        p.append(G(rig, cyl(0.022 * s, 0.55 * s, seg=12), 'steel', which, (0, 0.62 * s, 0.09 * s), rot=(90, 0, 0)))
        p.append(G(rig, cyl(0.04 * s, 0.30 * s, seg=12), mat, which, (0, 0.46 * s, 0.09 * s), rot=(90, 0, 0)))
        for i in range(6):
            p.append(G(rig, torus(0.041 * s, 0.006 * s, seg=12, seg2=5), 'black', which, (0, (0.34 + i * 0.045) * s, 0.09 * s), rot=(90, 0, 0)))
        p.append(G(rig, rbox(0.03 * s, 0.03 * s, 0.10 * s), mat, which, (0, 0.78 * s, 0.06 * s)))
    else:
        p.append(G(rig, cyl(0.048 * s, 0.42 * s, seg=14, bev=0.006 * s), mat, which, (0, 0.55 * s, 0.09 * s), rot=(90, 0, 0)))
        p.append(G(rig, cyl(0.062 * s, 0.12 * s, seg=14, bev=0.008 * s), mat, which, (0, 0.80 * s, 0.09 * s), rot=(90, 0, 0)))
        p.append(G(rig, rbox(0.14 * s, 0.03 * s, 0.035 * s), 'black', which, (0, 0.80 * s, 0.09 * s)))
        p.append(G(rig, torus(0.05 * s, 0.009 * s, seg=14, seg2=6), trim, which, (0, 0.36 * s, 0.09 * s), rot=(90, 0, 0)))
    # ammo box on the left side and the feed
    p.append(G(rig, rbox(0.15 * s, 0.20 * s, 0.17 * s, bev=0.015 * s), mat, which, (-0.15 * s, 0.10 * s, 0.0)))
    p.append(G(rig, rbox(0.155 * s, 0.03 * s, 0.03 * s), trim, which, (-0.15 * s, 0.10 * s, 0.07 * s)))
    p.append(G(rig, rbox(0.07 * s, 0.10 * s, 0.03 * s), trim, which, (-0.07 * s, 0.10 * s, 0.10 * s), rot=(0, 30, 0)))
    # rear spade grip and top carry handle
    p.append(G(rig, rbox(0.04 * s, 0.05 * s, 0.14 * s, bev=0.012 * s), 'black', which, (0, -0.005 * s, -0.04 * s), rot=(-10, 0, 0)))
    p.append(G(rig, rbox(0.03 * s, 0.03 * s, 0.10 * s, bev=0.008 * s), 'black', which, (0, 0.32 * s, 0.22 * s)))
    p.append(G(rig, rbox(0.03 * s, 0.14 * s, 0.03 * s, bev=0.008 * s), 'black', which, (0, 0.32 * s, 0.27 * s)))
    p.append(G(rig, rbox(0.006 * s, 0.14 * s, 0.07 * s), trim, which, (0.062 * s, 0.14 * s, 0.08 * s)))
    return p


# =============================================================================== SPACE MARINES
def marine_materials(seed=0.0):
    armour = srgb(0x23448f)
    mat_node_setup('armor', armour, rough=0.38, metal=0.35, edge=(srgb(0x9aa2b2), 0.09), grime=0.4, noise_scale=10, bump=0.2, scratches=1.0)
    mat_node_setup('trim', srgb(0xc8a04a), rough=0.32, metal=1.0, edge=(srgb(0xf0dca0), 0.08), grime=0.55, noise_scale=20, bump=0.15)
    mat_node_setup('black', srgb(0x1b1c1f), rough=0.62, metal=0.2, grime=0.2, noise_scale=26, bump=0.35)
    mat_node_setup('gunmetal', srgb(0x2a2c31), rough=0.42, metal=0.85, edge=(srgb(0xb8bcc4), 0.08), grime=0.4, noise_scale=24, bump=0.2, scratches=1.2)
    mat_node_setup('steel', srgb(0x8c9097), rough=0.3, metal=1.0, grime=0.5, noise_scale=30, bump=0.2, scratches=1.5)
    mat_node_setup('lens', srgb(0x8a0a08), rough=0.15, metal=0.0, grime=0.0, emit=srgb(0xff2a14), emit_strength=6.0, bump=0.0)
    mat_node_setup('plasma', srgb(0x2a7ad0), rough=0.2, metal=0.0, grime=0.0, emit=srgb(0x58c8ff), emit_strength=5.0, bump=0.0)
    mat_node_setup('white', srgb(0xd8d4c6), rough=0.45, metal=0.1, grime=0.45, noise_scale=18, bump=0.15)
    mat_node_setup('red', srgb(0x7c1410), rough=0.45, metal=0.0, grime=0.3, noise_scale=30, bump=0.4)
    mat_node_setup('parchment', srgb(0xcbb88c), rough=0.8, metal=0.0, grime=0.5, noise_scale=40, bump=0.3)
    mat_node_setup('leather', srgb(0x4a2e1c), rough=0.65, metal=0.0, grime=0.4, noise_scale=30, bump=0.4)
    return ['armor', 'trim', 'black', 'gunmetal', 'steel', 'lens', 'plasma', 'white', 'red', 'parchment', 'leather']


def marine_body(kind):
    b = dict(hip_h=1.02, knee_h=0.56, ankle_h=0.13, hip_w=0.155, spine_z=1.13, chest_z=1.33, neck_z=1.68, head_z=1.77, top_z=2.07,
             head_y=-0.03, neck_y=-0.01, sh_w=0.26, sh_z=1.62, ua=0.32, fa=0.30, hand=0.12, arm_out=16, foot=0.32,
             grip_r=(-0.10, -0.38, 1.45), w_yaw=27, offhand=(0.21, -0.42, 1.42), o_yaw=-8,
             muzzle=(0, 0.64, 0.085), muzzle2=(0, 0.26, 0.078))
    if kind == 'plasma':
        b.update(muzzle=(0, 0.68, 0.085))
    if kind == 'heavy':
        b.update(grip_r=(-0.20, -0.34, 1.13), w_yaw=8, w_pitch=0, muzzle=(0, 1.05, 0.10))
    if kind == 'sergeant':
        b.update(grip_r=(-0.27, -0.36, 1.27), w_yaw=-6, w_pitch=35, muzzle=(0, 0.95, 0.0))
    return Body(**b)


MARINE_STYLE = dict(stance=0.055, hunch=3, weight=1.0, knee=0.045,
                    walk=dict(S=0.64, frames=34, duty=0.62, lift=0.12, bob=0.03),
                    run=dict(S=0.94, frames=22, duty=0.38, lift=0.22, bob=0.05, lean=8),
                    charge=dict(S=1.06, frames=20, duty=0.36, lift=0.26, bob=0.06, lean=14))


def marine_parts(rig, kind):
    b = rig.b
    parts = []
    A = 'armor'
    # ---------------- legs
    for side, sx in (('L', 1), ('R', -1)):
        th, sh, ft, ts = 'thigh.' + side, 'shin.' + side, 'foot.' + side, 'tasset.' + side
        tl = rig.bone_len(th); sl = rig.bone_len(sh)
        parts.append(Part(rig.L(cyl(0.095, tl * 1.02, seg=14), th, (0, tl * 0.5, 0), rot=(90, 0, 0)), 'black', th))
        parts.append(Part(rig.L(rbox(0.25, tl * 0.80, 0.28, bev=0.075, seg=4, taper=(0.86, 0.9)), th, (0, tl * 0.50, 0.01)), A, th))
        parts.append(Part(rig.L(rbox(0.08, tl * 0.64, 0.05, bev=0.02), th, (0, tl * 0.52, 0.14)), A, th))
        parts.append(Part(rig.L(sphere(0.10, 14, 8), sh, (0, 0.0, -0.01)), 'black', blend(rig, [th, sh], 0.06)))
        parts.append(Part(rig.L(rbox(0.19, 0.22, 0.12, bev=0.055, seg=3, taper=(0.8, 0.78)), sh, (0, 0.035, 0.115), rot=(-6, 0, 0)), A, sh))
        parts.append(Part(rig.L(rbox(0.06, 0.06, 0.03, bev=0.012), sh, (0, 0.04, 0.175)), 'white', sh))
        parts.append(Part(rig.L(rbox(0.225, sl * 0.74, 0.245, bev=0.07, seg=4, taper_y=(1.12, 1.10)), sh, (0, sl * 0.55, 0.0)), A, sh))
        parts.append(Part(rig.L(ellipsoid(0.10, 0.16, 0.09, 14, 8), sh, (0, sl * 0.36, -0.075)), A, sh))
        parts.append(Part(rig.L(rbox(0.08, sl * 0.62, 0.055, bev=0.02), sh, (0, sl * 0.52, 0.13)), A, sh))
        parts.append(Part(rig.L(cyl(0.115, 0.08, seg=16, bev=0.012), sh, (0, sl * 0.98, 0.0), rot=(90, 0, 0)), 'black', sh))
        x = b.hip_w * sx
        parts.append(Part(xf(rbox(0.225, 0.36, 0.17, bev=0.065, seg=3), (x, -0.08, 0.095)), A, ft))
        parts.append(Part(xf(rbox(0.215, 0.14, 0.13, bev=0.055, seg=3, taper=(0.9, 0.78)), (x, -0.255, 0.07)), A, ft))
        parts.append(Part(xf(rbox(0.235, 0.46, 0.04, bev=0.012), (x, -0.105, 0.02)), 'black', ft))
        parts.append(Part(xf(rbox(0.06, 0.05, 0.06, bev=0.012), (x + sx * 0.11, 0.0, 0.13)), 'black', ft))
        # thigh plates hanging from the belt follow the thigh half way
        parts.append(Part(xf(xf(rbox(0.21, 0.07, 0.28, bev=0.035, seg=2, taper=(1.12, 1.0)), rot=(4, -sx * 16, sx * 34)), (sx * 0.225, -0.075, 0.90)), A, ts))
        parts.append(Part(xf(xf(rbox(0.07, 0.08, 0.025, bev=0.008), rot=(4, -sx * 16, sx * 34)), (sx * 0.26, -0.12, 1.00)), 'trim', ts))
    # ---------------- pelvis / waist
    parts.append(P(rbox(0.24, 0.12, 0.24, bev=0.05, seg=3, taper=(1.4, 1.0)), A, 'hips', (0, -0.16, 0.94)))
    parts.append(P(rbox(0.14, 0.03, 0.12, bev=0.012), 'trim', 'hips', (0, -0.225, 0.965)))
    parts.append(P(rbox(0.54, 0.38, 0.095, bev=0.035, seg=2), 'black', 'hips', (0, 0.0, 1.07)))
    parts.append(P(rbox(0.15, 0.05, 0.11, bev=0.015), 'trim', 'hips', (0, -0.195, 1.07)))
    parts.append(P(sphere(0.03, 10, 6), 'red', 'hips', (0, -0.225, 1.07)))
    parts.append(P(rbox(0.42, 0.08, 0.26, bev=0.03, taper=(1.15, 1.0)), A, 'hips', (0, 0.18, 0.95), rot=(-8, 0, 0)))
    parts.append(P(rbox(0.10, 0.09, 0.12, bev=0.02), 'leather', 'hips', (0.20, 0.10, 1.00)))
    parts.append(P(rbox(0.10, 0.09, 0.12, bev=0.02), 'leather', 'hips', (-0.22, 0.06, 1.00)))
    parts.append(P(cyl(0.18, 0.22, seg=18), 'black', 'spine', (0, 0.01, 1.20)))
    for z in (1.15, 1.215):
        parts.append(P(torus(0.18, 0.022, seg=20, seg2=6), 'black', 'spine', (0, 0.015, z)))
    parts.append(P(rbox(0.30, 0.08, 0.085, bev=0.03, seg=2, taper=(0.9, 1)), A, 'spine', (0, -0.165, 1.175)))
    parts.append(P(rbox(0.34, 0.08, 0.085, bev=0.03, seg=2, taper=(0.9, 1)), A, 'spine', (0, -0.17, 1.255)))
    parts += P2(rbox(0.10, 0.20, 0.16, bev=0.035, seg=2), A, 'spine', (0.19, -0.01, 1.22))
    # ---------------- torso
    parts.append(P(rbox(0.64, 0.42, 0.40, bev=0.11, seg=4, taper=(1.08, 1.0)), A, 'chest', (0, 0.0, 1.49)))
    parts += P2(rbox(0.28, 0.12, 0.23, bev=0.065, seg=3), A, 'chest', (0.14, -0.18, 1.545), rot=(-8, 0, 10))
    wing = [(0.0, 0.025), (0.05, 0.05), (0.11, 0.085), (0.19, 0.105), (0.26, 0.10), (0.21, 0.07), (0.26, 0.055), (0.20, 0.035),
            (0.24, 0.015), (0.17, 0.005), (0.18, -0.02), (0.11, -0.012), (0.06, -0.03), (0.02, -0.045), (0.0, -0.035)]
    full = wing + [(-x, z) for (x, z) in reversed(wing)][1:-1]
    parts.append(P(extrude(full, 0.03, bev=0.007), 'trim', 'chest', (0, -0.255, 1.575), rot=(-6, 0, 0)))
    parts += P2(sphere(0.024, 10, 6), 'trim', 'chest', (0.03, -0.272, 1.625))
    collar = lathe([(0.20, 0.0), (0.205, 0.07), (0.19, 0.14), (0.165, 0.17)], seg=24, arc=230)
    parts.append(P(collar, A, 'chest', (0, 0.02, 1.66), rot=(0, 0, -25)))
    parts.append(P(torus(0.165, 0.014, seg=24, seg2=5, arc=230), 'trim', 'chest', (0, 0.02, 1.83), rot=(0, 0, -25)))
    # backpack
    parts.append(P(rbox(0.54, 0.22, 0.46, bev=0.07, seg=3), A, 'chest', (0, 0.33, 1.60)))
    parts.append(P(rbox(0.46, 0.18, 0.07, bev=0.02), 'black', 'chest', (0, 0.33, 1.86)))
    for sx in (1, -1):
        parts.append(P(cyl(0.06, 0.32, seg=16, r2=0.05, bev=0.008), 'gunmetal', 'chest', (sx * 0.17, 0.42, 1.92), rot=(-18, 0, 0)))
        parts.append(P(torus(0.054, 0.013, seg=16, seg2=6), 'trim', 'chest', (sx * 0.17, 0.468, 2.065), rot=(-18, 0, 0)))
        parts.append(P(cyl(0.04, 0.02, seg=12), 'black', 'chest', (sx * 0.17, 0.472, 2.08), rot=(-18, 0, 0)))
        parts.append(P(rbox(0.05, 0.16, 0.30, bev=0.02), 'gunmetal', 'chest', (sx * 0.29, 0.33, 1.58)))
    parts.append(P(array(rbox(0.38, 0.02, 0.025, bev=0.005), 5, (0, 0, -0.045)), 'black', 'chest', (0, 0.442, 1.66)))
    parts.append(P(sphere(0.05, 14, 8), 'trim', 'chest', (0, 0.44, 1.46), scale=(1, 0.55, 1)))
    parts.append(P(rbox(0.30, 0.09, 0.09, bev=0.025), 'gunmetal', 'chest', (0, 0.43, 1.39)))
    # ---------------- arms
    for side, sx in (('L', 1), ('R', -1)):
        pa, ua, fa = 'pauldron.' + side, 'upper_arm.' + side, 'forearm.' + side
        ul = rig.bone_len(ua); fl = rig.bone_len(fa)
        paul = ellipsoid(0.235, 0.255, 0.19, 24, 14)
        cut(paul, (0, 0, -0.01), (0, 0, 1), 'above')
        fill_holes(paul)
        rim = torus(0.235, 0.028, seg=32, seg2=6)
        xf(rim, (0, 0, -0.005), scale=(1, 1.08, 1))
        band = torus(0.20, 0.012, seg=32, seg2=5)
        xf(band, (0, 0, 0.10), scale=(1, 1.08, 1))
        ins = join_bm(xf(torus(0.075, 0.013, seg=20, seg2=5), rot=(0, 90, 0)),
                      xf(extrude([(-0.048, -0.042), (0.0, 0.055), (0.048, -0.042), (0.027, -0.042), (0.0, 0.012), (-0.027, -0.042)], 0.014), rot=(0, 0, 90)))
        xf(ins, (0.19, 0.0, 0.085), rot=(0, 40, 0))
        for bm_, mat in ((paul, A), (rim, 'trim'), (band, A), (ins, 'white' if side == 'L' else 'trim')):
            if sx < 0:
                for vv in bm_.verts:
                    vv.co.x = -vv.co.x
                import bmesh as _b
                _b.ops.reverse_faces(bm_, faces=bm_.faces)
            xf(bm_, rot=(0, sx * 30, 0))
            xf(bm_, (sx * 0.34, -0.005, 1.63))
            parts.append(Part(bm_, mat, pa))
        parts.append(Part(rig.L(cyl(0.08, ul, seg=12), ua, (0, ul * 0.5, 0), rot=(90, 0, 0)), 'black', ua))
        parts.append(Part(rig.L(rbox(0.185, ul * 0.70, 0.19, bev=0.065, seg=3), ua, (0, ul * 0.58, 0.0)), A, ua))
        parts.append(Part(rig.L(sphere(0.08, 12, 8), fa, (0, 0, -0.01)), 'black', blend(rig, [ua, fa], 0.05)))
        parts.append(Part(rig.L(rbox(0.12, 0.11, 0.09, bev=0.035, seg=2), fa, (0, 0.03, -0.075), rot=(-20, 0, 0)), A, fa))
        parts.append(Part(rig.L(rbox(0.17, fl * 0.80, 0.17, bev=0.055, seg=3, taper_y=(0.86, 0.86)), fa, (0, fl * 0.55, 0.0)), A, fa))
        parts.append(Part(rig.L(torus(0.075, 0.015, seg=16, seg2=5), fa, (0, fl * 0.96, 0), rot=(90, 0, 0)), 'trim', fa))
        parts += fist(rig, side, scale=1.55, mat=A, glove='black')
    # ---------------- head
    parts.append(P(cyl(0.09, 0.14, seg=12), 'black', 'neck', (0, -0.015, 1.74)))
    parts.append(P(ellipsoid(0.138, 0.158, 0.148, 22, 14), A, 'head', (0, -0.015, 1.935)))
    parts.append(P(rbox(0.215, 0.10, 0.125, bev=0.04, seg=3), A, 'head', (0, -0.12, 1.895)))
    parts.append(P(rbox(0.105, 0.095, 0.105, bev=0.03, seg=2, taper=(0.78, 0.7)), 'gunmetal', 'head', (0, -0.19, 1.845), rot=(18, 0, 0)))
    parts.append(P(array(rbox(0.007, 0.02, 0.06), 4, (0.019, 0, 0)), 'black', 'head', (-0.0285, -0.238, 1.845), rot=(18, 0, 0)))
    parts.append(P(rbox(0.225, 0.05, 0.035, bev=0.015), A, 'head', (0, -0.158, 1.968), rot=(-8, 0, 0)))
    for sx in (1, -1):
        parts.append(P(rbox(0.068, 0.03, 0.042, bev=0.012), 'black', 'head', (sx * 0.05, -0.16, 1.93), rot=(0, 0, -sx * 12)))
        parts.append(P(ellipsoid(0.036, 0.017, 0.023, 12, 8), 'lens', 'head', (sx * 0.05, -0.177, 1.93), rot=(0, 0, -sx * 12)))
        parts.append(P(cyl(0.05, 0.06, seg=16, bev=0.008), A, 'head', (sx * 0.135, -0.02, 1.905), rot=(0, 90, 0)))
        parts.append(P(cyl(0.03, 0.066, seg=12), 'gunmetal', 'head', (sx * 0.138, -0.02, 1.905), rot=(0, 90, 0)))
    # ---------------- honours and seals
    parts += purity_seal(rig, 'chest', (0.18, -0.255, 1.45))
    parts += purity_seal(rig, 'pauldron.R', (-0.44, -0.24, 1.60), rot=(0, 0, -20))
    parts += purity_seal(rig, 'thigh.L', (0.19, -0.16, 0.90), rot=(0, 0, 10), s=0.9)
    # ---------------- kind specifics
    if kind == 'sergeant':
        parts.append(P(torus(0.14, 0.013, seg=24, seg2=5, arc=200), 'trim', 'head', (0, 0.0, 1.98), rot=(0, 0, 170), scale=(1, 1.12, 1)))
        parts.append(P(rbox(0.055, 0.32, 0.013, bev=0.004), 'white', 'head', (0, -0.01, 2.08), rot=(8, 0, 0)))
        parts.append(P(rbox(0.12, 0.005, 0.26, bev=0.003), 'red', 'chest', (0.0, 0.445, 1.36)))
        parts += chainsword(rig, 'weapon', 1.15)
        parts += bolt_pistol(rig, 'offhand', 1.2)
        rig.grip('R', 'weapon', (0, 0, 0), (0, 0.35, 0.94), (1, 0, 0))
        rig.grip('L', 'offhand', (0, -0.005, -0.03), (0, 0.55, -0.83), (-1, 0, 0))
    elif kind == 'heavy':
        parts += heavy_bolter(rig, 'weapon', 1.2)
        rig.grip('R', 'weapon', (0, -0.006, -0.048), (0, 0.3, -0.95), (1, 0, 0))
        rig.grip('L', 'weapon', (0, 0.384, 0.30), (0.75, 0.55, -0.2), (0, 0, 1))
        parts.append(P(tube([(-0.20, 0.34, 1.44), (-0.32, 0.12, 1.25), (-0.30, -0.12, 1.16)], 0.032, seg=8), 'trim', 'chest'))
        parts.append(P(rbox(0.06, 0.005, 0.30, bev=0.002), 'red', 'chest', (-0.18, 0.445, 1.50)))
    else:
        gs = 1.22
        parts += bolter(rig, 'weapon', gs, plasma=(kind == 'plasma'))
        rig.grip('R', 'weapon', (0, -0.005 * gs, -0.03 * gs), (0, 0.55, -0.83), (1, 0, 0))
        rig.grip('L', 'weapon', (0.0, 0.165 * gs, -0.062 * gs), (0.45, 0.45, 0.75), (-0.7, 0, -0.7))
    return parts


# =============================================================================== shared human / ork helpers
def limb_cyl(rig, bone, r_head, r_tail, y0, y1, mat, seg=12, sx=1.0, sz=1.0, bind=None, zoff=0.0):
    ln = y1 - y0
    bm = cyl(r_head, ln, seg=seg, r2=r_tail)
    xf(bm, rot=(-90, 0, 0), scale=(sx, 1, sz))
    return Part(rig.L(bm, bone, (0, (y0 + y1) / 2, zoff)), mat, bind or bone)


def lasgun(rig, which='weapon', s=1.0, wood='wood', body='gunmetal', bayonet=False, long=False):
    p = []
    L = 1.18 if long else 1.0
    p.append(G(rig, rbox(0.05 * s, 0.30 * s, 0.085 * s, bev=0.01 * s), body, which, (0, 0.06 * s, 0.035 * s)))
    p.append(G(rig, rbox(0.035 * s, 0.22 * s, 0.025 * s, bev=0.005 * s), body, which, (0, 0.08 * s, 0.09 * s)))
    p.append(G(rig, rbox(0.045 * s, 0.24 * L * s, 0.05 * s, bev=0.01 * s), wood, which, (0, (0.30 + 0.12 * (L - 1)) * s, 0.025 * s)))
    p.append(G(rig, cyl(0.014 * s, 0.30 * L * s, seg=10), body, which, (0, (0.36 + 0.15 * (L - 1)) * s, 0.055 * s), rot=(90, 0, 0)))
    p.append(G(rig, cyl(0.02 * s, 0.05 * s, seg=10), body, which, (0, (0.50 + 0.30 * (L - 1)) * s, 0.055 * s), rot=(90, 0, 0)))
    p.append(G(rig, rbox(0.04 * s, 0.07 * s, 0.10 * s, bev=0.008 * s), body, which, (0, 0.10 * s, -0.05 * s), rot=(-8, 0, 0)))
    p.append(G(rig, rbox(0.035 * s, 0.05 * s, 0.11 * s, bev=0.01 * s), wood, which, (0, -0.012 * s, -0.055 * s), rot=(-18, 0, 0)))
    p.append(G(rig, rbox(0.045 * s, 0.26 * s, 0.075 * s, bev=0.014 * s, taper=(1, 0.85)), wood, which, (0, -0.18 * s, 0.0), rot=(6, 0, 0)))
    p.append(G(rig, rbox(0.05 * s, 0.03 * s, 0.11 * s, bev=0.008 * s), 'black', which, (0, -0.31 * s, -0.01 * s)))
    if bayonet:
        tip = 0.53 + 0.30 * (L - 1)
        p.append(G(rig, rbox(0.007 * s, 0.24 * s, 0.03 * s, bev=0.002 * s, taper_y=(0.6, 0.12)), 'steel', which, (0, (tip + 0.10) * s, 0.035 * s), rot=(0, 0, 180)))
        p.append(G(rig, rbox(0.03 * s, 0.03 * s, 0.035 * s), body, which, (0, (tip - 0.01) * s, 0.04 * s)))
    return p


def laspistol(rig, which='offhand', s=1.0):
    return [G(rig, rbox(0.035 * s, 0.17 * s, 0.06 * s, bev=0.008 * s), 'gunmetal', which, (0, 0.07 * s, 0.04 * s)),
            G(rig, cyl(0.012 * s, 0.08 * s, seg=8), 'gunmetal', which, (0, 0.18 * s, 0.05 * s), rot=(90, 0, 0)),
            G(rig, rbox(0.03 * s, 0.045 * s, 0.10 * s, bev=0.01 * s), 'wood', which, (0, -0.005 * s, -0.035 * s), rot=(-14, 0, 0))]


def power_sword(rig, which='weapon', s=1.0):
    p = [G(rig, cyl(0.018 * s, 0.12 * s, seg=10), 'leather', which, (0, -0.02 * s, 0), rot=(90, 0, 0)),
         G(rig, sphere(0.025 * s, 10, 6), 'brass', which, (0, -0.09 * s, 0)),
         G(rig, rbox(0.035 * s, 0.03 * s, 0.16 * s, bev=0.008 * s), 'brass', which, (0, 0.05 * s, 0)),
         G(rig, rbox(0.012 * s, 0.62 * s, 0.05 * s, bev=0.003 * s, taper_y=(0.7, 0.25)), 'steel', which, (0, 0.38 * s, 0), rot=(0, 0, 180)),
         G(rig, rbox(0.016 * s, 0.58 * s, 0.012 * s), 'plasma', which, (0, 0.36 * s, 0.018 * s))]
    return p


def human_head(rig, skin='skin', helmet=None):
    p = [P(cyl(0.05, 0.12, seg=10), skin, 'neck', (0, -0.01, 1.505)),
         P(ellipsoid(0.083, 0.098, 0.105, 16, 12), skin, 'head', (0, -0.025, 1.625)),
         P(rbox(0.098, 0.085, 0.06, bev=0.03, seg=2, taper=(0.8, 0.8)), skin, 'head', (0, -0.06, 1.56)),
         P(rbox(0.024, 0.04, 0.038, bev=0.01, taper=(0.6, 0.8)), skin, 'head', (0, -0.118, 1.605), rot=(-12, 0, 0)),
         P(rbox(0.09, 0.03, 0.018, bev=0.008), skin, 'head', (0, -0.108, 1.648))]
    for sx in (1, -1):
        p.append(P(ellipsoid(0.014, 0.024, 0.03, 8, 6), skin, 'head', (sx * 0.083, -0.02, 1.615)))
        p.append(P(sphere(0.011, 8, 6), 'black', 'head', (sx * 0.032, -0.105, 1.628)))
    return p


def human_legs(rig, cloth, boot='black', kneepad=None):
    p = []
    b = rig.b
    for side, sx in (('L', 1), ('R', -1)):
        th, sh, ft = 'thigh.' + side, 'shin.' + side, 'foot.' + side
        tl = rig.bone_len(th); sl = rig.bone_len(sh)
        p.append(limb_cyl(rig, th, 0.104, 0.078, -0.04, tl + 0.02, cloth, sx=1.06))
        p.append(limb_cyl(rig, sh, 0.078, 0.064, -0.02, sl * 0.66, cloth))
        p.append(limb_cyl(rig, sh, 0.066, 0.06, sl * 0.55, sl + 0.02, boot))
        p.append(Part(rig.L(sphere(0.078, 10, 6), sh, (0, 0.0, -0.005)), cloth, blend(rig, [th, sh], 0.05)))
        if kneepad:
            p.append(Part(rig.L(rbox(0.105, 0.12, 0.05, bev=0.022, seg=2, taper=(0.85, 0.85)), sh, (0, 0.025, 0.06)), kneepad, sh))
        x = b.hip_w * sx
        p.append(Part(xf(rbox(0.11, 0.27, 0.095, bev=0.035, seg=2), (x, -0.06, 0.05)), boot, ft))
        p.append(Part(xf(rbox(0.12, 0.29, 0.025, bev=0.008), (x, -0.065, 0.012)), 'black', ft))
    return p


def human_arms(rig, sleeve, fore, glove='black', cuff=None, hand_scale=1.0):
    p = []
    for side in ('L', 'R'):
        ua, fa = 'upper_arm.' + side, 'forearm.' + side
        ul = rig.bone_len(ua); fl = rig.bone_len(fa)
        p.append(limb_cyl(rig, ua, 0.06, 0.05, -0.04, ul + 0.02, sleeve))
        p.append(Part(rig.L(sphere(0.06, 10, 6), ua, (0, -0.01, 0)), sleeve, blend(rig, ['clavicle.' + side, ua], 0.06)))
        p.append(Part(rig.L(sphere(0.05, 10, 6), fa, (0, 0, -0.005)), sleeve if fore == sleeve else fore, blend(rig, [ua, fa], 0.04)))
        p.append(limb_cyl(rig, fa, 0.048, 0.037, 0.0, fl + 0.01, fore))
        if cuff:
            p.append(Part(rig.L(torus(0.052, 0.014, seg=14, seg2=5), fa, (0, 0.03, 0), rot=(90, 0, 0)), cuff, fa))
        p += fist(rig, side, scale=hand_scale, mat=glove)
    return p


# =============================================================================== ASTRA MILITARUM (Cadian pattern)
def guard_materials():
    mat_node_setup('fatigue', srgb(0x7c7a52), rough=0.85, metal=0.0, grime=0.45, noise_scale=14, bump=0.35,
                   camo=(srgb(0x5d6238), srgb(0x857f55), srgb(0x5b4a32), 7.0))
    mat_node_setup('flak', srgb(0x3f4c2e), rough=0.52, metal=0.12, edge=(srgb(0x8c9068), 0.1), grime=0.45, noise_scale=12, bump=0.2, scratches=1.0)
    mat_node_setup('skin', srgb(0xb3846a), rough=0.55, metal=0.0, grime=0.25, noise_scale=30, bump=0.15, hue_var=0.06)
    mat_node_setup('leather', srgb(0x4a3020), rough=0.62, metal=0.0, grime=0.4, noise_scale=30, bump=0.4)
    mat_node_setup('black', srgb(0x1d1c1a), rough=0.6, metal=0.05, grime=0.2, noise_scale=26, bump=0.3)
    mat_node_setup('gunmetal', srgb(0x2c2e31), rough=0.45, metal=0.8, edge=(srgb(0xa8acb2), 0.09), grime=0.4, noise_scale=24, bump=0.2, scratches=1.0)
    mat_node_setup('wood', srgb(0x5c3c24), rough=0.6, metal=0.0, grime=0.35, noise_scale=40, bump=0.3)
    mat_node_setup('steel', srgb(0x8e9298), rough=0.3, metal=1.0, grime=0.4, noise_scale=30, bump=0.2, scratches=1.5)
    mat_node_setup('brass', srgb(0xb08a40), rough=0.35, metal=1.0, edge=(srgb(0xe8d090), 0.08), grime=0.5, noise_scale=24)
    mat_node_setup('lens', srgb(0x1a2a24), rough=0.08, metal=0.3, grime=0.0, emit=srgb(0x3a6050), emit_strength=1.5, bump=0.0)
    mat_node_setup('plasma', srgb(0x2a7ad0), rough=0.2, metal=0.0, grime=0.0, emit=srgb(0x58c8ff), emit_strength=5.0, bump=0.0)
    mat_node_setup('coat', srgb(0x384432), rough=0.88, metal=0.0, grime=0.4, noise_scale=16, bump=0.4)
    mat_node_setup('red', srgb(0x7a1612), rough=0.7, metal=0.0, grime=0.35, noise_scale=30, bump=0.3)
    mat_node_setup('white', srgb(0xd0ccb8), rough=0.5, metal=0.0, grime=0.4, noise_scale=20, bump=0.2)
    mat_node_setup('cloth_dark', srgb(0x3a3428), rough=0.9, metal=0.0, grime=0.4, noise_scale=20, bump=0.5)
    return ['fatigue', 'flak', 'skin', 'leather', 'black', 'gunmetal', 'wood', 'steel', 'brass', 'lens', 'plasma', 'coat', 'red', 'white', 'cloth_dark']


def human_body(kind, **k):
    b = dict(hip_h=0.95, knee_h=0.50, ankle_h=0.085, hip_w=0.10, spine_z=1.04, chest_z=1.22, neck_z=1.46, head_z=1.55, top_z=1.79,
             head_y=-0.015, neck_y=0.0, sh_w=0.18, sh_z=1.42, ua=0.29, fa=0.26, hand=0.085, arm_out=10, foot=0.24,
             grip_r=(-0.07, -0.26, 1.30), w_yaw=24, offhand=(0.16, -0.32, 1.30), o_yaw=-8,
             muzzle=(0, 0.53, 0.055), muzzle2=(0, 0.22, 0.05))
    b.update(k)
    if kind in ('heavy',):
        b.update(grip_r=(-0.15, -0.26, 1.03), w_yaw=8, w_pitch=0, muzzle=(0, 0.90, 0.09))
    if kind in ('sergeant', 'officer', 'watchmaster'):
        b.update(grip_r=(-0.21, -0.30, 1.13), w_yaw=-6, w_pitch=35, muzzle=(0, 0.80, 0.0), muzzle2=(0, 0.22, 0.05))
    if kind == 'special':
        b.update(muzzle=(0, 0.56, 0.07))
    return Body(**b)


def guard_body(kind):
    return human_body(kind)


GUARD_STYLE = dict(stance=0.03, hunch=4, weight=0.0, knee=0.035)


def guard_parts(rig, kind):
    p = []
    officer = kind == 'officer'
    p += human_legs(rig, 'fatigue', kneepad='flak')
    # pelvis + belt kit
    p.append(P(rbox(0.30, 0.21, 0.19, bev=0.07, seg=2), 'fatigue', 'hips', (0, 0.0, 0.98)))
    p.append(P(rbox(0.33, 0.23, 0.05, bev=0.015), 'leather', 'hips', (0, 0.0, 1.045)))
    p.append(P(rbox(0.05, 0.02, 0.04, bev=0.006), 'brass', 'hips', (0, -0.118, 1.045)))
    for x in (0.10, -0.10):
        p.append(P(rbox(0.07, 0.05, 0.08, bev=0.012), 'leather', 'hips', (x, -0.12, 1.02)))
    p.append(P(cyl(0.045, 0.12, seg=10, bev=0.01), 'gunmetal', 'hips', (0.16, 0.06, 1.0)))
    p.append(P(sphere(0.03, 10, 6), 'flak', 'hips', (-0.16, -0.04, 1.02)))
    # torso
    p.append(P(rbox(0.31, 0.21, 0.20, bev=0.07, seg=2), 'fatigue', 'spine', (0, 0.0, 1.13)))
    p.append(P(rbox(0.37, 0.23, 0.27, bev=0.085, seg=3, taper=(1.06, 1.0)), 'fatigue', 'chest', (0, 0.0, 1.33)))
    if officer:
        p.append(P(rbox(0.38, 0.245, 0.28, bev=0.08, seg=3, taper=(1.06, 1.0)), 'coat', 'chest', (0, 0.0, 1.335)))
        p.append(P(rbox(0.33, 0.23, 0.22, bev=0.07, seg=2), 'coat', 'spine', (0, 0.0, 1.13)))
        for side, sx in (('L', 1), ('R', -1)):
            p.append(P(rbox(0.17, 0.04, 0.50, bev=0.015, taper=(0.82, 1.0)), 'coat', 'tasset.' + side, (sx * 0.085, -0.115, 0.79)))
            p.append(P(rbox(0.04, 0.17, 0.50, bev=0.015), 'coat', 'tasset.' + side, (sx * 0.15, 0.0, 0.79)))
        p.append(P(rbox(0.30, 0.04, 0.52, bev=0.015, taper=(0.85, 1.0)), 'coat', 'hips', (0, 0.12, 0.78)))
        p.append(P(rbox(0.06, 0.25, 0.40, bev=0.01), 'red', 'chest', (0, -0.02, 1.30), rot=(0, 28, 0), scale=(0.6, 1.0, 1.0)))
        for sx in (1, -1):
            p.append(P(rbox(0.11, 0.11, 0.03, bev=0.01), 'brass', 'pauldron.' + ('L' if sx > 0 else 'R'), (sx * 0.19, 0, 1.445), rot=(0, sx * 20, 0)))
        for z in (1.40, 1.33, 1.26, 1.19, 1.12):
            p.append(P(sphere(0.012, 8, 6), 'brass', 'chest' if z > 1.22 else 'spine', (0.0, -0.125, z)))
        p.append(P(torus(0.055, 0.018, seg=14, seg2=6), 'coat', 'neck', (0, -0.005, 1.47)))
        # peaked cap
        p.append(P(cyl(0.10, 0.06, seg=18, r2=0.115, bev=0.01), 'coat', 'head', (0, -0.025, 1.725)))
        p.append(P(cyl(0.118, 0.02, seg=18), 'coat', 'head', (0, -0.025, 1.765)))
        p.append(P(xf(cut(cyl(0.11, 0.012, seg=18), (0, -0.02, 0), (0, -1, 0)), scale=(1, 1.1, 1)), 'black', 'head', (0, -0.04, 1.70), rot=(-10, 0, 0)))
        p.append(P(rbox(0.04, 0.01, 0.03, bev=0.004), 'brass', 'head', (0, -0.125, 1.735)))
    else:
        # flak armour
        p.append(P(rbox(0.33, 0.06, 0.25, bev=0.03, seg=2, taper=(0.92, 1.0)), 'flak', 'chest', (0, -0.115, 1.33)))
        p.append(P(rbox(0.31, 0.05, 0.25, bev=0.03, seg=2), 'flak', 'chest', (0, 0.115, 1.33)))
        p.append(P(rbox(0.25, 0.05, 0.10, bev=0.025), 'flak', 'spine', (0, -0.112, 1.15)))
        for sx in (1, -1):
            s = 'L' if sx > 0 else 'R'
            p.append(P(rbox(0.13, 0.14, 0.045, bev=0.02, seg=2), 'flak', 'pauldron.' + s, (sx * 0.205, 0.0, 1.45), rot=(0, sx * 28, 0)))
            p.append(P(rbox(0.035, 0.02, 0.36, bev=0.006), 'leather', 'chest', (sx * 0.09, -0.15, 1.30), rot=(0, sx * 18, 0)))
        # backpack + bedroll
        p.append(P(rbox(0.26, 0.12, 0.26, bev=0.04, seg=2), 'cloth_dark', 'chest', (0, 0.19, 1.30)))
        p.append(P(rbox(0.20, 0.03, 0.12, bev=0.012), 'leather', 'chest', (0, 0.255, 1.27)))
        p.append(P(cyl(0.05, 0.30, seg=12), 'fatigue', 'chest', (0, 0.19, 1.465), rot=(0, 90, 0)))
        p.append(P(torus(0.06, 0.012, seg=12, seg2=4), 'leather', 'chest', (0.08, 0.19, 1.465), rot=(0, 90, 0)))
        p.append(P(torus(0.06, 0.012, seg=12, seg2=4), 'leather', 'chest', (-0.08, 0.19, 1.465), rot=(0, 90, 0)))
        p.append(P(torus(0.055, 0.016, seg=14, seg2=6), 'fatigue', 'neck', (0, -0.005, 1.465)))
    p += human_arms(rig, 'coat' if officer else 'fatigue', 'coat' if officer else 'skin', glove='black', cuff=None if officer else 'fatigue')
    p += human_head(rig)
    if not officer:
        dome = ellipsoid(0.115, 0.13, 0.095, 20, 12)
        cut(dome, (0, 0, -0.01), (0, 0, 1), 'above'); fill_holes(dome)
        p.append(P(dome, 'flak', 'head', (0, -0.022, 1.665)))
        p.append(P(torus(0.112, 0.012, seg=24, seg2=5), 'flak', 'head', (0, -0.022, 1.66), scale=(1, 1.13, 1)))
        for sx in (1, -1):
            p.append(P(rbox(0.025, 0.085, 0.10, bev=0.012), 'flak', 'head', (sx * 0.108, -0.01, 1.62)))
            p.append(P(cyl(0.024, 0.025, seg=12), 'lens', 'head', (sx * 0.034, -0.13, 1.705), rot=(80, 0, 0)))
            p.append(P(torus(0.025, 0.007, seg=12, seg2=4), 'black', 'head', (sx * 0.034, -0.13, 1.705), rot=(80, 0, 0)))
        p.append(P(rbox(0.20, 0.012, 0.012), 'black', 'head', (0, -0.118, 1.705)))
        p.append(P(torus(0.10, 0.006, seg=16, seg2=4, arc=180), 'leather', 'head', (0, -0.01, 1.60), rot=(0, 90, 90)))
    if kind == 'sergeant':
        p.append(P(rbox(0.06, 0.01, 0.05), 'white', 'pauldron.L', (0.27, 0.0, 1.43), rot=(0, 28, 0)))
        p += chainsword(rig, 'weapon', 0.95, housing='gunmetal', trim='brass')
        p += laspistol(rig, 'offhand', 1.0)
        rig.grip('R', 'weapon', (0, 0, 0), (0, 0.35, 0.94), (1, 0, 0))
        rig.grip('L', 'offhand', (0, -0.005, -0.02), (0, 0.55, -0.83), (-1, 0, 0))
    elif kind == 'officer':
        p += power_sword(rig, 'weapon', 1.0)
        p += bolt_pistol(rig, 'offhand', 0.9, trim='brass')
        rig.grip('R', 'weapon', (0, 0, 0), (0, 0.35, 0.94), (1, 0, 0))
        rig.grip('L', 'offhand', (0, -0.005, -0.03), (0, 0.55, -0.83), (-1, 0, 0))
    elif kind == 'heavy':
        p += heavy_bolter(rig, 'weapon', 0.95, trim='brass', stubber=True)
        p.append(P(rbox(0.22, 0.16, 0.22, bev=0.02), 'gunmetal', 'chest', (0, 0.20, 1.30)))
        p.append(P(tube([(-0.10, 0.20, 1.22), (-0.22, 0.05, 1.10), (-0.18, -0.15, 1.05)], 0.02, seg=6), 'brass', 'chest'))
        rig.grip('R', 'weapon', (0, -0.005, -0.045), (0, 0.3, -0.95), (1, 0, 0))
        rig.grip('L', 'weapon', (0, 0.30, 0.26), (0.75, 0.55, -0.2), (0, 0, 1))
    elif kind == 'special':
        p += bolter(rig, 'weapon', 0.85, mat='gunmetal', trim='brass', plasma=True)
        rig.grip('R', 'weapon', (0, -0.004, -0.026), (0, 0.55, -0.83), (1, 0, 0))
        rig.grip('L', 'weapon', (0.0, 0.14, -0.055), (0.45, 0.45, 0.75), (-0.7, 0, -0.7))
    else:
        p += lasgun(rig, 'weapon', 1.0)
        rig.grip('R', 'weapon', (0, -0.005, -0.03), (0, 0.55, -0.83), (1, 0, 0))
        rig.grip('L', 'weapon', (0.0, 0.18, -0.025), (0.45, 0.45, 0.75), (-0.7, 0, -0.7))
    return p


# =============================================================================== DEATH KORPS OF KRIEG
def krieg_materials():
    mat_node_setup('coat', srgb(0x3b3f3c), rough=0.9, metal=0.0, grime=0.5, noise_scale=16, bump=0.45, hue_var=0.03)
    mat_node_setup('helmet', srgb(0x474b48), rough=0.5, metal=0.45, edge=(srgb(0x9a9e98), 0.1), grime=0.5, noise_scale=12, bump=0.2, scratches=1.2)
    mat_node_setup('mask', srgb(0x2c2a26), rough=0.62, metal=0.0, grime=0.3, noise_scale=26, bump=0.35)
    mat_node_setup('glass', srgb(0x1c2418), rough=0.06, metal=0.2, grime=0.0, emit=srgb(0x8aa040), emit_strength=1.2, bump=0.0)
    mat_node_setup('leather', srgb(0x2e241c), rough=0.6, metal=0.0, grime=0.35, noise_scale=30, bump=0.4)
    mat_node_setup('black', srgb(0x1a1a19), rough=0.6, metal=0.05, grime=0.2, noise_scale=26, bump=0.3)
    mat_node_setup('brass', srgb(0xa0803c), rough=0.38, metal=1.0, edge=(srgb(0xe0c888), 0.08), grime=0.55, noise_scale=24)
    mat_node_setup('gunmetal', srgb(0x2c2e30), rough=0.45, metal=0.8, edge=(srgb(0xa8acb2), 0.09), grime=0.45, noise_scale=24, bump=0.2, scratches=1.0)
    mat_node_setup('wood', srgb(0x4e3420), rough=0.6, metal=0.0, grime=0.4, noise_scale=40, bump=0.3)
    mat_node_setup('steel', srgb(0x8e9298), rough=0.3, metal=1.0, grime=0.4, noise_scale=30, bump=0.2, scratches=1.5)
    mat_node_setup('webbing', srgb(0x4a4636), rough=0.85, metal=0.0, grime=0.45, noise_scale=30, bump=0.4)
    mat_node_setup('white', srgb(0xc8c4b0), rough=0.6, metal=0.0, grime=0.5, noise_scale=20, bump=0.2)
    mat_node_setup('plasma', srgb(0x2a7ad0), rough=0.2, metal=0.0, grime=0.0, emit=srgb(0x58c8ff), emit_strength=5.0, bump=0.0)
    return ['coat', 'helmet', 'mask', 'glass', 'leather', 'black', 'brass', 'gunmetal', 'wood', 'steel', 'webbing', 'white', 'plasma']


def krieg_body(kind):
    return human_body(kind, hip_h=0.96, knee_h=0.505, top_z=1.83)


KRIEG_STYLE = dict(stance=0.028, hunch=1, weight=0.1, knee=0.03,
                   walk=dict(S=0.60, frames=31, duty=0.6, lift=0.10, bob=0.022))


def krieg_parts(rig, kind):
    p = []
    p += human_legs(rig, 'coat')
    for side, sx in (('L', 1), ('R', -1)):
        sh = 'shin.' + side
        sl = rig.bone_len(sh)
        p.append(limb_cyl(rig, sh, 0.064, 0.058, sl * 0.45, sl + 0.02, 'leather'))
    # greatcoat
    p.append(P(rbox(0.33, 0.23, 0.22, bev=0.07, seg=2), 'coat', 'spine', (0, 0.0, 1.13)))
    p.append(P(rbox(0.39, 0.25, 0.29, bev=0.085, seg=3, taper=(1.06, 1.0)), 'coat', 'chest', (0, 0.0, 1.335)))
    p.append(P(rbox(0.32, 0.23, 0.12, bev=0.05, seg=2), 'coat', 'hips', (0, 0.0, 0.99)))
    for side, sx in (('L', 1), ('R', -1)):
        p.append(P(rbox(0.175, 0.045, 0.55, bev=0.015, taper=(0.8, 1.0)), 'coat', 'tasset.' + side, (sx * 0.088, -0.118, 0.73)))
        p.append(P(rbox(0.045, 0.19, 0.53, bev=0.015, taper=(1.0, 0.9)), 'coat', 'tasset.' + side, (sx * 0.158, 0.0, 0.74)))
        p.append(P(rbox(0.09, 0.03, 0.03, bev=0.008), 'coat', 'chest', (sx * 0.06, -0.125, 1.46), rot=(0, 0, sx * 30)))
    p.append(P(rbox(0.32, 0.045, 0.57, bev=0.015, taper=(0.85, 1.0)), 'coat', 'hips', (0, 0.123, 0.72)))
    p.append(P(rbox(0.36, 0.25, 0.05, bev=0.015), 'leather', 'hips', (0, 0.0, 1.05)))
    p.append(P(rbox(0.05, 0.02, 0.04, bev=0.006), 'brass', 'hips', (0, -0.128, 1.05)))
    for z in (1.40, 1.32, 1.24, 1.16):
        p.append(P(sphere(0.011, 8, 6), 'brass', 'chest' if z > 1.22 else 'spine', (0.055, -0.13, z)))
    # webbing, pouches, rebreather canister
    for sx in (1, -1):
        p.append(P(rbox(0.035, 0.02, 0.38, bev=0.006), 'webbing', 'chest', (sx * 0.09, -0.135, 1.28), rot=(0, sx * 16, 0)))
        p.append(P(rbox(0.08, 0.055, 0.09, bev=0.014), 'webbing', 'hips', (sx * 0.11, -0.13, 1.02)))
    p.append(P(cyl(0.045, 0.15, seg=12, bev=0.01), 'brass', 'chest', (-0.12, -0.12, 1.24), rot=(0, 0, 0)))
    p.append(P(rbox(0.28, 0.13, 0.30, bev=0.04, seg=2), 'webbing', 'chest', (0, 0.195, 1.28)))
    p.append(P(cyl(0.05, 0.30, seg=12), 'coat', 'chest', (0, 0.20, 1.47), rot=(0, 90, 0)))
    p.append(P(rbox(0.13, 0.015, 0.16, bev=0.006, taper=(0.8, 1)), 'steel', 'chest', (0.05, 0.27, 1.16), rot=(0, 0, 8)))
    p.append(P(cyl(0.012, 0.30, seg=6), 'wood', 'chest', (0.035, 0.27, 1.36), rot=(0, 8, 0)))
    p.append(P(cyl(0.03, 0.08, seg=10, bev=0.006), 'gunmetal', 'hips', (0.17, 0.08, 1.0)))
    # arms in coat sleeves
    p += human_arms(rig, 'coat', 'coat', glove='leather', cuff='coat')
    # head: gas mask + flared helmet
    p.append(P(cyl(0.05, 0.12, seg=10), 'mask', 'neck', (0, -0.01, 1.505)))
    p.append(P(torus(0.06, 0.022, seg=14, seg2=6), 'coat', 'neck', (0, 0.0, 1.475)))
    p.append(P(ellipsoid(0.088, 0.10, 0.108, 16, 12), 'mask', 'head', (0, -0.025, 1.625)))
    p.append(P(rbox(0.11, 0.06, 0.07, bev=0.03, seg=2), 'mask', 'head', (0, -0.085, 1.585)))
    for sx in (1, -1):
        p.append(P(cyl(0.028, 0.02, seg=14), 'glass', 'head', (sx * 0.037, -0.108, 1.635), rot=(78, 0, sx * 10)))
        p.append(P(torus(0.029, 0.007, seg=14, seg2=5), 'brass', 'head', (sx * 0.037, -0.11, 1.635), rot=(78, 0, sx * 10)))
    p.append(P(cyl(0.034, 0.065, seg=12, r2=0.028, bev=0.006), 'gunmetal', 'head', (0, -0.135, 1.565), rot=(70, 0, 0)))
    p.append(P(torus(0.033, 0.006, seg=12, seg2=4), 'brass', 'head', (0, -0.16, 1.556), rot=(70, 0, 0)))
    hose = tube([(0, -0.16, 1.55), (-0.03, -0.18, 1.45), (-0.09, -0.16, 1.36), (-0.12, -0.13, 1.30)], 0.016, seg=7)
    p.append(Part(hose, 'mask', blend(rig, ['head', 'chest'], 0.07)))
    helm = lathe([(0.152, -0.012), (0.14, 0.0), (0.122, 0.022), (0.118, 0.05), (0.11, 0.08), (0.085, 0.105), (0.045, 0.118), (0.0, 0.122)], seg=26)
    p.append(P(helm, 'helmet', 'head', (0, -0.02, 1.645), scale=(1, 1.08, 1)))
    p.append(P(torus(0.149, 0.008, seg=26, seg2=4), 'helmet', 'head', (0, -0.02, 1.633), scale=(1, 1.08, 1)))
    p.append(P(rbox(0.20, 0.02, 0.10, bev=0.008), 'leather', 'head', (0, 0.10, 1.585), rot=(-10, 0, 0)))
    if kind == 'watchmaster':
        p.append(P(rbox(0.035, 0.26, 0.012), 'white', 'head', (0, -0.02, 1.766), rot=(0, 0, 0)))
        p.append(P(rbox(0.30, 0.04, 0.42, bev=0.012), 'coat', 'chest', (0, 0.155, 1.24)))
        p += chainsword(rig, 'weapon', 0.95, housing='gunmetal', trim='brass')
        p += laspistol(rig, 'offhand', 1.0)
        rig.grip('R', 'weapon', (0, 0, 0), (0, 0.35, 0.94), (1, 0, 0))
        rig.grip('L', 'offhand', (0, -0.005, -0.02), (0, 0.55, -0.83), (-1, 0, 0))
    elif kind == 'heavy':
        p += heavy_bolter(rig, 'weapon', 0.95, trim='brass', stubber=True)
        p.append(P(rbox(0.22, 0.16, 0.22, bev=0.02), 'gunmetal', 'chest', (0, 0.20, 1.30)))
        rig.grip('R', 'weapon', (0, -0.005, -0.045), (0, 0.3, -0.95), (1, 0, 0))
        rig.grip('L', 'weapon', (0, 0.30, 0.26), (0.75, 0.55, -0.2), (0, 0, 1))
    else:
        p += lasgun(rig, 'weapon', 1.0, bayonet=True, long=True)
        rig.grip('R', 'weapon', (0, -0.005, -0.03), (0, 0.55, -0.83), (1, 0, 0))
        rig.grip('L', 'weapon', (0.0, 0.19, -0.025), (0.45, 0.45, 0.75), (-0.7, 0, -0.7))
    return p


# =============================================================================== ORKS
def ork_materials():
    mat_node_setup('skin', srgb(0x4f7a2c), rough=0.55, metal=0.0, grime=0.4, noise_scale=10, bump=0.4, hue_var=0.09)
    mat_node_setup('rust', srgb(0x6a4a34), rough=0.72, metal=0.55, edge=(srgb(0xa8a49a), 0.08), grime=0.6, noise_scale=14, bump=0.35, scratches=1.5)
    mat_node_setup('red', srgb(0x8a1a12), rough=0.6, metal=0.3, edge=(srgb(0x8a8478), 0.08), grime=0.55, noise_scale=14, bump=0.3, scratches=1.2)
    mat_node_setup('check', srgb(0xffffff), rough=0.6, metal=0.3, edge=(srgb(0x8a8478), 0.08), grime=0.55, noise_scale=14, bump=0.3,
                   checker=(srgb(0x18181a), srgb(0xd0ccc0), 9.0))
    mat_node_setup('yellow', srgb(0xb88a1c), rough=0.6, metal=0.3, edge=(srgb(0x8a8478), 0.08), grime=0.55, noise_scale=14, bump=0.3)
    mat_node_setup('leather', srgb(0x4a3020), rough=0.62, metal=0.0, grime=0.45, noise_scale=30, bump=0.45)
    mat_node_setup('cloth', srgb(0x5c4c34), rough=0.9, metal=0.0, grime=0.5, noise_scale=18, bump=0.5)
    mat_node_setup('black', srgb(0x1c1b1a), rough=0.6, metal=0.1, grime=0.3, noise_scale=26, bump=0.3)
    mat_node_setup('bone', srgb(0xd8cba0), rough=0.5, metal=0.0, grime=0.5, noise_scale=30, bump=0.3)
    mat_node_setup('eye', srgb(0x8a0a04), rough=0.2, metal=0.0, grime=0.0, emit=srgb(0xff3a10), emit_strength=6.0, bump=0.0)
    mat_node_setup('steel', srgb(0x80848a), rough=0.4, metal=1.0, edge=(srgb(0xd0d4d8), 0.07), grime=0.65, noise_scale=20, bump=0.3, scratches=2.0)
    mat_node_setup('gunmetal', srgb(0x2e2c2a), rough=0.55, metal=0.7, edge=(srgb(0xa0a0a0), 0.09), grime=0.55, noise_scale=20, bump=0.3, scratches=1.5)
    mat_node_setup('brass', srgb(0xa07a34), rough=0.45, metal=1.0, grime=0.6, noise_scale=20)
    return ['skin', 'rust', 'red', 'check', 'yellow', 'leather', 'cloth', 'black', 'bone', 'eye', 'steel', 'gunmetal', 'brass']


def ork_body(kind):
    b = dict(hip_h=0.84, knee_h=0.45, ankle_h=0.095, hip_w=0.155, spine_z=0.94, chest_z=1.12, neck_z=1.42, head_z=1.47, top_z=1.72,
             head_y=-0.17, neck_y=-0.08, sh_w=0.29, sh_z=1.40, ua=0.37, fa=0.35, hand=0.12, arm_out=22, foot=0.30,
             grip_r=(-0.30, -0.36, 1.05), w_yaw=-6, w_pitch=30, offhand=(0.30, -0.42, 1.18), o_yaw=-6,
             muzzle=(0, 0.62, 0.0), muzzle2=(0, 0.30, 0.06))
    if kind == 'shoota':
        b.update(grip_r=(-0.12, -0.40, 1.18), w_yaw=22, w_pitch=0, muzzle=(0, 0.66, 0.08))
    if kind == 'nob':
        b.update(grip_r=(-0.10, -0.40, 1.05), w_yaw=10, w_pitch=55, muzzle=(0, 1.15, 0.0))
    if kind == 'warboss':
        b.update(grip_r=(-0.33, -0.36, 1.08), w_yaw=-4, w_pitch=10, muzzle=(0, 0.42, 0.0), muzzle2=(0, 0.48, 0.07))
    return Body(**b)


ORK_STYLE = dict(stance=0.07, hunch=16, head_fwd=-6, weight=0.4, swagger=0.7, knee=0.06,
                 walk=dict(S=0.60, frames=30, duty=0.6, lift=0.12, bob=0.035),
                 run=dict(S=0.92, frames=20, duty=0.36, lift=0.24, bob=0.06, lean=12),
                 charge=dict(S=1.02, frames=18, duty=0.34, lift=0.28, bob=0.07, lean=20))


def ork_parts(rig, kind):
    p = []
    b = rig.b
    big = kind in ('nob', 'warboss')
    # legs: baggy trousers + crude boots
    for side, sx in (('L', 1), ('R', -1)):
        th, sh, ft = 'thigh.' + side, 'shin.' + side, 'foot.' + side
        tl = rig.bone_len(th); sl = rig.bone_len(sh)
        p.append(limb_cyl(rig, th, 0.12, 0.10, -0.03, tl + 0.03, 'cloth', seg=12, sx=1.05))
        p.append(limb_cyl(rig, sh, 0.10, 0.085, -0.03, sl * 0.65, 'cloth', seg=12))
        p.append(limb_cyl(rig, sh, 0.09, 0.085, sl * 0.55, sl + 0.02, 'leather', seg=12))
        p.append(Part(rig.L(sphere(0.10, 12, 8), sh, (0, 0, -0.01)), 'cloth', blend(rig, [th, sh], 0.06)))
        p.append(Part(rig.L(rbox(0.13, 0.13, 0.06, bev=0.025, seg=2), sh, (0, 0.03, 0.085)), 'rust', sh))
        x = b.hip_w * sx
        p.append(Part(xf(rbox(0.17, 0.33, 0.13, bev=0.045, seg=2), (x, -0.07, 0.07)), 'leather', ft))
        p.append(Part(xf(rbox(0.18, 0.12, 0.10, bev=0.035, seg=2, taper=(0.9, 0.8)), (x, -0.22, 0.06)), 'rust', ft))
        p.append(Part(xf(rbox(0.19, 0.36, 0.03, bev=0.01), (x, -0.08, 0.015)), 'black', ft))
    # pelvis / belt / loincloth
    p.append(P(rbox(0.40, 0.30, 0.22, bev=0.09, seg=2), 'cloth', 'hips', (0, 0.0, 0.88)))
    p.append(P(rbox(0.44, 0.33, 0.07, bev=0.02), 'leather', 'hips', (0, 0.0, 0.95)))
    p.append(P(rbox(0.12, 0.04, 0.10, bev=0.02), 'rust', 'hips', (0, -0.17, 0.95)))
    p.append(P(sphere(0.035, 10, 6), 'bone', 'hips', (0, -0.195, 0.955), scale=(1, 0.7, 1.1)))
    p.append(P(rbox(0.16, 0.02, 0.24, bev=0.006, taper=(1.2, 1)), 'red' if not big else 'check', 'tasset.L', (0.0, -0.16, 0.78)))
    # torso: muscle mass
    p.append(P(rbox(0.46, 0.34, 0.26, bev=0.10, seg=3), 'skin', 'spine', (0, -0.01, 1.03), subd=1))
    p.append(P(rbox(0.64, 0.42, 0.40, bev=0.14, seg=3, taper=(1.12, 1.08)), 'skin', 'chest', (0, 0.01, 1.27), subd=1))
    for sx in (1, -1):
        p.append(P(ellipsoid(0.15, 0.09, 0.11, 14, 10), 'skin', 'chest', (sx * 0.14, -0.19, 1.30), rot=(0, sx * 10, 0)))
        p.append(P(ellipsoid(0.14, 0.15, 0.13, 14, 10), 'skin', 'chest', (sx * 0.22, 0.10, 1.42)))
    p.append(P(cyl(0.11, 0.18, seg=12, r2=0.09), 'skin', 'neck', (0, -0.05, 1.45), rot=(20, 0, 0)))
    # crude armour + straps
    plate = rbox(0.34, 0.05, 0.20, bev=0.02)
    jitter(plate, 0.008, 3)
    p.append(P(plate, 'rust', 'chest', (0.03, -0.22, 1.24), rot=(-8, 4, -6)))
    for (x, z) in ((-0.11, 1.32), (0.15, 1.32), (-0.11, 1.16), (0.17, 1.17)):
        p.append(P(sphere(0.014, 8, 6), 'steel', 'chest', (x, -0.25, z)))
    p.append(P(rbox(0.05, 0.03, 0.62, bev=0.008), 'leather', 'chest', (0.0, -0.21, 1.25), rot=(0, 42, 0)))
    p.append(P(rbox(0.05, 0.03, 0.62, bev=0.008), 'leather', 'chest', (0.0, 0.22, 1.25), rot=(0, -42, 0)))
    # shoulder pad (left) with spikes
    pad = ellipsoid(0.20, 0.22, 0.16, 16, 10); cut(pad, (0, 0, -0.02), (0, 0, 1), 'above'); fill_holes(pad); jitter(pad, 0.006, 5)
    xf(pad, rot=(0, 30, 0)); xf(pad, (0.36, 0.0, 1.47))
    p.append(Part(pad, 'check' if big else 'red', 'pauldron.L'))
    for k in range(3):
        sp = cyl(0.03, 0.12, seg=8, r2=0.0)
        xf(sp, (0, 0, 0.06)); xf(sp, rot=(0, 30 + k * 18 - 18, 0)); xf(sp, (0.40 + k * 0.03, -0.06 + k * 0.06, 1.55 - k * 0.02))
        p.append(Part(sp, 'steel', 'pauldron.L'))
    if big:
        pad2 = ellipsoid(0.20, 0.22, 0.16, 16, 10); cut(pad2, (0, 0, -0.02), (0, 0, 1), 'above'); fill_holes(pad2); jitter(pad2, 0.006, 7)
        xf(pad2, rot=(0, -30, 0)); xf(pad2, (-0.36, 0.0, 1.47))
        p.append(Part(pad2, 'red', 'pauldron.R'))
        p.append(P(rbox(0.50, 0.07, 0.34, bev=0.03, taper=(1.1, 1.0)), 'red', 'chest', (0, -0.235, 1.26), rot=(-6, 0, 0)))
        p.append(P(rbox(0.30, 0.05, 0.20, bev=0.02), 'check', 'chest', (0, -0.27, 1.27), rot=(-6, 0, 0)))
        p.append(P(rbox(0.46, 0.08, 0.30, bev=0.03), 'rust', 'chest', (0, 0.25, 1.28)))
    # arms: big muscles
    for side, sx in (('L', 1), ('R', -1)):
        ua, fa = 'upper_arm.' + side, 'forearm.' + side
        ul = rig.bone_len(ua); fl = rig.bone_len(fa)
        p.append(Part(rig.L(rbox(0.18, ul * 1.0, 0.19, bev=0.07, seg=3), ua, (0, ul * 0.48, 0.0)), 'skin', ua, subd=1))
        p.append(Part(rig.L(ellipsoid(0.10, 0.13, 0.09, 12, 8), ua, (0, ul * 0.45, 0.07)), 'skin', ua))
        p.append(Part(rig.L(sphere(0.11, 12, 8), ua, (0, -0.02, 0)), 'skin', blend(rig, ['clavicle.' + side, ua], 0.08)))
        p.append(Part(rig.L(sphere(0.09, 12, 8), fa, (0, 0, -0.01)), 'skin', blend(rig, [ua, fa], 0.06)))
        p.append(Part(rig.L(rbox(0.17, fl * 0.95, 0.17, bev=0.065, seg=3, taper_y=(0.85, 0.85)), fa, (0, fl * 0.5, 0)), 'skin', fa, subd=1))
        p.append(Part(rig.L(cyl(0.085, 0.11, seg=12, bev=0.01), fa, (0, fl * 0.82, 0), rot=(90, 0, 0)), 'leather', fa))
        p += fist(rig, side, scale=1.75, mat='skin')
    # head: brow, jaw, tusks, ears, red eyes
    p.append(P(ellipsoid(0.13, 0.14, 0.12, 16, 12), 'skin', 'head', (0, -0.20, 1.575), subd=0))
    p.append(P(rbox(0.21, 0.16, 0.10, bev=0.05, seg=2, taper=(0.9, 1.0)), 'skin', 'head', (0, -0.27, 1.47), subd=1))
    p.append(P(rbox(0.21, 0.07, 0.05, bev=0.025, seg=2), 'skin', 'head', (0, -0.30, 1.585), rot=(-10, 0, 0)))
    p.append(P(ellipsoid(0.04, 0.035, 0.03, 10, 6), 'skin', 'head', (0, -0.33, 1.54)))
    for sx in (1, -1):
        p.append(P(sphere(0.017, 8, 6), 'eye', 'head', (sx * 0.05, -0.31, 1.563)))
        tusk = cyl(0.022, 0.08, seg=8, r2=0.0)
        p.append(P(tusk, 'bone', 'head', (sx * 0.07, -0.335, 1.52), rot=(-15, sx * 12, 0)))
        ear = cyl(0.05, 0.16, seg=6, r2=0.0)
        p.append(P(ear, 'skin', 'head', (sx * 0.17, -0.16, 1.58), rot=(0, sx * 70, 0), scale=(1, 0.35, 1)))
    p.append(P(array(rbox(0.015, 0.012, 0.022), 6, (0.02, 0, 0)), 'bone', 'head', (-0.05, -0.335, 1.508)))
    if big:
        p.append(P(rbox(0.24, 0.17, 0.05, bev=0.02), 'rust', 'head', (0, -0.27, 1.43)))  # iron jaw plate
        p.append(P(xf(cut(ellipsoid(0.13, 0.14, 0.10, 14, 8), (0, 0, 0), (0, 0, 1), 'above'), scale=(1, 1, 1)), 'rust', 'head', (0, -0.19, 1.60)))
        for sx in (1, -1):
            p.append(P(cyl(0.025, 0.14, seg=8, r2=0.0), 'bone', 'head', (sx * 0.10, -0.16, 1.70), rot=(0, sx * 30, 0)))
    # weapons
    if kind == 'shoota':
        p += shoota(rig, 'weapon', 1.0)
        rig.grip('R', 'weapon', (0, -0.01, -0.05), (0, 0.55, -0.83), (1, 0, 0))
        rig.grip('L', 'weapon', (0.0, 0.26, -0.06), (0.45, 0.45, 0.75), (-0.7, 0, -0.7))
    elif kind == 'nob':
        p += big_choppa(rig, 'weapon', 1.0)
        rig.grip('R', 'weapon', (0, -0.02, 0), (0, 0.35, 0.94), (1, 0, 0))
        rig.grip('L', 'weapon', (0, 0.20, 0), (0, 0.35, 0.94), (1, 0, 0))
    elif kind == 'warboss':
        p += power_klaw(rig, 'weapon')
        p += slugga(rig, 'offhand', 1.25)
        rig.grip('R', 'weapon', (0, -0.02, 0), (0, 0.9, 0.3), (1, 0, 0))
        rig.grip('L', 'offhand', (0, -0.01, -0.04), (0, 0.55, -0.83), (-1, 0, 0))
        p.append(P(rbox(0.70, 0.46, 0.34, bev=0.06, seg=2), 'rust', 'chest', (0, 0.02, 1.30)))
        p.append(P(rbox(0.36, 0.06, 0.26, bev=0.02), 'yellow', 'chest', (0, -0.25, 1.30)))
        p.append(P(rbox(0.50, 0.30, 0.40, bev=0.05), 'rust', 'chest', (0, 0.36, 1.40)))
        for sx in (1, -1):
            p.append(P(cyl(0.055, 0.30, seg=10, r2=0.045), 'gunmetal', 'chest', (sx * 0.18, 0.40, 1.72)))
    else:
        p += choppa(rig, 'weapon', 1.0)
        p += slugga(rig, 'offhand', 1.0)
        rig.grip('R', 'weapon', (0, 0, 0), (0, 0.35, 0.94), (1, 0, 0))
        rig.grip('L', 'offhand', (0, -0.01, -0.035), (0, 0.55, -0.83), (-1, 0, 0))
    return p


def choppa(rig, which='weapon', s=1.0):
    blade = [(0.0, 0.0), (0.0, 0.06), (0.05, 0.40), (0.12, 0.46), (0.13, 0.38), (0.10, 0.30), (0.11, 0.20), (0.07, 0.06), (0.05, 0.0)]
    bm = extrude([(x * s, z * s) for (x, z) in blade], 0.018 * s, bev=0.004 * s)
    jitter(bm, 0.004 * s, 11)
    perm_yzx(bm)
    p = [G(rig, bm, 'steel', which, (0, 0.10 * s, -0.05 * s)),
         G(rig, cyl(0.022 * s, 0.16 * s, seg=8), 'leather', which, (0, 0.0, 0), rot=(90, 0, 0)),
         G(rig, rbox(0.05 * s, 0.03 * s, 0.05 * s, bev=0.008 * s), 'rust', which, (0, 0.085 * s, 0))]
    return p


def big_choppa(rig, which='weapon', s=1.0):
    blade = [(0.0, 0.0), (-0.04, 0.10), (-0.02, 0.55), (0.10, 0.70), (0.22, 0.66), (0.20, 0.52), (0.23, 0.40), (0.18, 0.22), (0.10, 0.08), (0.06, 0.0)]
    bm = extrude([(x * s, z * s) for (x, z) in blade], 0.028 * s, bev=0.006 * s)
    jitter(bm, 0.006 * s, 13)
    perm_yzx(bm)
    return [G(rig, bm, 'steel', which, (0, 0.38 * s, -0.08 * s)),
            G(rig, cyl(0.026 * s, 0.50 * s, seg=8), 'leather', which, (0, 0.12 * s, 0), rot=(90, 0, 0)),
            G(rig, rbox(0.07 * s, 0.05 * s, 0.07 * s, bev=0.01 * s), 'rust', which, (0, 0.38 * s, 0)),
            G(rig, sphere(0.04 * s, 8, 6), 'rust', which, (0, -0.14 * s, 0))]


def slugga(rig, which='offhand', s=1.0):
    return [G(rig, rbox(0.06 * s, 0.22 * s, 0.10 * s, bev=0.012 * s), 'gunmetal', which, (0, 0.08 * s, 0.05 * s)),
            G(rig, cyl(0.028 * s, 0.14 * s, seg=10), 'rust', which, (0, 0.23 * s, 0.06 * s), rot=(90, 0, 0)),
            G(rig, cyl(0.05 * s, 0.05 * s, seg=12), 'rust', which, (0, 0.06 * s, -0.02 * s), rot=(0, 90, 0)),
            G(rig, rbox(0.045 * s, 0.05 * s, 0.11 * s, bev=0.012 * s), 'leather', which, (0, -0.01 * s, -0.04 * s), rot=(-14, 0, 0)),
            G(rig, rbox(0.065 * s, 0.03 * s, 0.03 * s), 'red', which, (0, 0.15 * s, 0.10 * s))]


def shoota(rig, which='weapon', s=1.0):
    return [G(rig, rbox(0.08 * s, 0.40 * s, 0.13 * s, bev=0.015 * s), 'gunmetal', which, (0, 0.10 * s, 0.05 * s)),
            G(rig, cyl(0.026 * s, 0.34 * s, seg=10), 'rust', which, (0.02 * s, 0.46 * s, 0.08 * s), rot=(90, 0, 0)),
            G(rig, cyl(0.026 * s, 0.30 * s, seg=10), 'rust', which, (-0.025 * s, 0.44 * s, 0.05 * s), rot=(90, 0, 0)),
            G(rig, cyl(0.07 * s, 0.06 * s, seg=14), 'rust', which, (0, 0.14 * s, -0.08 * s), rot=(0, 90, 0)),
            G(rig, rbox(0.05 * s, 0.06 * s, 0.12 * s, bev=0.012 * s), 'leather', which, (0, -0.01 * s, -0.05 * s), rot=(-14, 0, 0)),
            G(rig, rbox(0.07 * s, 0.18 * s, 0.09 * s, bev=0.015 * s), 'gunmetal', which, (0, -0.19 * s, 0.03 * s)),
            G(rig, rbox(0.085 * s, 0.10 * s, 0.035 * s), 'yellow', which, (0, 0.18 * s, 0.13 * s)),
            G(rig, rbox(0.09 * s, 0.03 * s, 0.05 * s), 'red', which, (0, 0.30 * s, 0.10 * s))]


def power_klaw(rig, which='weapon'):
    p = [G(rig, rbox(0.22, 0.26, 0.20, bev=0.03), 'rust', which, (0, 0.10, 0)),
         G(rig, rbox(0.24, 0.10, 0.22, bev=0.02), 'yellow', which, (0, 0.20, 0)),
         G(rig, cyl(0.03, 0.22, seg=8), 'steel', which, (0.09, 0.08, 0.10), rot=(90, 0, 0)),
         G(rig, cyl(0.03, 0.22, seg=8), 'steel', which, (-0.09, 0.08, 0.10), rot=(90, 0, 0))]
    for k, (x, z) in enumerate(((-0.07, 0.05), (0.07, 0.05), (0.0, -0.07))):
        fing = tube([(0, 0, 0), (0, 0.14, 0.02 if z > 0 else -0.02), (0, 0.24, -0.02 if z > 0 else 0.03)], 0.03, seg=6, r_end=0.008)
        p.append(G(rig, fing, 'steel', which, (x, 0.24, z)))
    return p


# =============================================================================== registry
FACTIONS = {
    'marines': dict(
        materials=marine_materials,
        variants=[
            dict(id='marine', kind='tactical', cls='rifle'),
            dict(id='marine_plasma', kind='plasma', cls='rifle'),
            dict(id='marine_heavy', kind='heavy', cls='heavy'),
            dict(id='marine_sergeant', kind='sergeant', cls='onehand'),
        ],
        body=marine_body, parts=marine_parts, style=MARINE_STYLE,
    ),
    'guard': dict(
        materials=guard_materials,
        variants=[
            dict(id='guardsman', kind='trooper', cls='rifle'),
            dict(id='guard_plasma', kind='special', cls='rifle'),
            dict(id='guard_heavy', kind='heavy', cls='heavy'),
            dict(id='guard_sergeant', kind='sergeant', cls='onehand'),
            dict(id='guard_officer', kind='officer', cls='onehand'),
        ],
        body=guard_body, parts=guard_parts, style=GUARD_STYLE,
    ),
    'krieg': dict(
        materials=krieg_materials,
        variants=[
            dict(id='krieg', kind='trooper', cls='rifle'),
            dict(id='krieg_heavy', kind='heavy', cls='heavy'),
            dict(id='krieg_watchmaster', kind='watchmaster', cls='onehand'),
        ],
        body=krieg_body, parts=krieg_parts, style=KRIEG_STYLE,
    ),
    'orks': dict(
        materials=ork_materials,
        variants=[
            dict(id='ork_boy', kind='boy', cls='onehand'),
            dict(id='ork_shoota', kind='shoota', cls='rifle'),
            dict(id='ork_nob', kind='nob', cls='twohand'),
            dict(id='ork_warboss', kind='warboss', cls='onehand'),
        ],
        body=ork_body, parts=ork_parts, style=ORK_STYLE,
    ),
}
