// Reuse the website's original SceneGraphView, its registered scan, and its GPU
// buffers. The companion temporarily hosts the same canvas; it isn't a new graph.
import graphStyles from './inspector.css?inline';
import { hierarchyBranch } from './companion-hierarchy-model.js';

const embedded = new URLSearchParams(location.search).has('companion-embed');
const hostStyles = `
  .hierarchy-host{position:relative;width:100%;height:100%;min-height:300px;overflow:hidden;border-radius:8px;background:#061522}
  .hierarchy-host canvas{position:absolute;inset:0;width:100%!important;height:100%!important;display:block;outline:none}
  .hierarchy-host .scene-graph-ui{position:absolute;inset:0;pointer-events:none}
  .hierarchy-host .graph-exit,.hierarchy-host .graph-download{display:none}
  .hierarchy-host .graph-options{left:10px;right:10px;top:10px;font-size:8px;padding:7px;gap:8px;width:max-content;max-width:calc(100% - 20px)}
  .hierarchy-host .graph-player{bottom:28px;left:12px;right:12px;transform:none;width:auto;max-width:none;padding:7px 9px;gap:9px}
  .hierarchy-host .graph-player button{font-size:9px;min-width:27px}
  .hierarchy-host .graph-status{font-size:7px;width:85px}
  .hierarchy-host .graph-help{bottom:8px;font-size:7px}
  .hierarchy-host .graph-node-label{font-size:7px;padding:3px 5px;max-width:120px;pointer-events:auto}
  .hierarchy-host .graph-label-chamber{font-size:9px;padding:4px 7px}
  .hierarchy-host .graph-label-lab{font-size:10px}
  .hierarchy-host .graph-detail{left:12px;right:12px;top:auto;bottom:73px;width:auto;max-height:42%;padding:12px;pointer-events:auto}
  .hierarchy-host .graph-detail h3{font-size:17px}.hierarchy-host .graph-description{font-size:10px}
  .hierarchy-host .graph-inspect{display:none}
  .hierarchy-host button{font-family:inherit}.hierarchy-host [hidden]{display:none!important}
  .hierarchy-host .glass{background:#0a2032ed;border:1px solid #c9c0a924;border-radius:6px}
  .hierarchy-host input[type=range]{accent-color:#e7cd91}
`;

export function installCompanionHierarchy(viewer, ui) {
  const graph = ui.graph;
  let release = null, pulse = null, drawing = null, pending = null, mounted = false;
  const cancel = () => { clearInterval(pulse); clearInterval(drawing); pulse=drawing=null; if(graph.hierarchy) graph.hierarchy.material.opacity=.4; };
  const adapter = {
    async mount(host) {
      if (mounted) return;
      mounted=true;
      const wasActive=graph.active, canvasMark=document.createComment('lab canvas'), graphMark=document.createComment('lab graph');
      viewer.canvas.before(canvasMark); graph.root.before(graphMark);
      host.classList.add('hierarchy-host');
      const style=document.createElement('style');style.textContent=graphStyles+'\n'+hostStyles;
      host.append(style,viewer.canvas,graph.root);
      release=async()=>{
        cancel(); graph.selected=null;graph.detail.hidden=true;graph.syncScanSelection();
        graph.close(); canvasMark.replaceWith(viewer.canvas); graphMark.replaceWith(graph.root);
        style.remove(); mounted=false; viewer.resize();
        if(wasActive) await graph.open(viewer._segments);
      };
      await graph.open(viewer._segments);
      viewer.resize();graph.resize(true);
      graph.progress=1;graph.playing=false;graph.dirty=true;graph.updatePlayer();
      if(pending) adapter.highlight(...pending);
    },
    unmount() { const fn=release;release=null;return fn?.(); },
    clear() { pending=null;cancel();if(!graph.model)return;graph.selected=null;graph.detail.hidden=true;graph.box.visible=false;ui.preview.hide();graph.syncScanSelection();graph.replaceSelection([]);graph.dirty=true; },
    reset() { cancel(); if(!graph.model)return;graph.selected=null;graph.detail.hidden=true;ui.preview.hide();graph.box.visible=false;graph.syncScanSelection();graph.replaceSelection([]);graph.restart();graph.resize(true); },
    highlight(event,robotScene) {
      pending=[event,robotScene];cancel();if(!graph.model||!mounted)return;
      if(event.stage==='search'||event.stage==='lookup') {
        graph.detail.hidden=true;graph.replaceSelection([]);
        let bright=false;pulse=setInterval(()=>{graph.hierarchy.material.opacity=(bright=!bright)?.6:.25;},700);
        return;
      }
      if(!event.nodes?.length&&!event.route?.length)return;
      const branch=hierarchyBranch(graph.model,event,robotScene);
      if(!branch.matches.length){graph.selected=null;graph.syncScanSelection();graph.replaceSelection([]);graph.dirty=true;return;}
      graph.progress=1;graph.playing=false;graph.updatePlayer();graph.dirty=true;
      graph.selected=branch.matches.find(n=>n.kind==='object')||branch.matches[0];graph.syncScanSelection();
      graph.detail.hidden=true;ui.preview.hide();
      let count=0;
      const draw=()=>{graph.replaceSelection(branch.edges.slice(0,++count));graph.dirty=true;if(count>=branch.edges.length){clearInterval(drawing);drawing=null;}};
      if(viewer._reducedMotion){graph.replaceSelection(branch.edges);graph.dirty=true;}else{draw();drawing=setInterval(draw,110);}
    },
    finish() { clearInterval(pulse);pulse=null;if(graph.hierarchy)graph.hierarchy.material.opacity=.4; },
    get stats() { return graph.model?.stats; },
  };
  window.MasarHierarchy=adapter;
  window.dispatchEvent(new Event('masar-hierarchy-ready'));
  if(embedded) {
    document.documentElement.classList.add('companion-embedded');
    const style=document.createElement('style');
    style.textContent=`body{min-width:0!important}.app-header,.tool-rail,.status-bar,.segment-panel,#export-menu,#toast{display:none!important}#viewport,#viewer-ui{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}.scene-caption{display:none!important}#companion-graph-embed{position:absolute;inset:0}`;
    document.head.append(style);
    const host=document.createElement('div');host.id='companion-graph-embed';document.body.append(host);
    adapter.mount(host).then(()=>window.parent.postMessage({type:'masar-hierarchy-ready'},'*'));
    window.addEventListener('message',event=>{
      if(event.source!==window.parent||event.data?.type!=='masar-hierarchy')return;
      if(event.data.action==='reset')adapter.reset();
      else if(event.data.action==='clear')adapter.clear();
      else if(event.data.action==='finish')adapter.finish();
      else if(event.data.action==='highlight'&&event.data.event&&event.data.scene)adapter.highlight(event.data.event,event.data.scene);
    });
  }
  return adapter;
}

// The existing viewer remains the owner of loading and of its render loop.
if(!embedded) void import(/* @vite-ignore */ `${import.meta.env.BASE_URL}companion/companion.js`);
