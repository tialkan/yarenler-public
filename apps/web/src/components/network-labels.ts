export type LabelBox={id:string;x:number;y:number;width:number;height:number};
export function placeNetworkLabels(items:LabelBox[],width:number,height:number):LabelBox[]{
 const placed:LabelBox[]=[];
 for(const item of items){
  const w=Math.min(item.width,width-16),h=item.height,x=Math.max(w/2+8,Math.min(width-w/2-8,item.x));let result={...item,width:w,x,y:Math.max(8,Math.min(height-h-8,item.y))};
  for(let attempt=0;attempt<80;attempt++){
   const offset=attempt===0?0:Math.ceil(attempt/2)*(h+7)*(attempt%2?1:-1);
   const candidate={...result,y:Math.max(8,Math.min(height-h-8,item.y+offset))};
   if(!placed.some(box=>Math.abs(candidate.x-box.x)<(candidate.width+box.width)/2+7&&candidate.y<box.y+box.height+5&&candidate.y+candidate.height+5>box.y)){result=candidate;break;}
  }
  placed.push(result);
 }
 return placed;
}
