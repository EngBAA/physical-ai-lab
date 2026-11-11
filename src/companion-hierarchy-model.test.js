import assert from 'node:assert/strict';
import { hierarchyBranch } from './companion-hierarchy-model.js';

const nodes = [
  {id:'lab',label:'Physical AI Lab',kind:'lab'},
  {id:'home',label:'Home',kind:'chamber'},
  {id:'area',label:'Kitchen & dining',kind:'area'},
  {id:'n15',label:'Chair 5',kind:'object',areaId:'area'},
  {id:'n99',label:'Coffee Maker',kind:'object',areaId:'area'},
];
const model = {nodes, byId:new Map(nodes.map(node=>[node.id,node])), edges:[
  {from:'n99',to:'area',kind:'hierarchy'}, {from:'n15',to:'area',kind:'hierarchy'},
  {from:'area',to:'home',kind:'hierarchy'}, {from:'home',to:'lab',kind:'hierarchy'},
  {from:'n99',to:'n15',kind:'topology'},
]};
const robot = {nodes:[{id:'kitchen',name:'kitchen',kind:'place'},
  {id:'n15',name:'Coffee Maker',kind:'object',parent:'kitchen'}],aliases:{coffee_machine:['n15']}};
const branch=hierarchyBranch(model,{nodes:['coffee_machine']},robot);
assert.deepEqual(branch.matches.map(node=>node.id),['n99'],'a recycled map ID must never highlight Chair 5');
assert.deepEqual(branch.edges.map(edge=>edge.from),['home','area','n99']);
assert(!branch.edges.some(edge=>edge.kind==='topology'));
assert.deepEqual(hierarchyBranch(model,{nodes:['kitchen','Coffee Maker']},robot).matches.map(n=>n.id),['n99']);
assert.deepEqual(hierarchyBranch(model,{route:['kitchen']},robot).matches.map(n=>n.id),['area']);
assert.deepEqual(hierarchyBranch(model,{nodes:['not in the graph']},robot).edges,[]);
assert.deepEqual(hierarchyBranch(model,{nodes:['Coffee_Maker']},robot).matches.map(n=>n.id),['n99']);
