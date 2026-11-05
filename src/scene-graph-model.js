// Display hierarchy derived from registered positions. Source links remain
// verbatim and are never reclassified as SLAM constraints or detected rooms.
// User-requested scene-graph exclusions. The source annotations and scan stay intact.
const HIDDEN_OBJECT_IDS = new Set([
  54, // Television; retain Digital Teaching Display 2 (41).
  104, // Mars testing ground; retain Martian surface for Testing (152).
  147, // Black cushioned chair.
]);
const STATIONS = [
  ['Energy & utilities', [17, 10], '#78aaf7'],
  ['Humanoid testing', [100, 154], '#b897ed'],
  ['Space robotics', [168, 110], '#f0b574'],
  ['Underwater robotics', [25], '#5ad1d1'],
  ['Dexterous manipulation', [190, 182], '#80c792'],
  ['Kitchen & dining', [63, 58], '#e4c487'],
  ['Lounge & G1', [79, 82], '#f59fa9'],
  ['Franka benches', [201, 215], '#71bce7'],
  ['Mobile robotics', [232, 242], '#c8ce79'],
];
// Chamber descriptions copied verbatim from Final_Agent/knowledge/places.json.
// Membership is the lab team's explicit assignment, not a proximity estimate.
const CHAMBERS = [
  {id:'chamber-home',label:'Home',areaIds:['area-5','area-6'],color:'#e4c487',
    description:'The Home chamber brings robotics into everyday spaces. Its living room and kitchen are where we train robots for household tasks.'},
  {id:'chamber-ghaf',label:'Ghaf',areaIds:['area-3'],color:'#5ad1d1',
    description:'The ghaf chamber explores underwater robotics, with a test pool where we trial an autonomous underwater robot among mangrove plants.'},
  {id:'chamber-spark',label:'Spark',areaIds:['area-0'],color:'#78aaf7',
    description:'The Spark chamber includes simulation workstations, solar-panel cleaning demonstrations, pipe inspection, and Laika, our inspection robot dog.'},
  {id:'chamber-space',label:'Space',areaIds:['area-1','area-2'],color:'#b897ed',
    description:'The Space chamber is home to our humanoid robots and a space servicing demonstration.'},
  {id:'chamber-hive',label:'Hive',areaIds:['area-4','area-7','area-8'],color:'#80c792',
    description:'The Hive chamber covers manipulation, dexterous hands, logistics, and production automation.'},
];
const distance2 = (a, b) => (a[0]-b[0])**2 + (a[2]-b[2])**2;
const average = points => [0,1,2].map(i => points.reduce((n,p)=>n+p[i],0)/points.length);
export function floorLinkClear(a, b, grid) {
  if (!grid) return false;
  const steps = Math.ceil(Math.hypot(a[0]-b[0],a[2]-b[2])/(grid.cellSize*.25));
  for (let i=0;i<=steps;i++) {
    const t=steps ? i/steps : 0;
    const x=Math.floor((a[0]+(b[0]-a[0])*t-grid.origin[0])/grid.cellSize);
    const z=Math.floor((a[2]+(b[2]-a[2])*t-grid.origin[1])/grid.cellSize);
    if(x<0||z<0||x>=grid.width||z>=grid.height||grid.cells[z*grid.width+x]!==1)return false;
  }
  return true;
}

