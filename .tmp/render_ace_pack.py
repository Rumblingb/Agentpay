import argparse
import os
from pathlib import Path
import sys

import bpy


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps" / "meridian" / "assets"


def ensure_cycles(scene: bpy.types.Scene) -> None:
    scene.render.engine = "CYCLES"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_percentage = 100
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 2048
    scene.cycles.samples = 48
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 2
    scene.cycles.transparent_max_bounces = 6
    scene.cycles.use_fast_gi = True
    scene.render.use_persistent_data = True
    scene.view_settings.look = "AgX - Very High Contrast"
    scene.view_settings.exposure = -0.85
    scene.view_settings.gamma = 0.96


def tune_scene() -> bpy.types.Object:
    scene = bpy.context.scene
    ensure_cycles(scene)

    camera = scene.camera or bpy.data.objects["Camera"]
    scene.camera = camera
    camera.location = (0.0, -4.18, 0.055)
    camera.rotation_euler = (1.590973, 0.0, 0.0)
    camera.data.lens = 72.0

    key = bpy.data.objects["AceKey"]
    key.data.energy = 980.0
    key.data.color = (1.0, 0.985, 0.972)

    fill = bpy.data.objects["AceFill"]
    fill.data.energy = 54.0
    fill.data.color = (0.72, 0.82, 0.96)

    rim = bpy.data.objects["AceRim"]
    rim.data.energy = 1560.0
    rim.data.color = (0.72, 0.84, 1.0)

    crown = bpy.data.objects["AceCrown"]
    crown.data.energy = 38.0
    crown.data.color = (0.88, 0.94, 1.0)

    obj = bpy.data.objects["Mesh1.0"]
    mat = bpy.data.materials["AceLuxeObsidian"]
    principled = mat.node_tree.nodes["Principled BSDF"]
    color = mat.node_tree.nodes["Color"]
    noise = mat.node_tree.nodes["Noise Texture"]
    bump = mat.node_tree.nodes["Bump"]

    color.outputs[0].default_value = (0.22, 0.27, 0.36, 1.0)
    principled.inputs["Base Color"].default_value = (0.18, 0.22, 0.30, 1.0)
    principled.inputs["Metallic"].default_value = 0.42
    principled.inputs["Roughness"].default_value = 0.17
    principled.inputs["Specular IOR Level"].default_value = 0.72
    principled.inputs["Coat Weight"].default_value = 0.38
    principled.inputs["Coat Roughness"].default_value = 0.06
    principled.inputs["Subsurface Weight"].default_value = 0.0
    noise.inputs["Scale"].default_value = 22.0
    noise.inputs["Detail"].default_value = 8.0
    bump.inputs["Strength"].default_value = 0.028

    if obj.data.shape_keys:
        for key_block in obj.data.shape_keys.key_blocks:
            key_block.value = 0.0

    return obj


def render(scene: bpy.types.Scene, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_path)
    bpy.ops.render.render(write_still=True)


def set_shape(obj: bpy.types.Object, values: dict[str, float]) -> None:
    keys = obj.data.shape_keys.key_blocks if obj.data.shape_keys else None
    if not keys:
        return
    for key_block in keys:
        key_block.value = values.get(key_block.name, 0.0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["preview", "full"], default="preview")
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args = parser.parse_args(argv)

    scene = bpy.context.scene
    obj = tune_scene()

    preview_path = ROOT / ".tmp" / "ace-face-render-preview.png"
    render(scene, preview_path)

    if args.mode == "preview":
        bpy.ops.wm.save_mainfile(filepath=str(ASSETS / "ace-brain-foundation.blend"))
        print(preview_path)
        return

    outputs = {
        "ace-face-render.png": {},
        "ace-face-viseme-jaw.png": {"Jaw_Open": 0.82},
        "ace-face-viseme-oo.png": {"Jaw_Open": 0.34, "Viseme_OO": 1.0},
        "ace-face-viseme-ee.png": {"Jaw_Open": 0.28, "Viseme_EE": 1.0},
        "ace-face-focus-brow.png": {"Focus_Brow": 0.85},
        "ace-face-serene-smile.png": {"Serene_Smile": 0.7},
    }

    for name, values in outputs.items():
        set_shape(obj, values)
        render(scene, ASSETS / name)

    set_shape(obj, {})
    bpy.ops.wm.save_mainfile(filepath=str(ASSETS / "ace-brain-foundation.blend"))
    print("Rendered Ace pack")


if __name__ == "__main__":
    main()
