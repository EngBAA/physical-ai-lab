#!/usr/bin/env python3
"""Verify real animation downloads, decoded frames, selection and recovery."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import subprocess

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
STATE = """() => {const g=window.__segments.ui.graph;return {
  selected:g.selected?.id, progress:g.progress, playing:g.playing,
  position:g.camera.position.toArray(), rotation:g.camera.quaternion.toArray(),
  target:g.controls.target.toArray(), scan:g.scan.visible, map:g.mapInput.checked,
  links:g.showSaved, edges:g.selectionLines.userData.edges
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
            await page.get_by_role('button', name='Inspect Home', exact=True).click()
            await page.get_by_role('button', name='Lounge & G1', exact=True).click()
            await page.locator('.graph-detail').get_by_role('button', name='Unitree G1 robot', exact=True).click()
            await page.locator('.graph-player input').evaluate('(n)=>{n.value=650;n.dispatchEvent(new Event("input",{bubbles:true}))}')
            # A zoomed and panned view must remain exactly as it was after export.
            await page.evaluate('''() => { const g=window.__segments.ui.graph;
              g.controls.enableDamping=false;g.controls.update();g.camera.position.lerp(g.controls.target,.45);g.controls.update();
            }''')
            before = await page.evaluate(STATE)
            await page.screenshot(path=str(out / 'before.png'))
            button = page.get_by_role('button', name='Download scene graph animation', exact=True)
            async with page.expect_download(timeout=45000) as pending:
                await button.click()
                await page.screenshot(path=str(out / 'recording.png'))
            download = await pending.value
            assert 'unitree-g1-robot' in download.suggested_filename
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
            report.update(video=video.name, bytes=video.stat().st_size, frames=stream['nb_read_frames'], duration=duration)
            report['checks'].append('Selected object: real 1080p video with changing frames, complete ending and exact state restoration')
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