export function buildSceneGraph(source, annotations, manifest, grid) {
  if (!source.nodes?.[source.root_id] || !Array.isArray(source.edges)) throw new Error('The saved lab graph is incomplete.');
  const nodes=[], edges=[], objects=[], places=[], registeredObjects=[];
  const hiddenNodeIds=new Set();
  const byId=new Map();
  const add=node=>{nodes.push(node);byId.set(node.id,node);return node;};
  for(const o of annotations.objects) {
    const entry=manifest.objects[String(o.id)], saved=source.nodes[o.node_id];
    if(!entry || !saved || saved.label!==o.label || !entry.centroid.every(Number.isFinite))throw new Error('Graph objects do not match the registered lab.');
    const node={id:o.node_id,objectId:o.id,label:o.label,kind:'object',anchor:[...entry.centroid],
      position:[entry.centroid[0],5.0+Math.max(0,Math.min(2,entry.centroid[1]))*.28,entry.centroid[2]],
      color:o.color,source:'Saved annotation',start:.10+(o.id%11)*.006,duration:.32};
    registeredObjects.push(node);
    if(HIDDEN_OBJECT_IDS.has(o.id))hiddenNodeIds.add(o.node_id);
    else objects.push(add(node));
  }
  const stations=STATIONS.map(([label,ids,color],i)=>{
    const anchors=ids.map(id=>manifest.objects[String(id)]?.centroid).filter(Boolean);
    if(!anchors.length)return null;
    return {id:`area-${i}`,label,color,seed:average(anchors)};
  }).filter(Boolean);
  if(!stations.length)stations.push({id:'area-0',label:'Lab area',color:'#78aaf7',seed:average(objects.map(n=>n.anchor))});
  const nearest=(p,list)=>list.reduce((best,n)=>distance2(p,n.seed||n.anchor)<distance2(p,best.seed||best.anchor)?n:best,list[0]);
  for(const o of registeredObjects)o.areaId=nearest(o.anchor,stations).id;
  const areas=stations.map(s=>{
    // Keep the established layout in place when a displayed label is removed.
    const members=registeredObjects.filter(n=>n.areaId===s.id), p=members.length?average(members.map(n=>n.anchor)):s.seed;
    return add({...s,kind:'area',anchor:[p[0],.1,p[2]],position:[p[0],17,p[2]],source:'Layout grouping by nearest lab station',objectCount:members.length,start:.56,duration:.26});
  });
  for(const area of areas)area.objectCount=objects.filter(n=>n.areaId===area.id).length;
  const chambers=CHAMBERS.flatMap(chamber=>{
    const members=areas.filter(a=>chamber.areaIds.includes(a.id));
    if(!members.length)return [];
    const p=average(members.map(a=>a.anchor));
    for(const area of members)area.chamberId=chamber.id;
    return [add({...chamber,kind:'chamber',parentId:source.root_id,
      areaIds:members.map(a=>a.id),objectCount:members.reduce((sum,a)=>sum+a.objectCount,0),
      anchor:[p[0],.1,p[2]],position:[p[0],23.5,p[2]],source:'Lab chamber',
      start:.72,duration:.20})];
  });
  if(grid) {
    const stride=Math.max(1,Math.round(1.1/grid.cellSize)), cells=new Map();
    for(let z=2;z<grid.height;z+=stride)for(let x=2;x<grid.width;x+=stride){
      if(grid.cells[z*grid.width+x]!==1)continue;
      const p=[grid.origin[0]+(x+.5)*grid.cellSize,.04,grid.origin[1]+(z+.5)*grid.cellSize];
      const area=nearest(p,stations);
      const node=add({id:`place-${x}-${z}`,kind:'place',label:'Observed floor place',anchor:p,
        position:[p[0],10,p[2]],areaId:area.id,color:area.color,source:'Sampled from observed walkable floor; display topology',start:.31+((x+z)%7)*.008,duration:.31});
      places.push(node);cells.set(`${x},${z}`,node);
      for(const [dx,dz] of [[-stride,0],[0,-stride]]){
        const other=cells.get(`${x+dx},${z+dz}`);
        if(other&&floorLinkClear(node.anchor,other.anchor,grid))edges.push({from:other.id,to:node.id,kind:'topology',source:'Observed floor connectivity'});
      }
    }
  }
  for(const o of objects){
    const candidates=places.filter(p=>p.areaId===o.areaId);
    const place=candidates.length?nearest(o.anchor,candidates):null;
    edges.push({from:o.id,to:place?.id||o.areaId,kind:'hierarchy',source:'Display grouping',color:byId.get(o.areaId).color});
  }
  for(const p of places)edges.push({from:p.id,to:p.areaId,kind:'hierarchy',source:'Display grouping',color:p.color});
  const center=average(registeredObjects.map(n=>n.anchor));
  const root=add({id:source.root_id,kind:'lab',label:'Physical AI Lab',anchor:[center[0],.1,center[2]],position:[center[0],30,center[2]],
    color:'#ebd39b',source:`Saved scene root · ${source.root_id}`,start:.86,duration:.14});
  for(const area of areas) {
    if(!byId.has(area.chamberId))throw new Error('A lab area is missing its chamber assignment.');
    edges.push({from:area.id,to:area.chamberId,kind:'hierarchy',source:'Lab chamber membership',color:area.color});
  }
  for(const chamber of chambers)edges.push({from:chamber.id,to:root.id,kind:'hierarchy',source:'Lab chamber membership',color:chamber.color});
  const savedEdges=source.edges.flatMap((edge,index)=>{
    if(!source.nodes[edge.src]||!source.nodes[edge.dst])throw new Error('The saved graph contains an unresolved relationship.');
    if(hiddenNodeIds.has(edge.src)||hiddenNodeIds.has(edge.dst))return [];
    if(!byId.has(edge.src)||!byId.has(edge.dst))throw new Error('The saved graph contains an unresolved relationship.');
    return [{...edge,id:`saved-${index}`,from:edge.src,to:edge.dst,kind:'saved',source:'Saved graph'}];
  });
  // A semantic graph cycle (e.g. next-to) is not a localization loop closure.
  const loopClosures=savedEdges.filter(e=>e.type==='loop_closure'&&e.attributes?.verified===true);
  return {nodes,edges,objects,places,areas,chambers,root,byId,savedEdges,loopClosures,
    stats:{objects:objects.length,hiddenObjects:hiddenNodeIds.size,areas:areas.length,chambers:chambers.length,places:places.length,savedLinks:savedEdges.length,
      spatialLinks:savedEdges.filter(e=>e.type==='spatial').length,loopClosures:loopClosures.length}};
}

export function revealAt(progress,node) {
  const t=Math.max(0,Math.min(1,(progress-node.start)/node.duration));
  return t*t*(3-2*t);
}

export function viewerToMap(position, alignment) {
  const [cx,cy]=alignment.sourceToViewer.sourceCenterXY;
  const [tx,ty]=alignment.mapToSource.translationMetres,a=alignment.mapToSource.yawRadians;
  const x=position[0]+cx-tx,y=cy-position[2]-ty;
  return [Math.cos(a)*x+Math.sin(a)*y,-Math.sin(a)*x+Math.cos(a)*y];
}
