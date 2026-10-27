import {forceSimulation,forceManyBody,forceLink,forceCenter} from 'd3-force-3d';

// Physics runs off the UI thread; only public identifiers and graph edges enter it.
export function layoutNetwork(input){
 const nodes=input.nodes.map(node=>({id:node.id}));
 const links=input.links.map(edge=>({source:typeof edge.source==='string'?edge.source:edge.source.id,target:typeof edge.target==='string'?edge.target:edge.target.id}));
 const simulation=forceSimulation(nodes,2).force('charge',forceManyBody().strength(-30)).force('link',forceLink(links).id(node=>node.id).distance(45)).force('center',forceCenter(0,0)).stop();
 simulation.tick(120);
 return nodes.map(({id,x,y})=>({id,x,y}));
}
if(typeof self!=='undefined')self.onmessage=event=>self.postMessage(layoutNetwork(event.data));
