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

  // Rounded limbs aligned between two real 3D joints. Uses the same depth-sorted mesh pipeline as the head.
  // These motions are visual prompts, NOT representations of SASL vocabulary.
  function limb(a,b,r,color) {
    const mid=a.map((v,i)=>(v+b[i])*.5), delta=b.map((v,i)=>v-a[i]);
    const len=Math.hypot(...delta)||1, y=delta.map(v=>v/len);
    const tangent=Math.abs(y[2])>.9?[1,0,0]:[0,0,1];
    let x=[y[1]*tangent[2]-y[2]*tangent[1],y[2]*tangent[0]-y[0]*tangent[2],y[0]*tangent[1]-y[1]*tangent[0]];
    const xl=Math.hypot(...x)||1; x=x.map(v=>v/xl);
    const z=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
    const segments=10,rings=7,half=len*.55;
    const p=(i,j)=>{
      const theta=Math.PI*i/rings,phi=2*Math.PI*j/segments;
      const u=Math.sin(theta)*Math.cos(phi)*r, v=Math.cos(theta)*half, w=Math.sin(theta)*Math.sin(phi)*r;
      return mid.map((c,k)=>c+x[k]*u+y[k]*v+z[k]*w);
    };
    for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){
      const pts=[p(i,j),p(i+1,j),p(i+1,j+1),p(i,j+1)];
      const avg=pts.reduce((a,v)=>a.map((n,k)=>n+v[k]/4),[0,0,0]);
      const normal=rotate(avg.map((v,k)=>(v-mid[k])/Math.max(r*r,.0001)));
      const mag=Math.hypot(...normal)||1;
      if(normal[2]/mag<-.12)continue;
      const light=.65+.35*Math.max(0,(-.45*normal[0]+.65*normal[1]+.7*normal[2])/mag);
      const rot=pts.map(rotate);
      surfaces.push({points:rot.map(project),z:rot.reduce((n,p)=>n+p[2]/4,0),color:`rgb(${color.map(v=>Math.round(v*light)).join(',')})`});
    }
  }
  const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
  const smooth=(t)=>{const v=Math.min(1,Math.max(0,t));return v*v*(3-2*v);};
  let gesture='none',gestureAt=0;
  function hand(wrist,side,style){
    const palm=[wrist[0],wrist[1]+.06,wrist[2]+.035];
    ellipsoid(palm,style==='phone'?[.095,.095,.065]:[.105,.12,.048],skin,12,8);
    if(style==='phone'){
      // Thumb and little finger extend like a familiar telephone pictogram.
      limb([palm[0]-side*.065,palm[1]-.025,palm[2]],[palm[0]-side*.135,palm[1]-.17,palm[2]+.055],.029,skin);
      limb([palm[0]+side*.065,palm[1]+.02,palm[2]],[palm[0]+side*.12,palm[1]+.19,palm[2]+.065],.026,skin);
      return;
    }
    for(let f=0;f<4;f++){
      const x=palm[0]+(f-1.5)*.048;
      const spread=(f-1.5)*.013;
      limb([x,palm[1]+.07,palm[2]],[x+spread,palm[1]+.21+(f===1||f===2?.025:0),palm[2]+.01],.022,skin);
    }
    limb([palm[0]-side*.07,palm[1]-.03,palm[2]],[palm[0]-side*.165,palm[1]+.015,palm[2]+.04],.028,skin);
  }
  function arms(){
    const easing=running?smooth((phase-gestureAt)*2.4):1;
    const sway=Math.sin(phase*2.7)*.028;
    for(const side of [-1,1]){
      const shoulder=[side*.59,-.55,.05];
      const baseElbow=[side*.77,-.96,.23],baseWrist=[side*.43,-1.16,.38];
      let goalElbow=baseElbow,goalWrist=baseWrist,shape='open';
      if(gesture==='stop'&&side===1){
        goalElbow=[.82,-.23,.36];goalWrist=[.75,.19+sway,.65];
      } else if(gesture==='call'&&side===1){
        goalElbow=[.78,-.24,.34];goalWrist=[.43,.42+sway*.35,.55];shape='phone';
      } else if(gesture==='save'){
        goalElbow=[side*.79,-.38,.34];goalWrist=[side*.27,-.26+sway*.4,.63];
      } else if(gesture==='help'){
        // Both arms above shoulder height: a familiar attention/help pose.
        goalElbow=[side*.87,-.07,.40];goalWrist=[side*.76,.53+sway,.66];
      } else if(gesture==='check'){
        // One hand near the chin while the other presents an open palm.
        if(side===1){goalElbow=[.74,-.25,.43];goalWrist=[.24,.24+sway,.66];}
        else{goalElbow=[-.79,-.43,.33];goalWrist=[-.52,-.31,.64];}
      } else if(gesture==='protect'){
        // Forearms crossed in front of the torso: illustrative protection pose.
        goalElbow=[side*.82,-.49,.46];goalWrist=[-side*.35,-.35+sway*.4,.77];
      }
      const elbow=mix(baseElbow,goalElbow,easing);
      const wrist=mix(baseWrist,goalWrist,easing);
      limb(shoulder,elbow,.15,shirt);limb(elbow,wrist,.115,skin);
      if(gesture!=='none'&&easing>.12)hand(wrist,side,shape);
      else ellipsoid(wrist,[.13,.11,.07],skin,12,8);
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
    // Articulated upper and lower arms with independently rendered palms/fingers.
    arms();
    surfaces.sort((a,b)=>a.z-b.z);
    for(const face of surfaces){ctx.fillStyle=face.color;ctx.beginPath();face.points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fill();ctx.strokeStyle=face.color;ctx.lineWidth=.55;ctx.stroke();}
  }
  function animate(now=0){if(!running)return;if(previous && now-previous<32){frame=requestAnimationFrame(animate);return;}const elapsed=previous?Math.min(now-previous,50):16;previous=now;phase+=elapsed*.0017;draw();frame=requestAnimationFrame(animate);}
  draw();
  return {play(){if(!running){running=true;previous=0;frame=requestAnimationFrame(animate);}},pause(){running=false;cancelAnimationFrame(frame);draw();},rotate(value){angle=Number.isFinite(value)?value:0;draw();},setMood(next){mood=['idle','listening','speaking'].includes(next)?next:'idle';if(!running)draw();},setGesture(next){gesture=['stop','call','save','help','check','protect'].includes(next)?next:'none';gestureAt=phase;if(!running)draw();},getGesture(){return gesture;},destroy(){running=false;cancelAnimationFrame(frame);}};
}
