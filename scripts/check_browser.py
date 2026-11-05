#!/usr/bin/env python3
"""Exercise the independent build, its real data and actual WebGL picking."""
import argparse
import asyncio
import json
from pathlib import Path
import time
from urllib.parse import urlparse

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:4175')
    args = parser.parse_args()
    out = ROOT / 'artifacts/browser'
    out.mkdir(parents=True, exist_ok=True)
    errors, failures, requests = [], [], []
    report = {'passed': False, 'checks': []}
    metadata = json.loads((ROOT / 'public/data/metadata.json').read_text())
    annotations = json.loads((ROOT / 'public/data/segments-20261028/annotations.json').read_text())
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/opt/google/chrome/chrome', headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
                  '--disable-software-rasterizer', '--use-gl=angle', '--use-angle=gl'])
        page = await browser.new_page(viewport={'width': 1600, 'height': 1000}, device_scale_factor=1, accept_downloads=True)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('response', lambda r: failures.append([r.status, r.url]) if r.status >= 400 else None)
        page.on('request', lambda r: requests.append(r.url))
        try:
            start = time.monotonic()
            await page.goto(args.url, wait_until='domcontentloaded')
            await page.wait_for_function('window.__segments?.viewer.loaded', timeout=180000)
            report['loadSeconds'] = time.monotonic() - start
            print('Standalone cloud loaded', flush=True)
            assert await page.evaluate('window.__segments.viewer._segments.manifest.pointCount') == metadata['segments']['pointCount']
            assert await page.locator('.segment-object-row').count() == 248
            # Browser numbers follow IEEE-754; raw downloads separately retain
            # the source's nanosecond timestamps, including >2^53 integers.
            expected = await page.evaluate('text=>JSON.parse(text)', (ROOT / 'public/data/segments-20261028/annotations.json').read_text())
            assert await page.evaluate('window.__segments.viewer._segments.annotations') == expected
            report['checks'].append('Complete current cloud and exact source annotations')
            await page.screenshot(path=str(out / 'cloud.png'))

            await page.locator('#labels-button').click()
            assert await page.locator('.segment-object-label').count() == 248
            assert await page.locator('.segment-object-label:visible').count() > 10
            await page.screenshot(path=str(out / 'labels.png'))
            await page.locator('#labels-button').click()
            checks = page.locator('.segment-options input')
            await checks.nth(0).uncheck()
            assert await page.evaluate('window.__segments.viewer._segments.material.uniforms.colourMix.value') == 0
            await page.screenshot(path=str(out / 'rgb.png'))
            await checks.nth(0).check()
            await checks.nth(1).uncheck()
            assert not await page.evaluate('window.__segments.viewer._segments.material.uniforms.backgroundVisible.value')
            await checks.nth(1).check()
            await page.locator('#map-button').click()
            assert await page.evaluate('window.__segments.viewer.robotMapSync.group.visible')
            await page.locator('#map-button').click()
            await page.locator('#settings-button').click()
            await page.locator('#point-size').focus()
            await page.keyboard.press('ArrowRight')
            assert await page.locator('#point-size-value').inner_text() == '1.1×'
            await page.locator('#settings-close').click()
            report['checks'].append('Labels, colours, background, saved map and point size')

            await page.locator('#segment-search').fill('Unitree G1 robot')
            await page.locator('.segment-object-row[data-object-id="82"]').click()
            selected = next(o for o in annotations['objects'] if o['id'] == 82)
            assert await page.locator('#segment-description').inner_text() == selected['description']
            await page.wait_for_selector('.segment-object-preview[data-state="ready"]', timeout=30000)
            await page.get_by_role('button', name='Focus', exact=True).click()
            await page.get_by_role('button', name='Isolate', exact=True).click()
            assert await page.evaluate('window.__segments.viewer._segments.material.uniforms.isolate.value')
            await page.screenshot(path=str(out / 'object-isolated.png'))
            await page.get_by_role('button', name='Show lab', exact=True).click()
            await page.locator('#segment-complete summary').click()
            assert json.loads(await page.locator('#segment-complete pre').inner_text()) == selected
            async with page.expect_download() as download:
                await page.get_by_role('button', name='Download annotation JSON', exact=True).click()
            artifact = await download.value
            path = await artifact.path()
            assert json.loads(Path(path).read_text()) == selected
            await page.locator('#segment-complete summary').click()
            await page.locator('.segment-body').evaluate('(n)=>n.scrollTop=0')
            await page.wait_for_selector('.object-preview-modes:not([hidden])', timeout=30000)
            await page.get_by_role('button', name='3D scan', exact=True).click()
            await page.get_by_role('button', name='Pause object rotation', exact=True).click()
            assert await page.evaluate('window.__segments.ui.preview.paused')
            await page.get_by_role('button', name='Generated view', exact=True).click()
            await page.wait_for_function('window.__segments.ui.preview.gif.complete && window.__segments.ui.preview.gif.naturalWidth>0')
            await page.screenshot(path=str(out / 'object-preview.png'))
            report['checks'].append('Search, focus, isolate, exact details, JSON export and both preview modes')

            # Read the same GPU ID buffer used by real clicks, then click a
            # visible G1 point through the actual canvas input handlers.
            await page.wait_for_timeout(600)
            hit = await page.evaluate('''async()=>{
              const v=window.__segments.viewer,l=v._segments,r=v.renderer,c=v.camera.clone(),rect=v.canvas.getBoundingClientRect();
              const w=Math.round(rect.width),h=Math.round(rect.height),target=l.target;target.setSize(w,h);c.clearViewOffset();c.updateMatrixWorld(true);
              const old=r.getRenderTarget();r.setRenderTarget(target);r.render(l.pickScene,c);const pixels=new Uint8Array(w*h*4);
              const read=r.readRenderTargetPixelsAsync(target,0,0,w,h,pixels);r.setRenderTarget(old);await read;target.setSize(5,5);
              let best=null,distance=Infinity;
              for(let i=0;i<w*h;i++)if(pixels[i*4]===82&&pixels[i*4+1]===0){const x=i%w,y=h-Math.floor(i/w),d=(x-w/2)**2+(y-h/2)**2;
                if(d<distance){distance=d;best={x:rect.left+x+.5,y:rect.top+y-.5};}}
              return best;
            }''')
            assert hit, 'Expected a visible G1 point after focusing'
            await page.evaluate('window.__segments.viewer._segments.select(0)')
            await page.mouse.move(hit['x'], hit['y'])
            await page.wait_for_function('!document.getElementById("segment-tooltip").hidden')
            assert 'Unitree G1' in await page.locator('#segment-tooltip').inner_text()
            await page.mouse.click(hit['x'], hit['y'])
            await page.wait_for_function('window.__segments.viewer._segments.selectedId===82')
            for obj in (o for o in annotations['objects'] if o['display_point_count'] == 0):
                await page.evaluate('id=>window.__segments.viewer._segments.select(id)', obj['id'])
                assert await page.evaluate('window.__segments.viewer._segments.overlap.geometry.drawRange.count') > 0
            await page.evaluate('window.__segments.viewer._segments.select(0)')
            await page.locator('#fit-button').click()
            report['checks'].append('Actual GPU hover/click picking and fully overlapped objects')

            await page.locator('#graph-button').click()
            await page.wait_for_function('window.__segments.ui.graph.model && window.__segments.ui.graph.progress>.05')
            await page.get_by_role('button', name='Pause graph animation', exact=True).click()
            progress = await page.evaluate('window.__segments.ui.graph.progress')
            assert 0 < progress < 1
            await page.locator('.graph-player input').evaluate('(n)=>{n.value=600;n.dispatchEvent(new Event("input",{bubbles:true}))}')
            await page.locator('.graph-player input').focus()
            await page.keyboard.press('ArrowRight')
            assert abs(await page.evaluate('window.__segments.ui.graph.progress') - .601) < .002
            await page.get_by_role('button', name='↻ Replay', exact=True).click()
            await page.wait_for_function('window.__segments.ui.graph.progress===1', timeout=30000)
            stats = await page.evaluate('window.__segments.ui.graph.model.stats')
            assert stats['objects'] == 245 and stats['areas'] == 9 and stats['chambers'] == 5 and stats['places'] > 100
            assert await page.evaluate('Boolean(window.__segments.ui.graph.mapMesh)')
            await page.screenshot(path=str(out / 'graph.png'))
            options = page.locator('.graph-options input')
            await options.nth(0).uncheck()
            await page.wait_for_function('!window.__segments.ui.graph.saved.visible')
            await options.nth(0).check()
            await options.nth(1).uncheck()
            assert not await page.evaluate('window.__segments.ui.graph.scan.visible')
            await options.nth(1).check()
            await options.nth(2).uncheck()
            assert not await page.evaluate('window.__segments.ui.graph.mapMesh.visible')
            await options.nth(2).check()
            await page.get_by_role('button', name='Inspect Home', exact=True).click()
            assert await page.locator('.graph-member-list button').count() == 2
            await page.get_by_role('button', name='Lounge & G1', exact=True).click()
            await page.locator('.graph-detail').get_by_role('button', name='Unitree G1 robot', exact=True).click()
            await page.wait_for_selector('.graph-detail .segment-object-preview[data-state="ready"]')
            await page.screenshot(path=str(out / 'graph-object.png'))
            await page.get_by_role('button', name='Inspect in lab →', exact=True).click()
            assert not await page.evaluate('window.__segments.ui.graph.active')
            await page.wait_for_function('window.__segments.viewer.controls.enabled')
            assert await page.evaluate('window.__segments.viewer._segments.selectedId') == 82
            report['checks'].append('Animated hierarchy, replay/pause/scrub, map/scan/links, chamber drill-down and return to object')
            report['graph'] = stats

            await page.set_viewport_size({'width': 390, 'height': 844})
            await page.evaluate('window.__segments.viewer._segments.select(0)')
            await page.locator('#fit-button').click()
            await page.locator('#segment-search').fill('coffee')
            assert await page.locator('.segment-object-row').count() > 0
            await page.screenshot(path=str(out / 'mobile-cloud.png'))
            await page.locator('#graph-button').click()
            await page.wait_for_function('window.__segments.ui.graph.progress===1', timeout=30000)
            await page.screenshot(path=str(out / 'mobile-graph.png'))
            for selector in ['#graph-button', '.segment-panel', '.graph-player', '.graph-exit']:
                box = await page.locator(selector).bounding_box()
                assert box and box['x'] >= 0 and box['x'] + box['width'] <= 391, (selector, box)
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            await page.locator('.graph-exit').click()
            report['checks'].append('Mobile cloud, search, graph controls and no horizontal overflow')
            assert not errors, errors
            assert not failures, failures
            remote = [url for url in requests if url.startswith('http') and urlparse(url).netloc != urlparse(args.url).netloc]
            assert not remote, remote
            report.update(passed=True, errors=errors, failedRequests=failures, externalRequests=remote)
        except BaseException as error:
            report.update(error=str(error), errors=errors, failedRequests=failures)
            await page.screenshot(path=str(out / 'failure.png'))
            raise
        finally:
            (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report), flush=True)
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
