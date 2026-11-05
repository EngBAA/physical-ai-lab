import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildSceneGraph,floorLinkClear,revealAt,viewerToMap} from './scene-graph-model.js';

test('requested graph exclusions preserve all other relationships and registered coordinates',()=>{
  const json=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
  const source=json('../public/data/segments-20261028/original_graph.json');
  const annotations=json('../public/data/segments-20261028/annotations.json');
  const manifest=json('../public/data/segments-clean-20261028/manifest.json');
  const metadata=json('../public/data/metadata.json'),spec=metadata.walkability;
  const cells=new Uint8Array(fs.readFileSync(new URL('../public'+spec.url,import.meta.url)));
  const grid={...spec,origin:spec.originXZ,cells};const graph=buildSceneGraph(source,annotations,manifest,grid);
  const hidden=new Set(['n54','n104','n147']);
  const retained=source.edges.filter(e=>!hidden.has(e.src)&&!hidden.has(e.dst));
  assert.equal(graph.objects.length,245);assert.equal(graph.stats.hiddenObjects,3);
  assert.equal(graph.savedEdges.length,retained.length);assert.equal(graph.loopClosures.length,0);
  for(const id of hidden){
    assert.ok(!graph.byId.has(id));
    assert.ok(annotations.objects.some(o=>o.node_id===id),'The original segmented annotation is retained');
  }
  for(const id of ['n41','n152'])assert.ok(graph.byId.has(id),'The other display and terrain labels are retained');
  assert.equal(graph.areas.reduce((n,a)=>n+a.objectCount,0),245);
  assert.ok(graph.places.length>100);assert.equal(graph.areas.length,9);
  assert.equal(graph.stats.chambers,5);
  assert.deepEqual(Object.fromEntries(graph.chambers.map(c=>[c.label,c.areaIds.map(id=>graph.byId.get(id).label)])),{
    Home:['Kitchen & dining','Lounge & G1'],
    Ghaf:['Underwater robotics'],
    Spark:['Energy & utilities'],
    Space:['Humanoid testing','Space robotics'],
    Hive:['Dexterous manipulation','Franka benches','Mobile robotics'],
  });
  assert.equal(graph.chambers.reduce((n,c)=>n+c.objectCount,0),245);
  assert.equal(new Set(graph.chambers.flatMap(c=>c.areaIds)).size,9);
  const parents=new Map();
  for(const e of graph.edges.filter(e=>e.kind==='hierarchy')) {
    assert.ok(!parents.has(e.from),'Each displayed node has a single hierarchy parent');
    parents.set(e.from,e.to);
    assert.ok(graph.byId.get(e.from).position[1]<graph.byId.get(e.to).position[1],'Hierarchy rises toward the lab root');
  }
  for(const o of graph.objects) {
    let current=o;const visited=new Set();
    while(parents.has(current.id)) {
      assert.ok(!visited.has(current.id),'Hierarchy must not contain a cycle');visited.add(current.id);
      current=graph.byId.get(parents.get(current.id));
    }
    assert.equal(current.id,graph.root.id);
    const area=graph.byId.get(o.areaId);
    assert.ok(visited.has(area.id));assert.ok(visited.has(area.chamberId),'Every object reaches the lab through its assigned chamber');
  }
  for(const chamber of graph.chambers) {
    assert.equal(parents.get(chamber.id),graph.root.id);
    assert.ok(chamber.description.length>60);
    for(const id of chamber.areaIds)assert.equal(parents.get(id),chamber.id);
    for(const axis of [0,2]) {
      const center=chamber.areaIds.reduce((sum,id)=>sum+graph.byId.get(id).anchor[axis],0)/chamber.areaIds.length;
      assert.equal(chamber.anchor[axis],center);
      assert.equal(chamber.position[axis],center);
    }
  }
  for(let i=0;i<retained.length;i++)for(const k of Object.keys(retained[i]))assert.deepEqual(graph.savedEdges[i][k],retained[i][k]);
  for(const e of graph.savedEdges)assert.ok(graph.byId.has(e.from)&&graph.byId.has(e.to));
  for(const o of graph.objects)assert.deepEqual(o.anchor,manifest.objects[String(o.objectId)].centroid);
  for(const e of graph.edges){
    assert.ok(graph.byId.has(e.from)&&graph.byId.has(e.to));
    if(e.kind==='topology')assert.ok(floorLinkClear(graph.byId.get(e.from).anchor,graph.byId.get(e.to).anchor,grid));
  }
  for(const n of graph.nodes){assert.ok(n.position.every(Number.isFinite));assert.equal(revealAt(0,n),0);assert.ok(Math.abs(revealAt(1,n)-1)<1e-9);}
  const alignment=json('../public'+metadata.savedMap.alignmentUrl);
  const a=alignment.mapToSource.yawRadians,[tx,ty]=alignment.mapToSource.translationMetres,[cx,cy]=alignment.sourceToViewer.sourceCenterXY;
  for(const o of graph.objects){
    const [x,y]=viewerToMap(o.anchor,alignment);
    assert.ok(Math.abs(Math.cos(a)*x-Math.sin(a)*y+tx-cx-o.anchor[0])<1e-10);
    assert.ok(Math.abs(cy-(Math.sin(a)*x+Math.cos(a)*y+ty)-o.anchor[2])<1e-10);
    // The exploded view changes only height; x/z always remain tied to the map.
    assert.equal(o.position[0],o.anchor[0]);assert.equal(o.position[2],o.anchor[2]);
  }
  const broken={...source,edges:[...source.edges,{src:'n54',dst:'missing-node',type:'spatial',label:'next-to'}]};
  assert.throws(()=>buildSceneGraph(broken,annotations,manifest,grid),/unresolved relationship/);
});

test('floor connections cannot cross unobserved cells and semantic cycles are not loop closures',()=>{
  const grid={width:3,height:1,cellSize:1,origin:[0,0],cells:new Uint8Array([1,0,1])};
  assert.equal(floorLinkClear([.5,0,.5],[2.5,0,.5],grid),false);
  grid.cells[1]=1;assert.equal(floorLinkClear([.5,0,.5],[2.5,0,.5],grid),true);
  assert.equal(floorLinkClear([-.5,0,.5],[2.5,0,.5],grid),false);
});
