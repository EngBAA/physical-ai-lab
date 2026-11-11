// IDs in the website export and the deployed robot map aren't interchangeable.
// Resolve through names; only the website model supplies the displayed edges.
const key = text => String(text || '').toLowerCase().replace(/[_\W]+/g, ' ').trim();

export function hierarchyBranch(model, event, robotScene = {}) {
  const requested = [...(event.nodes || []), ...(event.route || [])];
  const robotNodes = robotScene.nodes || [];
  const terms = new Set(requested);
  for (const name of requested) {
    const aliases = robotScene.aliases?.[name] || [];
    for (const alias of Array.isArray(aliases) ? aliases : [aliases]) terms.add(alias);
  }
  const resolved = robotNodes.filter(node => terms.has(node.id) || [...terms].some(term => key(term) === key(node.name)));
  const explicitObjects = resolved.filter(node => node.kind === 'object');
  const wantedNames = new Set(explicitObjects.map(node => key(node.name)));
  // A record's public name may exist on the website without being on the robot map.
  for (const term of terms) if (!robotNodes.some(node => node.id === term)) wantedNames.add(key(term));
  let matches = model.nodes.filter(node => wantedNames.has(key(node.label)));
  if (!matches.length) {
    // Navigation places are a different topology. Highlight their existing
    // website areas, not fictitious navigation edges between display nodes.
    const areaIds = new Set();
    for (const place of resolved.filter(node => node.kind === 'place')) {
      const labels = new Set(robotNodes.filter(node => node.parent === place.id).map(node => key(node.name)));
      for (const object of model.nodes.filter(node => node.kind === 'object' && labels.has(key(node.label)))) {
        if (object.areaId) areaIds.add(object.areaId);
      }
    }
    matches = model.nodes.filter(node => areaIds.has(node.id));
  }
  const parents = new Map(model.edges.filter(edge => edge.kind === 'hierarchy').map(edge => [edge.from, edge]));
  const branches = new Map();
  for (const node of matches) {
    let id = node.id; const seen = new Set();
    while (parents.has(id) && !seen.has(id)) {
      seen.add(id); const edge = parents.get(id); branches.set(edge.from, edge); id = edge.to;
    }
  }
  const depth = {lab:0, chamber:1, area:2, place:3, object:4};
  return {matches, edges:[...branches.values()].sort((a,b) => depth[model.byId.get(a.to).kind] - depth[model.byId.get(b.to).kind])};
}
