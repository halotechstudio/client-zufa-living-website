"""Brochure stills from the ZUFA_Site film scene (empty plots, no homes, daylight), headless:
  D:\\Blender\\blender.exe -b D:\\Zufa\\blender\\zufa_assets.blend --python D:\\Zufa\\blender\\render_stills.py
Env: ZF_SAMPLES (96), ZF_W (1920), ZF_ONLY (comma list of shot names)"""
import bpy, os, math

OUT = r"D:\Zufa\brochure\img"
sc = bpy.data.scenes["ZUFA_Site"]
bpy.context.window.scene = sc
for c in bpy.data.collections:
    c.hide_render = c.name == "Export"
sc.cycles.samples = int(os.environ.get("ZF_SAMPLES", 96))
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
sc.render.image_settings.file_format = 'PNG'
sc.render.resolution_percentage = 100
W = int(os.environ.get("ZF_W", 1920))
sc.render.resolution_x, sc.render.resolution_y = W, W * 9 // 16

# film shots: name -> frame (see film/film.json keys)
SHOTS = {"overview": 45, "arrival": 137, "avenues": 179, "club": 220, "quarter": 256, "half": 288}
only = os.environ.get("ZF_ONLY")
for name, f in SHOTS.items():
    if only and name not in only.split(","):
        continue
    sc.frame_set(f)
    sc.render.filepath = os.path.join(OUT, f"bl_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("done", name)

# top-down plan view without homes
if not only or "plan" in only.split(","):
    sc.frame_set(288)
    cam = bpy.data.objects.new("PlanCam", bpy.data.cameras.new("PlanCam"))
    sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 700
    cam.data.clip_end = 3000
    cam.location = (0, 0, 900)
    cam.rotation_euler = (0, 0, math.radians(-90))
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 2400, 1000
    sc.render.filepath = os.path.join(OUT, "bl_plan.png")
    bpy.ops.render.render(write_still=True)
    print("done plan")

