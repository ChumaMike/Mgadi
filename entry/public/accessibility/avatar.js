// Original 3D mesh companion: ellipsoids, perspective, depth sorting and lighting.
// Provider speaking/listening activity drives motion; this is not lip-sync or SASL.
export function createAvatar(canvas) {
  const ctx = canvas.getContext('2d');
  let running=false,frame=0,phase=0,angle=-.1,mood='idle',previous=0;
  const skin=[155,98,65],shirt=[45,94,78],hair=[39,35,31],surfaces=[];
  const rotate=([x,y,z])=>[x*Math.cos(angle)+z*Math.sin(angle),y,-x*Math.sin(angle)+z*Math.cos(angle)];
  const project=([x,y,z])=>{const scale=canvas.width*.38*5/(5-z);return [canvas.width*.5+x*scale,canvas.height*.51-y*scale];};
  function ellipsoid(center,radius,color,segments=20,rings=12){
    const point=(i,j)=>{const t=Math.PI*i/rings,p=2*Math.PI*j/segments;return [center[0]+radius[0]*Math.sin(t)*Math.cos(p),center[1]+radius[1]*Math.cos(t),center[2]+radius[2]*Math.sin(t)*Math.sin(p)];};
    for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){
      const points=[point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)];
      const mid=points.reduce((a,p)=>a.map((v,k)=>v+p[k]/4),[0,0,0]);
      const normal=rotate(mid.map((v,k)=>(v-center[k])/(radius[k]*radius[k]))),length=Math.hypot(...normal)||1;
      if(normal[2]/length<-.12)continue;
      const light=.65+.35*Math.max(0,(-.45*normal[0]+.65*normal[1]+.7*normal[2])/length),rotated=points.map(rotate);
      surfaces.push({points:rotated.map(project),z:rotated.reduce((n,p)=>n+p[2]/4,0),color:`rgb(${color.map(v=>Math.round(v*light)).join(',')})`});
    }
  }
  function draw(){
    if(!ctx)return;surfaces.length=0;
    const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
    const bg=ctx.createRadialGradient(w*.4,h*.25,5,w*.5,h*.5,w*.8);bg.addColorStop(0,'#f3f3df');bg.addColorStop(1,'#b9ccad');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#ffffff45';ctx.beginPath();ctx.ellipse(w*.5,h*.37,w*.36,h*.32,0,0,Math.PI*2);ctx.fill();
    const movement=running?Math.sin(phase):0,bob=movement*(mood==='speaking'?.022:.008),lean=mood==='listening'?.035:0;
    ellipsoid([0,-.75,0],[.8,.9,.35],shirt);
    ellipsoid([-.6,-.58,.02],[.3,.63,.3],shirt);ellipsoid([.6,-.58,.02],[.3,.63,.3],shirt);
    ellipsoid([0,.18,.02],[.19,.32,.19],skin);
    for(const side of [-1,1])ellipsoid([side*.19,.02,.29],[.21,.075,.055],[26,65,53],16,8);
    const head=[lean,.69+bob,.04];
    for(const side of [-1,1])ellipsoid([head[0]+side*.34,head[1]-.03,.04],[.075,.13,.075],skin,12,8);
    ellipsoid(head,[.35,.46,.3],skin,28,18);ellipsoid([head[0],head[1]+.29,-.03],[.36,.2,.31],hair,24,12);
    for(const side of [-1,1]){
      const x=head[0]+side*.135,y=head[1]+.05,blink=running&&Math.sin(phase*.43)>.996;
      ellipsoid([x,y+.065,.305],[.09,.022,.018],hair,12,6);
      ellipsoid([x,y,.31],[.064,blink?.007:.03,.018],[240,233,213],12,8);
      if(!blink){ellipsoid([x+.008,y,.327],[.023,.026,.012],[39,34,29],12,8);ellipsoid([x+.003,y+.008,.337],[.007,.008,.005],[255,250,226],8,6);}
    }
    ellipsoid([head[0],head[1]-.035,.32],[.058,.10,.062],[165,106,72],14,10);
    const open=mood==='speaking'?(running?(Math.sin(phase*9)+1)*.018+.012:.03):.009;
    ellipsoid([head[0],head[1]-.18,.29],[.09,open,.025],[73,41,33],16,8);
    ellipsoid([head[0],head[1]-.207-open*.3,.283],[.075,.015,.024],[183,114,84],16,6);
    // Relaxed arms and separate fingers; breathing only, never presented as a sign.
    for(const side of [-1,1]){
      const lift=mood==='speaking'?movement*.025:0;
      ellipsoid([side*.56,-1.05+lift,.25],[.17,.34,.17],skin,16,10);
      ellipsoid([side*.39,-1.2+lift,.39],[.19,.13,.09],skin,16,10);
      for(let finger=0;finger<4;finger++)ellipsoid([side*(.29+finger*.055),-1.31+lift,.4],[.024,.115-finger*.012,.027],skin,10,6);
      ellipsoid([side*.25,-1.17+lift,.44],[.08,.035,.035],skin,12,6);
    }
    surfaces.sort((a,b)=>a.z-b.z);
    for(const face of surfaces){ctx.fillStyle=face.color;ctx.beginPath();face.points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fill();ctx.strokeStyle=face.color;ctx.lineWidth=.55;ctx.stroke();}
  }
  function animate(now=0){if(!running)return;if(previous && now-previous<32){frame=requestAnimationFrame(animate);return;}const elapsed=previous?Math.min(now-previous,50):16;previous=now;phase+=elapsed*.0017;draw();frame=requestAnimationFrame(animate);}
  draw();
  return {play(){if(!running){running=true;previous=0;frame=requestAnimationFrame(animate);}},pause(){running=false;cancelAnimationFrame(frame);draw();},rotate(value){angle=Number.isFinite(value)?value:0;draw();},setMood(next){mood=['idle','listening','speaking'].includes(next)?next:'idle';if(!running)draw();},destroy(){running=false;cancelAnimationFrame(frame);}};
}
