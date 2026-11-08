#!/usr/bin/env python3
"""Verify real animation downloads, decoded frames, selection and recovery."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageChops, ImageStat

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
STATE = """() => {const g=window.__segments.ui.graph;return {
  selected:g.selected?.id, progress:g.progress, playing:g.playing,
  position:g.camera.position.toArray(), rotation:g.camera.quaternion.toArray(),
  target:g.controls.target.toArray(), scan:g.scan.visible, map:g.mapInput.checked,
  links:g.showSaved, edges:g.selectionLines.userData.edges,
  panelScroll:g.detail.scrollTop, relationScroll:g.detail.querySelector('.graph-relations .graph-relation-list')?.scrollTop,
  relationsOpen:g.detail.querySelector('.graph-relations')?.open,
  previewMode:g.ui.preview.mode, previewPaused:g.ui.preview.paused
}}"""


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:4186/physical-ai-lab/')
    args = parser.parse_args()
    out = ROOT / 'artifacts/graph-export'
    out.mkdir(parents=True, exist_ok=True)
    report, errors, downloads = {'passed': False, 'checks': []}, [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/opt/google/chrome/chrome', headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
                  '--disable-software-rasterizer', '--use-gl=angle', '--use-angle=gl'])
        page = await browser.new_page(viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('download', lambda download: downloads.append(download.suggested_filename))
        try:
            await page.goto(args.url, wait_until='domcontentloaded')
            await page.wait_for_function('window.__segments?.viewer.loaded', timeout=180000)
            print('Full point cloud loaded; testing graph video export', flush=True)
            await page.locator('#graph-button').click()
            await page.wait_for_function('window.__segments.ui.graph.progress===1', timeout=30000)
            await page.evaluate('() => {const g=window.__segments.ui.graph;g.select(g.model.byId.get("n81").areaId)}')
            await page.locator('.graph-detail').get_by_role('button', name='White sidetable 1', exact=True).click()
            await page.wait_for_function('window.__segments.ui.preview.mode==="novel" && window.__segments.ui.preview.gif.complete && window.__segments.ui.preview.gif.naturalWidth>0')
            await page.locator('.graph-player input').evaluate('(n)=>{n.value=650;n.dispatchEvent(new Event("input",{bubbles:true}))}')
            # A zoomed and panned view must remain exactly as it was after export.
            await page.evaluate('''() => { const g=window.__segments.ui.graph;
              g.controls.enableDamping=false;g.controls.update();g.camera.position.lerp(g.controls.target,.45);g.controls.update();
            }''')
            before = await page.evaluate(STATE)
            panel_box = await page.locator('.graph-detail').bounding_box()
            preview_box = await page.locator('.graph-detail .object-preview-stage').bounding_box()
            await page.locator('.graph-detail').screenshot(path=str(out / 'source-panel.png'))
            await page.screenshot(path=str(out / 'before.png'))
            button = page.get_by_role('button', name='Download scene graph animation', exact=True)
            async with page.expect_download(timeout=45000) as pending:
                await button.click()
                await page.screenshot(path=str(out / 'recording.png'))
            download = await pending.value
            assert 'white-sidetable-1' in download.suggested_filename
            video = out / download.suggested_filename
            await download.save_as(video)
            await page.wait_for_function('!window.__segments.ui.graph.exportController')
            assert await page.evaluate(STATE) == before, 'Export must restore the full viewer state'
            assert not await page.locator('.graph-export-dialog').is_visible()
            assert await button.is_enabled()
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', str(video)]))
            stream = next(s for s in probe['streams'] if s['codec_type'] == 'video')
            assert (stream['width'], stream['height']) == (1920, 1080)
            assert int(stream['nb_read_frames']) > 50
            packets = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_packets', '-select_streams', 'v', '-of', 'json', str(video)]))['packets']
            duration = float(packets[-1]['pts_time']) - float(packets[0]['pts_time'])
            assert 6.8 < duration < 12, duration
            hashes = []
            for second in (2, 6):
                frame = out / f'video-{second}s.png'
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(second), '-i', str(video), '-frames:v', '1', str(frame)], check=True)
                hashes.append(hashlib.sha256(frame.read_bytes()).hexdigest())
            assert hashes[0] != hashes[1], 'The download must contain changing animation frames'
            scale = min(416 / panel_box['width'], 1032 / panel_box['height'])
            x, y = 1920 - 24 - panel_box['width'] * scale, 24
            px = x + (preview_box['x'] - panel_box['x']) * scale
            py = y + (preview_box['y'] - panel_box['y']) * scale
            crop = (round(px + 5), round(py + 5), round(px + preview_box['width'] * scale - 5), round(py + preview_box['height'] * scale - 5))
            early, late = [Image.open(out / f'video-{s}s.png').convert('RGB') for s in (2, 6)]
            motion = sum(ImageStat.Stat(ImageChops.difference(early.crop(crop), late.crop(crop))).mean) / 3
            assert motion > 1, f'The generated object preview must animate, not freeze ({motion})'
            title_crop = (round(x), round(y), round(x + panel_box['width'] * scale), round(py - 5))
            assert max(ImageStat.Stat(late.crop(title_crop)).stddev) > 12, 'The object title and panel controls must be visible'
            late.crop((round(x), 24, 1896, round(24 + panel_box['height'] * scale))).save(out / 'downloaded-panel.png')
            report.update(video=video.name, bytes=video.stat().st_size, frames=stream['nb_read_frames'], duration=duration)
            report['checks'].append('Selected object: real 1080p video with changing frames, complete ending and exact state restoration')
            report['checks'].append(f'White sidetable 1 details and generated preview are included; preview motion difference {motion:.2f}')
            print('Selected animation decoded successfully', flush=True)

            await button.click()
            await page.get_by_role('button', name='Cancel', exact=True).click()
            await page.wait_for_function('!window.__segments.ui.graph.exportController')
            assert await page.evaluate(STATE) == before
            assert len(downloads) == 1
            await button.click()
            await page.keyboard.press('Escape')
            await page.wait_for_function('!window.__segments.ui.graph.exportController')
            assert await page.evaluate('window.__segments.ui.graph.active')
            assert await page.evaluate(STATE) == before
            assert len(downloads) == 1
            report['checks'].append('Cancel and Escape discard partial videos and leave the graph open')

            await page.evaluate('window.savedRecorder=window.MediaRecorder;window.MediaRecorder=undefined')
            await button.click()
            await page.wait_for_function('!window.__segments.ui.graph.exportController')
            assert 'unavailable' in await page.locator('.graph-export-dialog').inner_text()
            await page.get_by_role('button', name='Close', exact=True).click()
            await page.evaluate('window.MediaRecorder=window.savedRecorder;delete window.savedRecorder')
            assert await page.evaluate(STATE) == before
            report['checks'].append('Unsupported browser shows an actionable error and preserves state')

            async def preview_recording(name, expect_motion):
                panel = await page.locator('.graph-detail').bounding_box()
                preview = await page.locator('.graph-detail .object-preview-stage').bounding_box()
                original = await page.evaluate(STATE)
                async with page.expect_download(timeout=45000) as pending:
                    await button.click()
                video = out / f'{name}.webm'
                await (await pending.value).save_as(video)
                await page.wait_for_function('!window.__segments.ui.graph.exportController')
                assert await page.evaluate(STATE) == original
                scale = min(416 / panel['width'], 1032 / panel['height'])
                px = 1920 - 24 - panel['width'] * scale + (preview['x'] - panel['x']) * scale
                py = 24 + (preview['y'] - panel['y']) * scale
                crop = (round(px + 5), round(max(25, py + 5)), round(px + preview['width'] * scale - 5), round(py + preview['height'] * scale - 5))
                frames = []
                for second in (2, 6):
                    path = out / f'{name}-{second}s.png'
                    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(second), '-i', str(video), '-frames:v', '1', str(path)], check=True)
                    frames.append(Image.open(path).convert('RGB').crop(crop))
                difference = sum(ImageStat.Stat(ImageChops.difference(*frames)).mean) / 3
                # The lossy video encoder slightly changes even a static crop
                # while the rest of the frame animates; allow that small noise.
                assert difference > 3 if expect_motion else difference < 3, (name, difference)
                assert max(ImageStat.Stat(frames[-1]).stddev) > 10, 'Preview must not be blank'

            await page.get_by_role('button', name='Pause generated view', exact=True).click()
            await page.locator('.graph-detail').evaluate('(n)=>{n.scrollTop=30;n.querySelector(".graph-relations .graph-relation-list").scrollTop=40}')
            await preview_recording('paused-generated-preview', False)
            report['checks'].append('Paused generated preview stays still; panel and nested relationship scrolling are preserved')
            await page.locator('.graph-detail').evaluate('(n)=>n.scrollTop=0')
            await page.get_by_role('button', name='3D scan', exact=True).click()
            await page.get_by_role('button', name='Play object rotation', exact=True).click()
            await preview_recording('rotating-scan-preview', True)
            report['checks'].append('3D scan preview rotates in the downloaded video and retains its mode afterward')

            await page.locator('.graph-detail-close').click()
            await page.locator('.graph-options input').nth(0).uncheck()
            await page.locator('.graph-options input').nth(1).uncheck()
            await page.locator('.graph-options input').nth(2).uncheck()
            await page.set_viewport_size({'width': 390, 'height': 844})
            await page.wait_for_timeout(500)
            mobile_before = await page.evaluate(STATE)
            for selector in ['.graph-player', '.graph-download']:
                box = await page.locator(selector).bounding_box()
                assert box and 0 <= box['x'] and box['x'] + box['width'] <= 390, (selector, box)
            await page.screenshot(path=str(out / 'mobile.png'))
            async with page.expect_download(timeout=45000) as pending:
                await button.click()
            download = await pending.value
            assert 'whole-lab' in download.suggested_filename
            await download.save_as(out / download.suggested_filename)
            await page.wait_for_function('!window.__segments.ui.graph.exportController')
            assert await page.evaluate(STATE) == mobile_before
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            report['checks'].append('Mobile export without selection, with scan/map/spatial links off; controls fit the screen')
            assert not errors, errors
            report.update(passed=True, errors=errors)
        except BaseException as error:
            report.update(error=str(error), errors=errors)
            await page.screenshot(path=str(out / 'failure.png'))
            raise
        finally:
            (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report), flush=True)
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
