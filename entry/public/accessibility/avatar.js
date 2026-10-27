// Procedural 3D mannequin: articulated XYZ joints, perspective projection and depth sorting.
// This is original model geometry, NOT a SASL animation library or translator.
export function createAvatar(canvas) {
  const ctx = canvas.getContext('2d');
  let running = false, frame = 0, phase = 0, angle = -.12;
  const limbs = [];
  const joint = (x,y,z) => [x,y,z];
  const add = (a,b,width,color='#bd8769') => limbs.push({a,b,width,color});
  function draw() {
    if (!ctx) return;
    limbs.length = 0;
    const sway = running ? Math.sin(phase)*.025 : 0;
    const shoulderL=joint(-.52,.65,0), shoulderR=joint(.52,.65,0);
    const elbowL=joint(-.7,-.05,.08), elbowR=joint(.7,-.05,.08);
    const wristL=joint(-.45,-.65,.35+sway), wristR=joint(.45,-.65,.35-sway);
    add(joint(0,-.85,0),joint(0,.55,0),.95,'#24594e');
    add(shoulderL,shoulderR,.36,'#24594e');
    add(joint(0,.6,0),joint(0,1.02,0),.24);
    add(shoulderL,elbowL,.22,'#24594e'); add(shoulderR,elbowR,.22,'#24594e');
    add(elbowL,wristL,.17); add(elbowR,wristR,.17);
    for (const [w,side] of [[wristL,-1],[wristR,1]]) {
      const palm=joint(w[0],w[1]-.19,w[2]); add(w,palm,.18);
      // Five separate fingers, each with three bones; neutral pose only.
      for(let finger=0;finger<5;finger++) {
        let p=joint(palm[0]+(finger-2)*.045,palm[1],palm[2]);
        const length=finger===0?.13:.23-Math.abs(finger-2)*.025;
        for(let k=0;k<3;k++) {
          const n=joint(p[0]+(finger===0?side*.035:0),p[1]-length/3,p[2]+.015*k);
          add(p,n,.033); p=n;
        }
      }
    }
    add(joint(-.26,-.8,0),joint(-.3,-1.9,.03),.4,'#243b43');
    add(joint(.26,-.8,0),joint(.3,-1.9,.03),.4,'#243b43');
    const rotated = p => [p[0]*Math.cos(angle)+p[2]*Math.sin(angle),p[1],-p[0]*Math.sin(angle)+p[2]*Math.cos(angle)];
    const project = p => { const [x,y,z]=rotated(p); const scale=122*4/(4-z); return [canvas.width/2+x*scale,canvas.height*.44-y*scale,scale]; };
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const gradient=ctx.createRadialGradient(200,150,0,200,200,300); gradient.addColorStop(0,'#eef6ec');gradient.addColorStop(1,'#c3d5cc');ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#123c3520';ctx.beginPath();ctx.ellipse(200,438,100,15,0,0,Math.PI*2);ctx.fill();
    limbs.sort((a,b)=>(rotated(a.a)[2]+rotated(a.b)[2])-(rotated(b.a)[2]+rotated(b.b)[2]));
    for(const limb of limbs) { const a=project(limb.a),b=project(limb.b);ctx.lineCap='round';ctx.lineWidth=limb.width*(a[2]+b[2])/2; const shade=ctx.createLinearGradient(a[0]-ctx.lineWidth/2,a[1],a[0]+ctx.lineWidth/2,a[1]); shade.addColorStop(0,'#253d3b');shade.addColorStop(.35,limb.color);shade.addColorStop(.7,limb.color);shade.addColorStop(1,'#31443e');ctx.strokeStyle=shade;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke(); }
    const h=project(joint(0,1.22,.02));
    const skin=ctx.createRadialGradient(h[0]-12,h[1]-10,3,h[0],h[1],50);skin.addColorStop(0,'#dba383');skin.addColorStop(1,'#93664f');ctx.fillStyle=skin;ctx.beginPath();ctx.ellipse(h[0],h[1],.3*h[2],.38*h[2],0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#26352f';ctx.beginPath();ctx.ellipse(h[0],h[1]-.25*h[2],.29*h[2],.15*h[2],0,Math.PI,Math.PI*2);ctx.fill();
    for(const dx of [-.1,.1]){const eye=project(joint(dx,1.26,.32));ctx.beginPath();ctx.arc(eye[0],eye[1],3,0,Math.PI*2);ctx.fill();}
    const mouth=project(joint(0,1.08,.3));ctx.strokeStyle='#714637';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(mouth[0]-8,mouth[1]);ctx.lineTo(mouth[0]+8,mouth[1]);ctx.stroke();
  }
  function animate(){phase+=.025;draw();if(running)frame=requestAnimationFrame(animate);}
  draw();
  return { play(){if(!running){running=true;animate();}},pause(){running=false;cancelAnimationFrame(frame);draw();},rotate(value){angle=value;draw();},destroy(){running=false;cancelAnimationFrame(frame);} };
}
