"""'The layout comes alive': the brochure's drawn plan lifting into the real site, then a 360 orbit.
Renders from the ZUFA_Site scene with the lighting frozen at 9 am and every plot still empty.
  tilt/t##.webp   30 frames: top-down telephoto (north up, aligned with the Layout L1 drawing) -> 3/4 aerial
  orbit/o##.webp  72 frames: 360 degrees around the site at the end height of the tilt (5 degrees apart)
  layout3d.json   frame list + every plot's outline projected into each orbit frame (for hover and labels)
Headless:  D:\\Blender\\blender.exe -b D:\\Zufa\\blender\\zufa_assets.blend --python D:\\Zufa\\blender\\render_layout3d.py
Env: L3_OUT (D:\\Zufa\\assets\\layout3d)  L3_W (1600)  L3_SAMPLES (40)  L3_ONLY ("tilt" | "orbit" | "t0,o0" test frames)"""
import bpy, os, json, math
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

OUT = os.environ.get("L3_OUT", r"D:\Zufa\assets\layout3d")
W = int(os.environ.get("L3_W", 1600)); H = W * 9 // 16
ONLY = os.environ.get("L3_ONLY", "")
os.makedirs(os.path.join(OUT, "tilt"), exist_ok=True)
os.makedirs(os.path.join(OUT, "orbit"), exist_ok=True)
S = json.load(open(r"D:\Zufa\blender\site.json"))

sc = bpy.data.scenes["ZUFA_Site"]
bpy.context.window.scene = sc
for c in bpy.data.collections:
    c.hide_render = c.name == "Export"
# freeze the film rig at its 9 am shot (homes not yet built), then drop its keys so nothing moves
sc.frame_set(179)
for idb in [sc, sc.world.node_tree if sc.world else None] + [o for o in sc.objects] + [o.data for o in sc.objects if o.data]:
    ad = getattr(idb, "animation_data", None)
    if ad and ad.action:
        ad.action = None
sc.render.use_persistent_data = True
cy = sc.cycles
cy.samples = int(os.environ.get("L3_SAMPLES", 40))
cy.use_denoising = True
prefs = bpy.context.preferences.addons["cycles"].preferences
for dt in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = dt
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == dt
        sc.cycles.device = 'GPU'
        break
    except Exception:
        pass
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.render.image_settings.file_format = 'WEBP'
sc.render.image_settings.color_mode = 'RGB'
sc.render.image_settings.quality = 82

cam = bpy.data.objects.get("Layout3DCam") or bpy.data.objects.new("Layout3DCam", bpy.data.cameras.new("Layout3DCam"))
if cam.name not in sc.collection.objects:
    sc.collection.objects.link(cam)
cam.constraints.clear()
cam.data.sensor_fit = 'HORIZONTAL'
cam.data.clip_start, cam.data.clip_end = 1.0, 40000
sc.camera = cam

C = Vector((0.0, -20.0, 0.0))            # site centre (Blender coords), a little south to take in the gate
W0, W1 = 1300.0, 760.0                   # ground width seen across the frame: top-down -> 3/4 view
E0, E1 = math.radians(89.6), math.radians(32.0)
D0, D1 = 9000.0, 560.0                   # camera distance: telephoto (near-orthographic) -> aerial
A0, A1 = math.radians(90.0), math.radians(25.0)   # azimuth: from the south, north up (Layout L1 drawing) -> from the WSW


def place(dist, elev, az, width):
    """Camera looking at C from `dist`, elevation `elev`, azimuth `az` (0 = from the west looking east, 90 = from the south looking north)."""
    back = Vector((-math.cos(elev) * math.cos(az), -math.cos(elev) * math.sin(az), math.sin(elev)))
    P = C + back * dist
    f = (C - P).normalized()
    hint = Vector((0, 0, 1)) if abs(f.z) < 0.9995 else Vector((math.cos(az), math.sin(az), 0))
    up = (hint - f * hint.dot(f)).normalized()
    right = f.cross(up)
    cam.matrix_world = Matrix((
        (right.x, up.x, -f.x, P.x),
        (right.y, up.y, -f.y, P.y),
        (right.z, up.z, -f.z, P.z),
        (0, 0, 0, 1)))
    # horizontal field of view that shows `width` metres of ground across the frame centre
    cam.data.angle = 2 * math.atan((width / 2) / dist)


def smooth(t):
    return t * t * t * (t * (6 * t - 15) + 10)


def project():
    sc.view_layers[0].update()
    out = []
    for p in S['plots']:
        pts = []
        for x, y in p['poly']:
            v = world_to_camera_view(sc, cam, Vector((x, y, 0.5)))
            pts += [round(v.x, 4), round(1 - v.y, 4)]
        out.append(pts)
    return out


def render(path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


NT, NO = 30, 72
frames = {"w": W, "h": H, "tilt": NT, "orbit": NO, "center": list(C), "w0": W0, "north_up": True, "plots": [{"id": p['id'], "cat": p['cat'], "sqyd": p['sqyd']} for p in S['plots']], "proj": []}
want = set(ONLY.split(",")) if ONLY and ONLY not in ("tilt", "orbit") else None
if ONLY != "orbit":
    for i in range(NT):
        if want is not None and f"t{i}" not in want:
            continue
        t = smooth(i / (NT - 1))
        dist = math.exp(math.log(D0) + (math.log(D1) - math.log(D0)) * t)
        place(dist, E0 + (E1 - E0) * t, A0 + (A1 - A0) * t, W0 + (W1 - W0) * t)
        render(os.path.join(OUT, "tilt", f"t{i:02d}.webp"))
        print("tilt", i, flush=True)
if ONLY != "tilt":
    for i in range(NO):
        if want is not None and f"o{i}" not in want:
            continue
        place(D1, E1, A1 + math.radians(5 * i), W1)
        frames["proj"].append(project())
        render(os.path.join(OUT, "orbit", f"o{i:02d}.webp"))
        print("orbit", i, flush=True)
if not ONLY:
    json.dump(frames, open(os.path.join(OUT, "layout3d.json"), "w"), separators=(",", ":"))
print("done", flush=True)
