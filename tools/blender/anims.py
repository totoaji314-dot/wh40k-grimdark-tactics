# Procedural animation set. All poses are authored in armature axes:
#   +rx bends a vertical bone forward (toward -Y), +ry leans left (+X), +rz turns left.
#   Legs are driven by IK foot targets (root space), arms by IK hand targets on the weapon bones.
import math
from kit import Pose

TAU = math.pi * 2


def ss(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def env(t, a, b):
    """0 before a, ramps to 1 at b"""
    return ss((t - a) / max(1e-6, b - a))


def bump(t, a, m, b):
    """0 at a, 1 at m, 0 at b"""
    if t <= a or t >= b:
        return 0.0
    return ss((t - a) / (m - a)) if t < m else ss((b - t) / (b - m))


def lerp(a, b, t):
    return a + (b - a) * t


class Style:
    def __init__(self, **k):
        self.stance = 0.03      # extra half-width between feet
        self.hunch = 0.0        # chest forward (deg)
        self.head_fwd = 0.0
        self.weight = 0.0       # 0 light .. 1 power armour (hip drop, slower settle)
        self.swagger = 0.0      # side-to-side roll (orks)
        self.walk = dict(S=0.58, frames=30, duty=0.6, lift=0.11, bob=0.025)
        self.run = dict(S=0.92, frames=20, duty=0.36, lift=0.24, bob=0.05, lean=10)
        self.charge = dict(S=1.05, frames=18, duty=0.34, lift=0.28, bob=0.06, lean=16)
        self.knee = 0.035       # baseline hip drop (soft knees)
        self.__dict__.update(k)


def leg_reach(body, S, drop):
    L = (body.hip_h - body.knee_h) + (body.knee_h - body.ankle_h)
    h = body.hip_h - drop - body.ankle_h
    r = math.sqrt(max(1e-4, (L * 0.985) ** 2 - h * h))
    return min(S, 2 * r)


def stand(p, body, st, drop=None, spread=0.0, front=0.0):
    """Feet planted, hips lowered by `drop` (soft knees). front: left foot forward offset (combat stance)."""
    d = st.knee if drop is None else drop
    p.l('hips', 0, 0, -d)
    w = st.stance + spread
    p.l('ik_foot.L', w, -front, 0).r('ik_foot.L', rz=-8 - spread * 40)
    p.l('ik_foot.R', -w, front * 0.6, 0).r('ik_foot.R', rz=10 + spread * 40)
    return p


def gait(p, body, st, g, phase, extra_drop=0.0, turn=0.0):
    """Locomotion legs. phase 0..1 over one full cycle (left stance starts at 0)."""
    duty, lift, bob = g['duty'], g['lift'], g['bob']
    drop = st.knee + extra_drop + st.weight * 0.02
    S = leg_reach(body, g['S'], drop + bob)
    for side, off, sx in (('L', 0.0, 1), ('R', 0.5, -1)):
        ph = (phase + off) % 1.0
        if ph < duty:
            u = ph / duty
            y = -S / 2 + S * u
            z = 0.0
            pitch = lerp(-10, 0, ss(u * 4)) + lerp(0, 22, env(u, 0.7, 1.0))  # heel strike -> flat -> toe off
        else:
            u = (ph - duty) / (1 - duty)
            y = S / 2 - S * ss(u)
            z = lift * math.sin(math.pi * u) * (1.0 if u < 0.85 else 0.9)
            pitch = lerp(30, -12, ss(u * 1.2))
        p.l('ik_foot.' + side, sx * (st.stance + 0.005), y, z).r('ik_foot.' + side, rx=pitch, rz=-sx * 6)
    # hips: down at double support / contact, up at mid stance; side sway and yaw follow the legs
    c = math.cos(phase * TAU * 2)
    p.l('hips', math.sin(phase * TAU) * (0.018 + st.swagger * 0.03), 0, -drop - bob * (0.5 + 0.5 * c) - st.weight * 0.02 * max(0, c))
    p.r('hips', rz=8 * math.sin(phase * TAU + math.pi / 2) * (1 if g is st.walk else 0.6),
        ry=(3 + st.swagger * 8) * math.sin(phase * TAU))
    p.r('chest', rz=-6 * math.sin(phase * TAU + math.pi / 2), ry=-2 * math.sin(phase * TAU))
    p.r('head', rz=2 * math.sin(phase * TAU + math.pi / 2))
    return S


def posture(p, st, extra=0.0):
    p.r('spine', rx=st.hunch * 0.4 + extra * 0.4)
    p.r('chest', rx=st.hunch * 0.6 + extra * 0.6)
    p.r('neck', rx=-st.hunch * 0.5 + st.head_fwd)
    p.r('head', rx=-st.hunch * 0.3)


def breathe(p, t, amt=1.0):
    p.r('chest', rx=1.2 * amt * math.sin(t * TAU))
    p.r('head', rx=-0.8 * amt * math.sin(t * TAU))


# --------------------------------------------------------------------------- weapon carry poses (chest space)
# The weapon bone rest pose is the aiming pose. These offsets move it to other carry positions.
def w_rest(p, cls, amt=1.0):
    """Relaxed carry."""
    if cls == 'rifle':
        p.l('weapon', 0.05 * amt, 0.06 * amt, -0.16 * amt).r('weapon', rx=32 * amt, rz=22 * amt, ry=-10 * amt)
    elif cls == 'heavy':
        p.l('weapon', 0, 0.02 * amt, -0.04 * amt).r('weapon', rx=12 * amt, rz=8 * amt)
    elif cls == 'onehand':
        p.l('weapon', -0.02 * amt, 0.12 * amt, -0.30 * amt).r('weapon', rx=48 * amt, rz=-10 * amt)
        p.l('offhand', -0.02 * amt, 0.14 * amt, -0.30 * amt).r('offhand', rx=60 * amt)
    elif cls == 'twohand':
        p.l('weapon', 0.02 * amt, 0.0, -0.08 * amt).r('weapon', rx=25 * amt, ry=10 * amt)


def w_port(p, cls, amt=1.0):
    """Running carry (weapon held diagonally across the chest)."""
    if cls == 'rifle':
        p.l('weapon', 0.08 * amt, 0.10 * amt, -0.06 * amt).r('weapon', rx=-38 * amt, rz=48 * amt, ry=-30 * amt)
    elif cls == 'heavy':
        p.l('weapon', 0.02 * amt, 0.04 * amt, 0.0).r('weapon', rx=8 * amt, rz=12 * amt)
    elif cls == 'onehand':
        p.l('weapon', 0.0, 0.10 * amt, -0.15 * amt).r('weapon', rx=-20 * amt, rz=-10 * amt)
        p.l('offhand', -0.02 * amt, 0.10 * amt, -0.22 * amt).r('offhand', rx=45 * amt)
    elif cls == 'twohand':
        p.l('weapon', 0.02 * amt, 0.06 * amt, 0.10 * amt).r('weapon', rx=-30 * amt, ry=20 * amt)


# --------------------------------------------------------------------------- clip set
def build_clips(body, st, cls, prefix):
    """Returns list of (name, frames, fn, loop, meta). Names are '<prefix>_<clip>'."""
    C = []
    # body turned right while aiming so a weapon yawed left in chest space points straight ahead
    aim_yaw = -body.w_yaw if cls in ('rifle', 'heavy') else -6

    def add(name, frames, fn, loop=True, **meta):
        C.append((f'{prefix}_{name}', frames, fn, loop, meta))

    # ---------------- idle (relaxed, breathing, small weight shift)
    def idle(t, f):
        p = Pose(); stand(p, body, st); posture(p, st); breathe(p, t)
        p.l('hips', 0.012 * math.sin(t * TAU), 0, 0)
        p.r('head', rz=6 * math.sin(t * TAU * 0.5 + 1))
        w_rest(p, cls)
        p.l('weapon', 0, 0, 0.006 * math.sin(t * TAU))
        return p
    add('idle', 72, idle)

    # ---------------- aim / alert (weapon up, scanning)
    def aim(t, f):
        p = Pose(); stand(p, body, st, drop=st.knee + 0.03, spread=0.04, front=0.12); posture(p, st, 4); breathe(p, t, 0.6)
        p.r('hips', rz=aim_yaw * 0.5); p.r('chest', rz=aim_yaw * 0.5)
        p.r('chest', rz=4 * math.sin(t * TAU))
        if cls == 'onehand':
            p.r('offhand', rz=-aim_yaw * 0.4)
        p.l('weapon', 0, 0, 0.004 * math.sin(t * TAU * 2))
        return p
    add('aim', 48, aim)

    # ---------------- walk
    def walk(t, f):
        p = Pose(); gait(p, body, st, st.walk, t); posture(p, st, 2)
        w_rest(p, cls, 0.7)
        p.l('weapon', 0, 0, 0.012 * math.sin(t * TAU * 2))
        return p
    S = leg_reach(body, st.walk['S'], st.knee + st.walk['bob'])
    add('walk', st.walk['frames'], walk, speed=S / (st.walk['duty'] * st.walk['frames'] / 30))

    # ---------------- walk with weapon raised (advancing while aiming)
    def walk_aim(t, f):
        p = Pose(); gait(p, body, st, st.walk, t, extra_drop=0.04); posture(p, st, 6)
        p.r('hips', rz=aim_yaw * 0.4); p.r('chest', rz=aim_yaw * 0.6)
        p.r('chest', rz=6 * math.sin(t * TAU + math.pi / 2))  # cancel torso swing so the aim stays steady
        return p
    S2 = leg_reach(body, st.walk['S'], st.knee + 0.04 + st.walk['bob'])
    add('walk_aim', st.walk['frames'], walk_aim, speed=S2 / (st.walk['duty'] * st.walk['frames'] / 30))

    # ---------------- run
    def run(t, f):
        p = Pose(); gait(p, body, st, st.run, t, extra_drop=0.07); posture(p, st, st.run['lean'])
        w_port(p, cls)
        p.l('weapon', 0, 0, 0.02 * math.sin(t * TAU * 2))
        return p
    S3 = leg_reach(body, st.run['S'], st.knee + 0.07 + st.run['bob'])
    add('run', st.run['frames'], run, speed=S3 / (st.run['duty'] * st.run['frames'] / 30))

    # ---------------- charge (sprint, weapon forward / raised, shouting posture)
    def charge(t, f):
        p = Pose(); gait(p, body, st, st.charge, t, extra_drop=0.09); posture(p, st, st.charge['lean'])
        if cls == 'rifle':
            p.l('weapon', 0.02, 0.02, -0.12).r('weapon', rx=6, rz=8)  # bayonet levelled
        elif cls == 'heavy':
            w_port(p, cls)
        elif cls == 'onehand':
            p.l('weapon', 0.0, 0.10, 0.22).r('weapon', rx=-60, rz=-15)  # blade raised
            p.l('offhand', 0.0, 0.0, -0.10).r('offhand', rx=20)
        else:
            p.l('weapon', 0.0, 0.14, 0.32).r('weapon', rx=-70, ry=30)
        p.r('head', rx=-6)
        return p
    S4 = leg_reach(body, st.charge['S'], st.knee + 0.09 + st.charge['bob'])
    add('charge', st.charge['frames'], charge, speed=S4 / (st.charge['duty'] * st.charge['frames'] / 30))

    # ---------------- turn in place (shuffling steps)
    def turn(t, f):
        p = Pose(); posture(p, st); w_rest(p, cls, 0.6)
        p.l('hips', 0, 0, -st.knee - 0.02)
        for side, off, sx in (('L', 0.0, 1), ('R', 0.5, -1)):
            ph = (t + off) % 1.0
            z = 0.09 * math.sin(math.pi * min(1.0, ph / 0.45)) if ph < 0.45 else 0.0
            p.l('ik_foot.' + side, sx * st.stance + sx * 0.04 * math.sin(ph * TAU), 0.05 * math.sin(ph * TAU), z)
            p.r('ik_foot.' + side, rz=-sx * 8 + 14 * math.sin(ph * TAU))
        p.r('hips', rz=10 * math.sin(t * TAU))
        return p
    add('turn', 28, turn)

    # ---------------- fire (one shot / one burst cycle) from the aim pose
    def fire(t, f):
        p = aim(0, 0)
        if cls == 'onehand':
            k = bump(t, 0.0, 0.08, 0.55)
            p.l('offhand', 0, 0.05 * k, 0.02 * k).r('offhand', rx=-14 * k)
        elif cls == 'heavy':
            k = bump(t, 0.0, 0.12, 0.5)
            p.l('weapon', 0, 0.035 * k, 0.012 * k).r('weapon', rx=-3 * k, rz=1.5 * math.sin(t * 40))
            p.r('chest', rx=-2 * k)
        elif cls == 'twohand':
            pass
        else:
            k = bump(t, 0.0, 0.1, 0.6)
            p.l('weapon', 0, 0.05 * k, 0.015 * k).r('weapon', rx=-7 * k)
            p.r('chest', rx=-2.5 * k); p.r('head', rx=1.5 * k)
        return p
    add('fire', 12 if cls != 'heavy' else 6, fire, loop=False, event=0.08)

    # ---------------- reload
    def reload(t, f):
        p = aim(0, 0)
        if cls in ('rifle', 'heavy'):
            k = env(t, 0.0, 0.18) * (1 - env(t, 0.82, 1.0))
            p.l('weapon', 0.04 * k, 0.04 * k, -0.10 * k).r('weapon', rx=24 * k, ry=-28 * k, rz=10 * k)
            # left hand: magazine out -> pouch -> back in -> handguard
            out = bump(t, 0.12, 0.30, 0.48); pouch = bump(t, 0.30, 0.44, 0.62); inn = bump(t, 0.52, 0.66, 0.84)
            p.l('ik_hand.L', 0.03 * out + 0.16 * pouch, 0.18 * out + 0.25 * pouch + 0.16 * inn, -0.08 * out - 0.24 * pouch - 0.05 * inn)
            p.r('ik_hand.L', rx=-30 * pouch, rz=-20 * out)
            p.r('head', rx=12 * k, rz=6 * k); p.r('chest', rx=6 * k)
        elif cls == 'onehand':
            k = env(t, 0.0, 0.2) * (1 - env(t, 0.8, 1.0))
            p.l('offhand', 0.02 * k, 0.12 * k, -0.15 * k).r('offhand', rx=40 * k, ry=-30 * k)
            p.r('head', rx=10 * k)
        else:
            k = bump(t, 0, 0.5, 1)
            p.r('weapon', rx=-10 * k)
        return p
    add('reload', 66 if cls != 'heavy' else 84, reload, loop=False)

    # ---------------- melee A / B
    def melee_a(t, f):
        p = Pose(); stand(p, body, st, drop=st.knee + 0.06, spread=0.06, front=0.22); posture(p, st, 8)
        wind = bump(t, 0.0, 0.32, 0.5); strike = env(t, 0.32, 0.52) * (1 - env(t, 0.72, 1.0))
        lunge = bump(t, 0.3, 0.5, 0.95)
        p.l('hips', 0, -0.14 * lunge, -0.03 * lunge); p.l('ik_foot.L', 0, -0.16 * lunge, 0.05 * bump(t, 0.3, 0.4, 0.5))
        if cls == 'rifle':  # bayonet thrust
            p.l('weapon', 0.02, 0.18 * wind - 0.34 * strike, -0.06).r('weapon', rx=8, rz=10)
            p.r('chest', rz=18 * wind - 14 * strike)
        elif cls == 'heavy':  # butt bash
            p.l('weapon', 0.05, 0.1 * wind - 0.25 * strike, 0.12 * strike).r('weapon', rx=-30 * strike, rz=30 * strike)
        elif cls == 'onehand':  # horizontal slash right -> left
            p.l('weapon', -0.05 * wind + 0.10 * strike, 0.12 * wind - 0.18 * strike, 0.12 * wind).r('weapon', rx=-70 * wind - 10 * strike, rz=-75 * wind + 100 * strike - 25 * env(t, 0.72, 1.0) * 0)
            p.r('chest', rz=-28 * wind + 36 * strike); p.r('hips', rz=-10 * wind + 14 * strike)
            p.l('offhand', 0.05, 0.1, -0.2).r('offhand', rx=50)
        else:  # two-hand diagonal cleave
            p.l('weapon', 0.0, 0.10 * wind - 0.14 * strike, 0.35 * wind - 0.2 * strike).r('weapon', rx=-95 * wind + 70 * strike, ry=30 * wind - 20 * strike)
            p.r('chest', rz=-20 * wind + 30 * strike, rx=-8 * wind + 14 * strike)
        return p
    add('melee_a', 26, melee_a, loop=False, event=0.45)

    def melee_b(t, f):
        p = Pose(); stand(p, body, st, drop=st.knee + 0.08, spread=0.07, front=0.2); posture(p, st, 6)
        wind = bump(t, 0.0, 0.34, 0.52); strike = env(t, 0.34, 0.54) * (1 - env(t, 0.75, 1.0))
        p.l('hips', 0, -0.08 * strike, -0.05 * strike)
        if cls == 'rifle':  # rifle-butt stroke upward
            p.l('weapon', 0.02, 0.12 * wind - 0.2 * strike, -0.1 * wind + 0.18 * strike).r('weapon', rx=30 * wind - 50 * strike, ry=40 * strike, rz=20 * strike)
            p.r('chest', rz=20 * wind - 20 * strike)
        elif cls == 'heavy':
            p.l('weapon', 0.04, 0.05 * wind - 0.2 * strike, 0.1 * strike).r('weapon', rz=-30 * strike)
        elif cls == 'onehand':  # overhead chop
            p.l('weapon', 0.04, 0.16 * wind - 0.12 * strike, 0.38 * wind - 0.1 * strike).r('weapon', rx=-120 * wind + 60 * strike)
            p.r('chest', rx=-10 * wind + 18 * strike)
            p.l('offhand', 0.05, 0.1, -0.2).r('offhand', rx=50)
        else:  # overhead smash
            p.l('weapon', 0.0, 0.14 * wind - 0.1 * strike, 0.42 * wind - 0.25 * strike).r('weapon', rx=-130 * wind + 95 * strike)
            p.r('chest', rx=-12 * wind + 22 * strike)
        return p
    add('melee_b', 28, melee_b, loop=False, event=0.48)

    # ---------------- hit reaction
    def hit(t, f):
        p = aim(0, 0) if cls != 'twohand' else idle(0, 0)
        k = bump(t, 0.0, 0.18, 1.0)
        p.r('chest', rx=-14 * k, rz=8 * k); p.r('head', rx=-18 * k, rz=-10 * k); p.r('spine', rx=-6 * k)
        p.l('hips', 0, 0.06 * k, -0.03 * k)
        p.l('ik_foot.R', 0, 0.12 * bump(t, 0.1, 0.3, 0.6), 0.05 * bump(t, 0.1, 0.2, 0.35))
        p.l('weapon', 0, 0.05 * k, -0.04 * k).r('weapon', rx=10 * k)
        return p
    add('hit', 16, hit, loop=False)

    # ---------------- deaths (end lying on the ground, last frame is the corpse pose)
    def death_a(t, f):  # thrown backwards
        p = Pose(); posture(p, st)
        k1 = env(t, 0.0, 0.35); k2 = env(t, 0.25, 0.8); k3 = env(t, 0.75, 0.95)
        hh = body.hip_h
        p.l('hips', 0, 0.25 * k1 + 0.45 * k2, -(hh * 0.32) * k1 - (hh * 0.5) * k2 + 0.02 * bump(t, 0.75, 0.82, 0.95))
        p.r('hips', rx=-15 * k1 - 70 * k2, rz=12 * k2)
        p.r('spine', rx=-10 * k2); p.r('chest', rx=-8 * k2 + 6 * k3, rz=-10 * k2); p.r('head', rx=-30 * k1 + 20 * k2, rz=25 * k2)
        p.l('ik_foot.L', 0.04 * k2, -0.10 * k2, 0.08 * k2).r('ik_foot.L', rx=-22 * k2, rz=-20 * k2)
        p.l('ik_foot.R', -0.06 * k2, -0.25 * k2, 0.10 * k2).r('ik_foot.R', rx=-28 * k2, rz=25 * k2)
        p.l('weapon', 0.10 * k2, 0.1 * k1, -0.15 * k2).r('weapon', rx=40 * k1 + 50 * k2, rz=30 * k2, ry=-40 * k2)
        p.l('offhand', 0.0, 0.1 * k1, -0.2 * k2).r('offhand', rx=80 * k2)
        return p
    add('death_a', 44, death_a, loop=False)

    def death_b(t, f):  # knees buckle, falls forward on the face
        p = Pose(); posture(p, st)
        k1 = env(t, 0.0, 0.4); k2 = env(t, 0.35, 0.85); k3 = env(t, 0.8, 1.0)
        hh = body.hip_h
        p.l('hips', 0, -0.05 * k1 - 0.25 * k2, -(hh * 0.45) * k1 - (hh * 0.35) * k2)
        p.r('hips', rx=20 * k1 + 62 * k2, rz=-10 * k2)
        p.r('spine', rx=10 * k1 + 6 * k2); p.r('chest', rx=8 * k1 - 4 * k2 + 4 * k3); p.r('head', rx=20 * k1 - 40 * k2, rz=-30 * k2)
        p.l('ik_foot.L', 0.02, 0.18 * k1 + 0.25 * k2, 0.03 * k2).r('ik_foot.L', rx=60 * k1 + 20 * k2)
        p.l('ik_foot.R', -0.02, 0.22 * k1 + 0.30 * k2, 0.03 * k2).r('ik_foot.R', rx=65 * k1 + 20 * k2)
        p.l('weapon', -0.05 * k2, -0.1 * k2, -0.25 * k1).r('weapon', rx=60 * k1, rz=-30 * k2)
        p.l('offhand', 0.05 * k2, -0.05 * k2, -0.2 * k1).r('offhand', rx=60 * k1)
        return p
    add('death_b', 46, death_b, loop=False)

    # ---------------- cover: kneeling behind cover (hold) and firing from it
    def kneel(p, depth=1.0):
        hh = body.hip_h
        p.l('hips', 0, 0.12 * depth, -hh * 0.40 * depth)
        p.l('ik_foot.L', st.stance + 0.03, -0.22 * depth, 0).r('ik_foot.L', rz=-12)
        p.l('ik_foot.R', -st.stance - 0.04, 0.42 * depth, 0.02 * depth).r('ik_foot.R', rx=55 * depth, rz=14)

    def cover(t, f):
        p = Pose(); kneel(p); posture(p, st, 10); breathe(p, t, 0.8)
        p.r('hips', rz=aim_yaw * 0.4); p.r('chest', rz=aim_yaw * 0.3)
        w_rest(p, cls, 0.55)
        p.r('head', rz=10 * math.sin(t * TAU * 0.5))
        return p
    add('cover', 60, cover)

    def cover_fire(t, f):
        p = Pose(); kneel(p); posture(p, st, 6)
        p.r('hips', rz=aim_yaw * 0.5); p.r('chest', rz=aim_yaw * 0.5)
        if cls == 'onehand':
            k = bump(t, 0.0, 0.08, 0.55); p.l('offhand', 0, 0.05 * k, 0.02 * k).r('offhand', rx=-14 * k)
        elif cls != 'twohand':
            k = bump(t, 0.0, 0.1, 0.6); p.l('weapon', 0, 0.05 * k, 0.015 * k).r('weapon', rx=-7 * k)
        return p
    add('cover_fire', 12, cover_fire, loop=False, event=0.08)

    # ---------------- command: officer signals the advance / rallies
    def command(t, f):
        p = Pose(); stand(p, body, st, spread=0.03, front=0.1); posture(p, st, -2)
        k = bump(t, 0.05, 0.3, 0.92)
        if cls == 'onehand':
            p.l('weapon', -0.02, 0.0, 0.42 * k).r('weapon', rx=-110 * k, rz=-10 * k)  # blade raised high
            p.l('offhand', -0.02, 0.14, -0.30).r('offhand', rx=60)
        elif cls == 'twohand':
            p.l('weapon', 0.0, 0.0, 0.4 * k).r('weapon', rx=-100 * k, ry=40 * k)
        else:
            w_rest(p, cls, 1 - k * 0.3)
            p.l('ik_hand.L', 0.10 * k, -0.25 * k, 0.45 * k).r('ik_hand.L', rx=-60 * k)  # arm thrown forward
        p.r('head', rx=-12 * k); p.r('chest', rz=10 * math.sin(t * TAU) * k)
        return p
    add('command', 48, command, loop=False)

    return C
