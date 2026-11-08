import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildSceneGraph, revealAt, viewerToMap } from './scene-graph-model.js';
import { recordSceneGraph, saveRecording } from './scene-graph-export.js';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const btn=(text,fn,cls)=>{const n=el('button',text,cls);n.type='button';n.onclick=fn;return n;};
const color=value=>Array.isArray(value)?new THREE.Color(...value):new THREE.Color(value);

// Reference viewing direction, with the target raised to frame the chamber layer.
// Energy/utilities sits on the left, with the kitchen and lounge on the right.
const DEFAULT_GRAPH_VIEW = {
  direction: [-0.926215664, 0.255909465, 0.276830075],
  target: [0.118090677, 12.236790805, -0.685697409],
  distance: 46,
};

/** Independent inspection camera, same registered scan and WebGL context.
 * Opening this view never changes the robot, navigation calibration, or scan.
 */
export class SceneGraphView {
  constructor(viewer, ui) {
    this.viewer=viewer;this.ui=ui;this.active=false;this.progress=0;this.playing=false;
    this.owned=new Set();this.projected=new THREE.Vector3();this.current=new Map();
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#061522');
    this.camera=new THREE.PerspectiveCamera(44,1,.1,250);
    this.controls=new OrbitControls(this.camera,viewer.canvas);this.controls.enabled=false;
    this.controls.enableDamping=true;this.controls.dampingFactor=.07;this.controls.minDistance=5;this.controls.maxDistance=130;
    this.controls.maxPolarAngle=Math.PI*.49;
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.listeners=[];
    const listen=(target,type,fn)=>{target.addEventListener(type,fn);this.listeners.push(()=>target.removeEventListener(type,fn));};
    listen(viewer.canvas,'pointerdown',e=>{if(this.active&&e.button===0)this.down=[e.clientX,e.clientY];});
    listen(viewer.canvas,'pointerup',e=>{
      if(this.active&&this.down&&Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1])<5)this.pick(e.clientX,e.clientY);
      this.down=null;
    });
    listen(viewer.canvas,'pointercancel',()=>{this.down=null;});
    listen(window,'keydown',e=>{if(this.active&&e.key==='Escape'&&!this.exportController&&!this.exportDialog.open){e.preventDefault();this.close();}});
    listen(document,'visibilitychange',()=>{if(document.hidden)this.exportController?.abort(new Error('Recording cancelled because this tab was hidden. Keep the tab open and try again.'));});
    listen(viewer.canvas,'webglcontextlost',()=>this.exportController?.abort(new Error('The graphics context was interrupted. Reload the page and try again.')));
    this.createUI();viewer._sceneGraph=this;
  }

  own(resource){this.owned.add(resource);return resource;}

  createUI() {
    this.root=el('section',undefined,'scene-graph-ui');this.root.id='scene-graph-ui';this.root.hidden=true;
    this.root.setAttribute('aria-label','Interactive 3D lab scene graph');
    const options=el('div',undefined,'graph-options glass');
    const check=(text,initial,action)=>{const label=el('label'),input=el('input');input.type='checkbox';input.checked=initial;input.onchange=()=>action(input.checked);label.append(input,document.createTextNode(text));options.append(label);return input;};
    this.linksInput=check('Saved spatial links',true,v=>{this.showSaved=v;this.dirty=true;});this.showSaved=true;
    this.scanInput=check('Show scan',true,v=>{if(this.scan)this.scan.visible=v;});
    this.mapInput=check('2D map',true,v=>{if(this.mapMesh)this.mapMesh.visible=v;});this.mapInput.disabled=true;
    this.detail=el('aside',undefined,'graph-detail glass');this.detail.hidden=true;this.detail.setAttribute('aria-label','Scene graph selection');
    this.nodeLabels=el('div',undefined,'graph-node-labels');this.nodeLabels.setAttribute('aria-label','Scene graph nodes');
    this.player=el('div',undefined,'graph-player glass');
    this.replay=btn('↻ Replay',()=>this.restart());this.play=btn('Pause',()=>{this.playing=!this.playing;this.updatePlayer();});
    this.seek=el('input');this.seek.type='range';this.seek.min='0';this.seek.max='1000';this.seek.value='0';this.seek.setAttribute('aria-label','Scene graph animation progress');
    this.seek.oninput=()=>{this.progress=Number(this.seek.value)/1000;this.playing=false;this.dirty=true;this.updatePlayer();};
    this.status=el('span','Loading…','graph-status');this.status.setAttribute('role','status');
    this.download=btn('',()=>this.downloadAnimation(),'graph-download');this.download.disabled=true;
    this.download.setAttribute('aria-label','Download scene graph animation');
    this.download.title='Download animation with the current selection (video)';
    this.download.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>';
    this.player.append(this.replay,this.play,btn('Fit',()=>this.resize(true)),this.seek,this.status,this.download);
    this.exportDialog=el('dialog',undefined,'graph-export-dialog');
    this.exportDialog.setAttribute('aria-labelledby','graph-export-title');
    const exportTitle=el('h2','Download graph animation');exportTitle.id='graph-export-title';
    this.exportMessage=el('p');this.exportMessage.setAttribute('role','status');
    this.exportProgress=el('progress');this.exportProgress.max=1;this.exportProgress.value=0;this.exportProgress.setAttribute('aria-label','Animation recording progress');
    this.exportCancel=btn('Cancel',()=>{if(this.exportController)this.exportController.abort(new DOMException('Recording cancelled.','AbortError'));else this.exportDialog.close();});
    this.exportDialog.addEventListener('cancel',e=>{if(this.exportController){e.preventDefault();this.exportController.abort(new DOMException('Recording cancelled.','AbortError'));}});
    this.exportDialog.append(exportTitle,this.exportMessage,this.exportProgress,this.exportCancel);
    this.exit=btn('Back to lab ↗',()=>this.close(),'graph-exit glass');
    this.help=el('p','Drag to orbit · Scroll to zoom · Click a node to inspect','graph-help');
    this.root.append(this.nodeLabels,options,this.detail,this.player,this.exit,this.help,this.exportDialog);
    document.getElementById('viewer-ui').append(this.root);
  }

  async open(layer) {
    if(this.active)return;
    this.active=true;this.root.hidden=false;this.ui.graphButton.setAttribute('aria-pressed','true');
    this.wasBodyHidden=this.ui.body.hidden;this.ui.body.hidden=true;this.ui.toggle.setAttribute('aria-expanded','false');
    this.ui.labels.hidden=true;this.ui.tag.hidden=true;this.ui.tip.hidden=true;
    this.ui.preview.hide();
    document.getElementById('viewer-ui').classList.add('scene-graph-open');
    this.viewer._clearInput();this.controls.enabled=true;this.viewer.controls.enabled=false;
    if(document.pointerLockElement===this.viewer.canvas)document.exitPointerLock();
    this.viewer.canvas.style.cursor='grab';
    try {
      if(this.layer!==layer) {
        this.layer=layer;
        const annotationUrl=layer.localUrl(layer.manifest.annotationsUrl);
        const url=layer.localUrl(new URL(layer.annotations.original_graph_url,annotationUrl).href);
        const response=await fetch(url);if(!response.ok)throw new Error('Saved graph could not be loaded.');
        const source=await response.json();
        if(this.disposed)return;
        this.model=buildSceneGraph(source,layer.annotations,layer.manifest,this.viewer._grid);
        this.build();
      }
      if(!this.active)return;
      this.ui.count.textContent=`${this.model.stats.objects} labels`;
      this.syncScanSelection();this.restart();this.resize(true);
      this.download.disabled=false;
      if(this.selected?.kind==='object')this.ui.preview.show(this.detail.querySelector('h3'),this.layer.objects.get(this.selected.objectId),this.layer);
    } catch(error) {
      this.layer=null;this.playing=false;this.download.disabled=true;this.status.textContent=error.message;
      console.error('[Scene graph]',error);
    }
  }

  close() {
    if(!this.active)return;
    this.exportController?.abort(new DOMException('Recording cancelled.','AbortError'));this.exportDialog.close();
    this.active=false;this.playing=false;this.controls.enabled=false;this.root.hidden=true;
    this.ui.preview.hide();
    // The overlap GPU geometry is shared. Restore the lab's own selection.
    const range=this.layer?.manifest.overlaps.ranges[String(this.layer.selectedId)];
    this.layer?.overlap?.geometry.setDrawRange(range?.start||0,range?.count||0);
    document.getElementById('viewer-ui').classList.remove('scene-graph-open');
    this.ui.graphButton.setAttribute('aria-pressed','false');
    if(this.ui.layer)this.ui.count.textContent=`${this.ui.layer.objects.size} labels`;
    this.ui.body.hidden=this.wasBodyHidden;this.ui.toggle.setAttribute('aria-expanded',String(!this.wasBodyHidden));
    this.ui.labels.hidden=!this.ui.visible||!this.ui.showLabels;
    this.ui.labelFrame=null;this.ui.positionLabel();this.ui.graphButton.focus({preventScroll:true});
    this.ui.restorePreview();
  }

  build() {
    this.clearScene();const m=this.model;
    this.scan=new THREE.Group();this.scene.add(this.scan);this.scan.visible=this.scanInput.checked;
    const scanMaterial=this.scanMaterial=this.own(new THREE.ShaderMaterial({vertexColors:true,toneMapped:false,
      uniforms:{pixelRatio:{value:this.viewer.renderer.getPixelRatio()},selectedId:{value:0}},
      vertexShader:`attribute float instanceId;uniform float pixelRatio,selectedId; varying vec3 c; void main(){
        bool selected=selectedId>.5&&abs(instanceId-selectedId)<.1;
        c=selected?mix(color,vec3(1.,.87,.45),.45):mix(vec3(dot(color,vec3(.3,.59,.11))),color,.55)*(selectedId>.5?.26:.42);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=(selected?2.8:1.5)*pixelRatio;}`,
      fragmentShader:`varying vec3 c; void main(){if(length(gl_PointCoord-.5)>.5)discard;gl_FragColor=vec4(c,1.);}`}));
    // Reuse the uploaded GPU buffers. No second point-cloud download or copy.
    for(const chunk of this.layer.chunks)this.scan.add(new THREE.Points(chunk.points.geometry,scanMaterial));
    this.nodeMeshes=new Map();this.current.clear();
    for(const kind of ['object','place','area','chamber','lab']) {
      const members=m.nodes.filter(n=>n.kind===kind);
      const geometry=this.own(kind==='object'?new THREE.SphereGeometry(.14,10,8):kind==='place'?new THREE.SphereGeometry(.075,8,6):kind==='area'?new THREE.BoxGeometry(.40,.40,.40):kind==='chamber'?new THREE.IcosahedronGeometry(.40,0):new THREE.OctahedronGeometry(.48));
      const material=this.own(new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}));
      const mesh=new THREE.InstancedMesh(geometry,material,members.length);mesh.frustumCulled=false;mesh.userData.nodes=members;
      members.forEach((n,i)=>{mesh.setColorAt(i,color(n.kind==='object'?m.byId.get(n.areaId).color:n.color));this.current.set(n.id,new THREE.Vector3(...n.anchor));});
      this.scene.add(mesh);this.nodeMeshes.set(kind,mesh);
    }
    this.hierarchy=this.makeLines(m.edges,'hierarchy',.40);
    this.tethers=this.makeLines(m.objects.map(n=>({from:n.id,to:n.id,kind:'tether',anchor:n.anchor,color:m.byId.get(n.areaId).color})),'tether',.25);
    this.saved=this.makeLines(m.savedEdges.filter(e=>e.type==='spatial'),'saved',.12);
    this.selectionLines=this.makeLines([],'selection',.95);
    this.box=new THREE.Box3Helper(new THREE.Box3(),0xf2d59a);this.box.visible=false;this.scene.add(this.box);
    this.own(this.box.geometry);this.own(this.box.material);
    this.createPlanes();
    this.agent=new THREE.Mesh(this.own(new THREE.OctahedronGeometry(.22)),this.own(new THREE.MeshBasicMaterial({color:0x69f1c3,toneMapped:false})));
    this.agent.visible=false;this.scene.add(this.agent);
    const agentGeometry=this.own(new THREE.BufferGeometry());agentGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
    this.agentTether=new THREE.Line(agentGeometry,this.own(new THREE.LineBasicMaterial({color:0x69f1c3,transparent:true,opacity:.7,toneMapped:false})));
    this.agentTether.frustumCulled=false;this.agentTether.visible=false;this.scene.add(this.agentTether);
    this.mapMesh=null;this.syncMap();
    this.nodeLabels.replaceChildren();this.labelEntries=[];
    for(const n of m.nodes.filter(n=>n.kind!=='place')) {
      const label=btn(n.label,()=>this.select(n.id),`graph-node-label graph-label-${n.kind}`);
      label.dataset.nodeId=n.id;label.setAttribute('aria-label',`Inspect ${n.label}`);
      label.style.setProperty('--graph-color',color(n.kind==='object'?m.byId.get(n.areaId).color:n.color).getStyle());
      label.hidden=true;this.nodeLabels.append(label);this.labelEntries.push({node:n,element:label});
    }
    this.agentLabel=el('span','Live RealMan','graph-node-label graph-label-agent');this.agentLabel.hidden=true;this.nodeLabels.append(this.agentLabel);
    this.selected=null;this.detail.hidden=true;this.dirty=true;
  }

  createPlanes() {
    const points=this.model.objects.map(n=>n.anchor),xs=points.map(p=>p[0]),zs=points.map(p=>p[2]);
    const x0=Math.min(...xs)-.8,x1=Math.max(...xs)+.8,z0=Math.min(...zs)-.8,z1=Math.max(...zs)+.8;
    this.bounds=new THREE.Box3(new THREE.Vector3(x0,0,z0),new THREE.Vector3(x1,this.model.root.position[1]+1,z1));
    this.fitPoints=this.model.nodes.map(n=>new THREE.Vector3(...n.position));
    const scanBounds=new THREE.Box3();
    for(const chunk of this.layer.chunks)if(!chunk.spec.overlap){scanBounds.expandByPoint(new THREE.Vector3(...chunk.spec.bounds.min));scanBounds.expandByPoint(new THREE.Vector3(...chunk.spec.bounds.max));}
    for(const x of [scanBounds.min.x,scanBounds.max.x])for(const y of [scanBounds.min.y,scanBounds.max.y])for(const z of [scanBounds.min.z,scanBounds.max.z])this.fitPoints.push(new THREE.Vector3(x,y,z));
    for(const y of [0,5.2,10,17,23.5]) {
      const array=new Float32Array([x0,y,z0,x1,y,z0,x1,y,z0,x1,y,z1,x1,y,z1,x0,y,z1,x0,y,z1,x0,y,z0]);
      const g=this.own(new THREE.BufferGeometry());g.setAttribute('position',new THREE.BufferAttribute(array,3));
      const line=new THREE.LineSegments(g,this.own(new THREE.LineBasicMaterial({color:0x4a7892,transparent:true,opacity:y===0?.28:.08,depthWrite:false})));
      this.scene.add(line);
    }
  }

  makeLines(edges,kind,opacity) {
    const geometry=this.own(new THREE.BufferGeometry());
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(edges.length*6),3).setUsage(THREE.DynamicDrawUsage));
    const colors=new Float32Array(edges.length*6);
    edges.forEach((e,i)=>{const c=color(e.color||(kind==='selection'?'#f2d69d':kind==='saved'?'#9ab3c6':'#7caccc'));c.toArray(colors,i*6);c.toArray(colors,i*6+3);});
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    const material=this.own(new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity,depthWrite:false,toneMapped:false}));
    const lines=new THREE.LineSegments(geometry,material);lines.frustumCulled=false;lines.userData={edges,kind};this.scene.add(lines);return lines;
  }

  restart() {
    if(!this.model)return;
    this.progress=this.viewer._reducedMotion?1:0;this.playing=!this.viewer._reducedMotion;
    // Keep the reference framing steady while the hierarchy unfolds.
    this.dirty=true;this.updatePlayer();
  }

  updatePlayer() {
    this.play.textContent=this.playing?'Pause':'Play';this.play.setAttribute('aria-label',this.playing?'Pause graph animation':'Play graph animation');
    this.seek.value=String(Math.round(this.progress*1000));
    this.status.textContent=this.progress>=1?'Graph complete':this.progress<.32?'Lifting objects':this.progress<.56?'Connecting places':this.progress<.72?'Grouping lab areas':this.progress<.88?'Connecting chambers':'Completing hierarchy';
  }

  resize(force=false) {
    const rect=this.viewer.canvas.getBoundingClientRect();
    if(!force&&rect.width===this.width&&rect.height===this.height)return;
    const refit=force||(this.width&&(Math.abs(Math.log(rect.width/this.width))>.25||Math.abs(Math.log(rect.height/this.height))>.25));
    this.width=rect.width;this.height=rect.height;this.camera.aspect=rect.width/rect.height;this.camera.updateProjectionMatrix();
    if(refit&&this.bounds) {
      this.fitDirection=new THREE.Vector3(...DEFAULT_GRAPH_VIEW.direction).normalize();
      const right=new THREE.Vector3().crossVectors(this.camera.up,this.fitDirection).normalize();
      const up=new THREE.Vector3().crossVectors(this.fitDirection,right).normalize();
      const center=new THREE.Vector3(...DEFAULT_GRAPH_VIEW.target);
      const tanY=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)),tanX=tanY*this.camera.aspect;
      const usableX=1-2*(rect.width<700?22:65)/rect.width;
      const usableY=Math.max(.35,1-2*55/rect.height);
      // Match the reference zoom on desktop, moving back only when needed to
      // keep the scan and graph within a smaller viewport.
      this.fitDistance=Math.max(DEFAULT_GRAPH_VIEW.distance,...this.fitPoints.map(p=>{
        const v=p.clone().sub(center);
        return v.dot(this.fitDirection)+Math.max(Math.abs(v.dot(right))/(tanX*usableX),Math.abs(v.dot(up))/(tanY*usableY));
      }));
      this.controls.maxDistance=Math.max(130,this.fitDistance*1.1);
      // Finish pending orbit/pan inertia before applying the preset, so a Fit
      // click or reopening during a gesture cannot drift away from this view.
      const damping=this.controls.enableDamping;
      this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=damping;
      this.controls.target.copy(center);
      this.camera.position.copy(center).addScaledVector(this.fitDirection,this.fitDistance);
      this.camera.lookAt(center);this.controls.update();
    }
  }

  updateGeometry() {
    const matrix=new THREE.Matrix4(),scale=new THREE.Vector3(),q=new THREE.Quaternion();
    for(const mesh of this.nodeMeshes.values()) {
      mesh.userData.nodes.forEach((n,i)=>{
        const t=revealAt(this.progress,n),p=this.current.get(n.id);
        p.fromArray(n.anchor).lerp(this.projected.fromArray(n.position),t);
        const selected=this.selected?.id===n.id;
        scale.setScalar(Math.max(.001,t)*(selected?1.55:1));matrix.compose(p,q,scale);mesh.setMatrixAt(i,matrix);
      });mesh.instanceMatrix.needsUpdate=true;
    }
    for(const line of [this.hierarchy,this.tethers,this.saved,this.selectionLines]) {
      const array=line.geometry.attributes.position.array;
      line.userData.edges.forEach((e,i)=>{
        const a=this.current.get(e.from),b=this.current.get(e.to);if(!a||!b)return;
        const target=this.model.byId.get(e.to),t=revealAt(this.progress,target);
        const start=e.anchor?new THREE.Vector3(...e.anchor):a;
        start.toArray(array,i*6);this.projected.copy(start).lerp(b,t).toArray(array,i*6+3);
      });line.geometry.attributes.position.needsUpdate=true;
    }
    this.saved.visible=this.showSaved;this.dirty=false;
  }

  render(dt) {
    if(this.exportController)return;
    if(!this.active)return;this.resize();
    if(this.model&&this.nodeMeshes) {
      if(this.playing){this.progress=Math.min(1,this.progress+dt/5.2);this.dirty=true;if(this.progress===1)this.playing=false;this.updatePlayer();}
      if(this.dirty)this.updateGeometry();
      this.syncMap();const state=this.viewer.robotMapSync?.state;
      this.agent.visible=Boolean(state?.fresh&&!this.viewer.liveRobotPending&&this.progress>.35);
      this.agentTether.visible=this.agent.visible;
      if(this.agent.visible){
        this.agent.position.fromArray(state.viewerPose.position).setY(5.2);
        const positions=this.agentTether.geometry.attributes.position;
        positions.setXYZ(0,this.agent.position.x,.08,this.agent.position.z);positions.setXYZ(1,this.agent.position.x,5.2,this.agent.position.z);positions.needsUpdate=true;
      }
    }
    this.controls.update();this.viewer.renderer.render(this.scene,this.camera);
    if(this.model&&this.nodeMeshes)this.positionLabels();
  }

  syncMap() {
    const sync=this.viewer.robotMapSync,source=sync?.group.children.find(n=>n.isMesh&&n.material.map);
    if(!source)return;
    if(!this.mapMesh){
      const material=this.own(source.material.clone());material.opacity=.38;material.depthTest=false;material.depthWrite=false;
      this.mapMesh=new THREE.Mesh(source.geometry,material);this.mapMesh.matrixAutoUpdate=false;this.mapMesh.renderOrder=5;
      this.scene.add(this.mapMesh);this.mapInput.disabled=false;
    }
    source.updateWorldMatrix(true,false);this.mapMesh.matrix.copy(source.matrixWorld);this.mapMesh.visible=this.mapInput.checked;
  }

  positionLabels() {
    const canvas=this.viewer.canvas.getBoundingClientRect(),overlay=this.root.getBoundingClientRect();
    const callouts=[],sizeKey=`${canvas.width}:${canvas.height}:${document.fonts.status}`;
    const place=(node,point,shown,position=true)=>{
      const p=this.projected.copy(point).project(this.camera);
      node.hidden=!shown||p.z < -1||p.z>1||Math.abs(p.x)>.99||Math.abs(p.y)>.99;
      const x=canvas.left-overlay.left+(p.x+1)*canvas.width/2,y=canvas.top-overlay.top+(1-p.y)*canvas.height/2;
      if(!node.hidden&&position)node.style.transform=`translate3d(${x}px,${y-10}px,0) translate(-50%,-100%)`;
      return {x,y};
    };
    for(const entry of this.labelEntries) {
      const {node,element}=entry;
      const selected=this.selected?.id===node.id;
      const callout=node.kind==='chamber'||node.kind==='area';
      const p=place(element,this.current.get(node.id),revealAt(this.progress,node)>.75&&(node.kind!=='object'||this.ui.showLabels||selected),!callout);
      if(callout&&!element.hidden) {
        // Measure only on reveal/resize/font changes, not on every animation frame.
        if(entry.sizeKey!==sizeKey){entry.sizeKey=sizeKey;entry.width=element.offsetWidth;entry.height=element.offsetHeight;}
        callouts.push({...p,element,width:entry.width,height:entry.height});
      }
      element.classList.toggle('selected',selected);
    }
    // Screen-space callouts keep neighbouring group names clickable while the
    // actual nodes and branches remain registered over their member areas.
    const placed=[];
    for(const label of callouts.sort((a,b)=>a.y-b.y||a.x-b.x)) {
      const left=label.x-label.width/2,right=label.x+label.width/2,candidates=[];
      for(let step=0;step<=callouts.length;step++)candidates.push(label.y-10-label.height-step*(label.height+6),label.y+12+step*(label.height+6));
      const top=candidates.find(y=>y>=0&&y+label.height<=overlay.height&&placed.every(box=>right+6<=box.left||left>=box.right+6||y+label.height+6<=box.top||y>=box.bottom+6))??candidates[0];
      const below=top>=label.y;
      label.element.dataset.labelSide=below?'below':'above';
      label.element.style.setProperty('--graph-leader',`${below?top-label.y:label.y-top-label.height}px`);
      label.element.style.transform=`translate3d(${label.x}px,${top}px,0) translateX(-50%)`;
      placed.push({left,right,top,bottom:top+label.height});
    }
    place(this.agentLabel,this.agent.position,this.agent.visible);
  }

  pick(x,y) {
    if(!this.model)return;
    const rect=this.viewer.canvas.getBoundingClientRect();this.pointer.set((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hits=this.raycaster.intersectObjects([...this.nodeMeshes.values()],false);
    const hit=hits.find(h=>revealAt(this.progress,h.object.userData.nodes[h.instanceId])>.5);
    if(hit)this.select(hit.object.userData.nodes[hit.instanceId].id);
  }

  select(id) {
    const n=this.model.byId.get(id);if(!n)return;this.selected=n;this.dirty=true;
    this.ui.preview.hide();this.syncScanSelection();
    this.detail.replaceChildren();this.detail.hidden=false;
    this.detail.scrollTop=0;
    const head=el('div',undefined,'graph-detail-heading');head.append(el('span',n.kind.toUpperCase(),'graph-eyebrow'),btn('×',()=>{this.selected=null;this.detail.hidden=true;this.box.visible=false;this.ui.preview.hide();this.syncScanSelection();this.replaceSelection([]);this.dirty=true;},'graph-detail-close'));
    const title=el('h3',n.label);this.detail.append(head,title);
    if(n.kind!=='chamber')this.detail.append(el('p',n.source,'graph-source'));
    if(n.kind!=='chamber'&&this.viewer.robotMapSync?.alignment){
      const map=viewerToMap(n.anchor,this.viewer.robotMapSync.alignment);
      this.detail.append(el('p',`Map position · x ${map[0].toFixed(2)} m · y ${map[1].toFixed(2)} m`,'graph-map-position'));
    }
    const relations=this.model.savedEdges.filter(e=>e.from===id||e.to===id);
    if(n.kind==='object') {
      const object=this.layer.objects.get(n.objectId);
      this.ui.preview.show(title,object,this.layer);
      this.detail.append(el('p',object.description||'No description saved in the supplied annotations.','graph-description'));
      const chips=el('div',undefined,'segment-chips');for(const text of object.affordances||[])chips.append(el('span',text));this.detail.append(chips);
      const entry=this.layer.manifest.objects[String(n.objectId)];this.box.box.set(new THREE.Vector3(...entry.bounds.min),new THREE.Vector3(...entry.bounds.max));this.box.visible=true;
      this.detail.append(btn('Inspect in lab →',()=>{this.close();this.layer.select(n.objectId);this.ui.focus(n.objectId);},'graph-inspect'));
    } else {
      this.box.visible=false;
      this.detail.append(el('p',n.kind==='chamber'?n.description:n.kind==='area'?`${n.objectCount} nearby annotated objects. This is a display grouping around a lab station.`:n.kind==='place'?'A sampled point on the observed walkable floor. Connections follow clear floor cells; this is a display topology.':`${this.model.stats.chambers} chambers · ${this.model.stats.objects} annotated objects.`, 'graph-description'));
      if(n.kind==='chamber'||n.kind==='lab') {
        const members=n.kind==='chamber'?n.areaIds.map(areaId=>this.model.byId.get(areaId)):this.model.chambers;
        const list=el('div',undefined,'graph-relation-list graph-member-list');
        list.setAttribute('aria-label',n.kind==='chamber'?'Areas in this chamber':'Lab chambers');
        for(const member of members)list.append(btn(member.label,()=>this.select(member.id)));
        this.detail.append(el('p',n.kind==='chamber'?'Areas':'Chambers','graph-members-heading'),list);
      }
      if(n.kind==='area') {
        const chamber=this.model.byId.get(n.chamberId);
        this.detail.append(btn(`← ${chamber.label} chamber`,()=>this.select(chamber.id),'graph-parent'));
        const list=el('div',undefined,'graph-relation-list');
        for(const o of this.model.objects.filter(o=>o.areaId===id))list.append(btn(o.label,()=>this.select(o.id)));this.detail.append(list);
      }
    }
    const saved=el('details',undefined,'graph-relations');saved.open=n.kind==='object';saved.append(el('summary',`${relations.length} saved relationships`));
    const list=el('div',undefined,'graph-relation-list');
    for(const r of relations){const other=r.from===id?r.to:r.from;list.append(btn(`${r.from===id?'→':'←'} ${r.label||r.type} · ${this.model.byId.get(other).label}`,()=>this.select(other)));}
    saved.append(list);if(n.kind!=='chamber')this.detail.append(saved);
    this.replaceSelection(n.kind==='object'&&relations.length?relations:this.model.edges.filter(e=>e.from===id||e.to===id));
  }

  syncScanSelection() {
    const id=this.selected?.kind==='object'?this.selected.objectId:0;
    if(this.scanMaterial)this.scanMaterial.uniforms.selectedId.value=id;
    const range=this.layer?.manifest.overlaps.ranges[String(id)];
    this.layer?.overlap?.geometry.setDrawRange(range?.start||0,range?.count||0);
  }

  replaceSelection(edges) {
    const old=this.selectionLines;this.scene.remove(old);this.owned.delete(old.geometry);this.owned.delete(old.material);old.geometry.dispose();old.material.dispose();
    this.selectionLines=this.makeLines(edges,'selection',.9);
  }

  async downloadAnimation() {
    if(!this.active||!this.model||this.download.disabled||this.exportController)return;
    const controller=this.exportController=new AbortController(),playing=this.playing;
    this.playing=false;this.download.disabled=true;
    this.exportProgress.hidden=false;this.exportProgress.value=0;this.exportCancel.textContent='Cancel';
    const selection=this.selected?` “${this.selected.label}” highlighted`:'the full lab hierarchy';
    this.exportMessage.textContent=`Recording ${selection}${this.selected?' with its details panel and object preview':''}. The whole graph will replay and hold at the end. Keep this tab open.`;
    this.exportDialog.showModal();
    try {
      const result=await recordSceneGraph(this,{signal:controller.signal,onProgress:value=>{this.exportProgress.value=value;}});
      if(controller.signal.aborted)return;
      saveRecording(result);this.exportDialog.close();
    } catch(error) {
      if(error.name==='AbortError'||!this.active||this.disposed)this.exportDialog.close();
      else {this.exportMessage.textContent=error.message;this.exportProgress.hidden=true;this.exportCancel.textContent='Close';}
    } finally {
      this.exportController=null;this.download.disabled=!this.model||!this.layer;
      if(!this.disposed){this.playing=this.active&&playing;this.dirty=true;this.updatePlayer();}
    }
  }

  clearScene() {
    for(const resource of this.owned)resource.dispose();this.owned.clear();this.scene.clear();
  }

  dispose() {
    this.close();this.ui.preview.dispose();this.disposed=true;this.controls.dispose();this.listeners.forEach(fn=>fn());this.clearScene();this.root.remove();
  }
}
