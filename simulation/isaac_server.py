"""Local RTX render worker. Run with Isaac Sim's python.bat, never inference Python."""
import argparse
import base64
import hashlib
import io
import json
import math
import os
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer


def validate_scene(scene):
    if scene.get('version') != 1 or scene.get('upAxis') != 'Y' or scene.get('metersPerUnit') != 1:
        raise ValueError('Expected version 1, Y-up, meter scene')
    if (scene.get('width'), scene.get('height')) != (1280, 720):
        raise ValueError('Expected 1280 x 720')
    camera = scene['camera']
    if not 1 < camera['verticalFov'] < 179 or not 0 < camera['near'] < camera['far']:
        raise ValueError('Invalid camera')
    def matrix(value):
        if len(value) != 16 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in value):
            raise ValueError('Invalid transform')
    matrix(camera['matrix'])
    if not scene['meshes'] or len(scene['meshes']) > 20000:
        raise ValueError('Invalid mesh count')
    for mesh in scene['meshes']:
        matrix(mesh['matrix'])
        if len(mesh['indices']) % 3 or any(not isinstance(i, int) or i < 0 or i >= len(mesh['points']) for i in mesh['indices']):
            raise ValueError('Invalid triangle indices')
        for point in mesh['points']:
            if len(point) != 3 or not all(math.isfinite(v) for v in point):
                raise ValueError('Invalid vertex')
    return scene


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5103)
    parser.add_argument('--samples', type=int, default=32)
    parser.add_argument('--graphics', choices=['vulkan', 'd3d12'], default='d3d12')
    parser.add_argument('--smoke', help='Render a test scene to this PNG and exit')
    parser.add_argument('--scene', help='Use an exported scene JSON instead of the smoke fixture')
    args = parser.parse_args()
    import isaacsim
    from isaacsim import SimulationApp
    install = Path(os.environ.get('ISAAC_PATH') or Path(isaacsim.__file__).parent)
    extension_args = [arg for folder in ('exts', 'extscache', 'extsDeprecated') for arg in ('--ext-folder', str(install / folder))]
    app = SimulationApp({'headless': True, 'renderer': 'PathTracing', 'width': 1280, 'height': 720,
                         'multi_gpu': False, 'active_gpu': 0, 'limit_cpu_threads': 8,
                         'extra_args': extension_args + ['--/app/extensions/registryEnabled=false',
                             '--/app/vulkan=' + str(args.graphics == 'vulkan').lower(), '--' + args.graphics]},
                        experience=str(Path(__file__).with_name('lab-sentry.kit').resolve()))
    import carb
    import omni.usd
    import omni.replicator.core as rep
    from pxr import Gf, Sdf, UsdGeom, UsdLux, UsdShade
    from PIL import Image

    settings = carb.settings.get_settings()
    settings.set('/rtx/pathtracing/spp', args.samples)
    settings.set('/rtx/pathtracing/totalSpp', args.samples)
    settings.set('/rtx/post/aa/op', 0)
    settings.set('/rtx/post/tonemap/enableAutoExposure', False)
    omni.usd.get_context().new_stage()
    stage = omni.usd.get_context().get_stage()
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 1)
    camera = UsdGeom.Camera.Define(stage, '/Camera')
    camera.CreateHorizontalApertureAttr(36)
    camera.CreateVerticalApertureAttr(36 * 720 / 1280)
    product = rep.create.render_product('/Camera', (1280, 720))
    rgb = rep.AnnotatorRegistry.get_annotator('rgb')
    rgb.attach(product)

    def transform(prim, values):
        # Three column-major arrays become rows of USD's row-vector matrix.
        UsdGeom.Xformable(prim).MakeMatrixXform().Set(Gf.Matrix4d(*values))

    def render(scene):
        validate_scene(scene)
        texture_files = {}
        texture_dir = Path(__file__).resolve().parents[1] / '.runtime' / 'isaac-textures'
        texture_dir.mkdir(parents=True, exist_ok=True)
        for key, value in scene.get('textures', {}).items():
            if not value.startswith('data:image/png;base64,'):
                raise ValueError('Only embedded PNG textures supported')
            raw = base64.b64decode(value.split(',', 1)[1], validate=True)
            file = texture_dir / (hashlib.sha256(raw).hexdigest() + '.png')
            if not file.exists():
                file.write_bytes(raw)
            texture_files[key] = file.as_posix()
        stage.RemovePrim('/World')
        UsdGeom.Xform.Define(stage, '/World')
        camera.GetFocalLengthAttr().Set((36 * 720 / 1280) / (2 * math.tan(math.radians(scene['camera']['verticalFov']) / 2)))
        camera.CreateClippingRangeAttr(Gf.Vec2f(scene['camera']['near'], scene['camera']['far']))
        transform(camera.GetPrim(), scene['camera']['matrix'])
        settings.set('/rtx/post/tonemap/filmIso', 100.0 * scene.get('exposure', 1))
        for i, data in enumerate(scene['meshes']):
            mesh = UsdGeom.Mesh.Define(stage, f'/World/mesh_{i}')
            mesh.CreatePointsAttr([Gf.Vec3f(*p) for p in data['points']])
            mesh.CreateFaceVertexCountsAttr([3] * (len(data['indices']) // 3))
            mesh.CreateFaceVertexIndicesAttr(data['indices'])
            mesh.CreateSubdivisionSchemeAttr('none')
            mesh.CreateDoubleSidedAttr(data['material']['doubleSided'])
            if data.get('normals'):
                mesh.CreateNormalsAttr([Gf.Vec3f(*n) for n in data['normals']])
                mesh.SetNormalsInterpolation('vertex')
            transform(mesh.GetPrim(), data['matrix'])
            material = UsdShade.Material.Define(stage, f'/World/material_{i}')
            shader = UsdShade.Shader.Define(stage, f'/World/material_{i}/Shader')
            shader.CreateIdAttr('UsdPreviewSurface')
            m = data['material']
            shader.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*m['color']))
            if m.get('texture'):
                UsdGeom.PrimvarsAPI(mesh).CreatePrimvar('st', Sdf.ValueTypeNames.TexCoord2fArray, 'vertex').Set([Gf.Vec2f(*uv) for uv in data['uv']])
                reader = UsdShade.Shader.Define(stage, f'/World/material_{i}/UV')
                reader.CreateIdAttr('UsdPrimvarReader_float2')
                reader.CreateInput('varname', Sdf.ValueTypeNames.Token).Set('st')
                texture = UsdShade.Shader.Define(stage, f'/World/material_{i}/Texture')
                texture.CreateIdAttr('UsdUVTexture')
                texture.CreateInput('file', Sdf.ValueTypeNames.Asset).Set(texture_files[m['texture']])
                texture.CreateInput('sourceColorSpace', Sdf.ValueTypeNames.Token).Set('sRGB')
                texture.CreateInput('scale', Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(*m['color'], m['opacity']))
                texture.CreateInput('st', Sdf.ValueTypeNames.Float2).ConnectToSource(reader.ConnectableAPI(), 'result')
                shader.GetInput('diffuseColor').ConnectToSource(texture.ConnectableAPI(), 'rgb')
            for key, value in [('roughness', m['roughness']), ('metallic', m['metalness']), ('opacity', m['opacity']), ('ior', m['ior'])]:
                shader.CreateInput(key, Sdf.ValueTypeNames.Float).Set(value)
            if m.get('texture'):
                shader.GetInput('opacity').ConnectToSource(texture.ConnectableAPI(), 'a')
            material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), 'surface')
            UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(material)
        for i, light in enumerate(scene['lights']):
            if light['kind'] in ('HemisphereLight', 'AmbientLight'):
                lamp = UsdLux.DomeLight.Define(stage, f'/World/light_{i}')
            elif light['kind'] == 'DirectionalLight':
                lamp = UsdLux.DistantLight.Define(stage, f'/World/light_{i}')
                position, target = Gf.Vec3d(*light['position']), Gf.Vec3d(*light['target'])
                direction = target - position
                rotation = Gf.Rotation(Gf.Vec3d(0, 0, -1), direction)
                UsdGeom.Xformable(lamp).AddOrientOp().Set(Gf.Quatf(rotation.GetQuat()))
                lamp.CreateAngleAttr(.53)
            else:
                continue
            lamp.CreateColorAttr(Gf.Vec3f(*light['color']))
            lamp.CreateIntensityAttr(light['intensity'] * 500)
        for _ in range(5):
            app.update()
        rep.orchestrator.step(rt_subframes=8, pause_timeline=True)
        data = rgb.get_data()
        if data is None or data.size == 0:
            raise RuntimeError('RTX returned no pixels')
        output = io.BytesIO()
        Image.fromarray(data[:, :, :3]).save(output, format='PNG')
        return output.getvalue()

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, body, content_type='application/json'):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self.reply(200 if self.path == '/health' else 404, json.dumps({'renderer': 'isaac', 'ready': True, 'samples': args.samples}).encode())

        def do_POST(self):
            if self.path != '/render':
                return self.reply(404, b'{}')
            origin = self.headers.get('Origin', '')
            if origin and origin not in ('http://127.0.0.1:5173', 'http://localhost:5173'):
                return self.reply(403, b'{"error":"Local app only"}')
            if self.headers.get('Content-Type') != 'application/json':
                return self.reply(415, b'{}')
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 128 * 1024 * 1024:
                return self.reply(413, b'{}')
            try:
                started = time.monotonic()
                scene = json.loads(self.rfile.read(size))
                validate_scene(scene)
                diagnostic = Path(__file__).resolve().parents[1] / '.runtime'
                diagnostic.mkdir(exist_ok=True)
                (diagnostic / 'isaac-last-scene.json').write_text(json.dumps(scene))
                image = render(scene)
                (diagnostic / 'isaac-last-render.png').write_bytes(image)
                print(f'Render completed in {time.monotonic() - started:.2f}s', flush=True)
                self.reply(200, image, 'image/png')
            except Exception as error:
                self.reply(422, json.dumps({'error': str(error)}).encode())

    try:
        if args.smoke:
            scene = json.loads((Path(args.scene) if args.scene else Path(__file__).with_name('smoke.json')).read_text())
            Path(args.smoke).write_bytes(render(scene))
        else:
            server = HTTPServer(('127.0.0.1', args.port), Handler)
            server.timeout = .1
            print(f'Isaac ready at http://127.0.0.1:{args.port}', flush=True)
            while app.is_running():
                server.handle_request()
                app.update()
            server.server_close()
    finally:
        rgb.detach(product)
        app.close()


if __name__ == '__main__':
    main()
