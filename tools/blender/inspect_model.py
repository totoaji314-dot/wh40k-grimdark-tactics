# Inspect a GLB in Blender: print mesh/rig/material/animation facts and render turnaround + animation frames.
# blender -b -P tools/blender/inspect_model.py -- <model.glb> <outdir>
import bpy, sys, os, math, mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = os.path.abspath(argv[0]), os.path.abspath(argv[1])
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.vertex_groups]
arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
print('MESHES', [(m.name, len(m.data.vertices), len(m.data.polygons), [g.name for g in m.vertex_groups][:30]) for m in meshes])
print('UV', [(m.name, [uv.name for uv in m.data.uv_layers]) for m in meshes])
print('MATERIALS', [(mat.name, [n.type for n in mat.node_tree.nodes]) for mat in bpy.data.materials if mat.node_tree])
print('IMAGES', [(i.name, tuple(i.size), i.filepath) for i in bpy.data.images])
for a in arms:
    print('ARMATURE', a.name, [(b.name, b.parent.name if b.parent else None) for b in a.data.bones])
print('ACTIONS', [(ac.name, tuple(ac.frame_range)) for ac in bpy.data.actions])

# world bounds
mn = mathutils.Vector((1e9,) * 3); mx = -mn
for m in meshes:
    dg = bpy.context.evaluated_depsgraph_get()
    ev = m.evaluated_get(dg)
    for v in ev.data.vertices:
        w = m.matrix_world @ v.co
        mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
print('BOUNDS', tuple(mn), tuple(mx))
size = mx - mn
center = (mn + mx) / 2
h = max(size.z, 0.01)

scene = bpy.context.scene
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = eng; break
    except TypeError:
        pass
scene.render.resolution_x = 640; scene.render.resolution_y = 800
scene.render.film_transparent = False
world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.18, 0.19, 0.22, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scene.collection.objects.link(sun)
sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), 0, math.radians(35))
fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN')); scene.collection.objects.link(fill)
fill.data.energy = 1.0; fill.rotation_euler = (math.radians(60), 0, math.radians(-140))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.lens = 70

def shoot(name, yaw_deg, frame=None, action=None):
    if action is not None:
        for a in arms:
            a.animation_data_create(); a.animation_data.action = action
            if hasattr(a.animation_data, 'action_slot') and action.slots:
                a.animation_data.action_slot = action.slots[0]
    if frame is not None:
        scene.frame_set(int(frame))
    d = h * 3.2
    yaw = math.radians(yaw_deg)
    cam.location = center + mathutils.Vector((math.sin(yaw) * d, -math.cos(yaw) * d, h * 0.25))
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(out, name + '.png')
    bpy.ops.render.render(write_still=True)

shoot('turn_front', 0); shoot('turn_side', 90); shoot('turn_back', 180); shoot('turn_34', 35)
for ac in bpy.data.actions:
    f0, f1 = ac.frame_range
    shoot('anim_' + ac.name, 30, (f0 + f1) / 2, ac)
print('DONE')
