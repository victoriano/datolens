(() => {
  document.documentElement.classList.add('js');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(({target, isIntersecting}) => { if (isIntersecting) { target.classList.add('visible'); revealObserver.unobserve(target); } });
  }, {threshold: 0.12});
  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
  if (document.body.dataset.page !== 'home') return;
  const en = document.documentElement.lang === 'en';
  const demo = document.querySelector('.demo-section');
  let seed=426731;
  function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
  let view=0,timer=null,visible=true,paused=reduced.matches;
  const views=['product-table','product-explore','product-chart'];
  const motionButton=document.querySelector('#motion-toggle');
  function updateMotion() {
    demo.classList.toggle('paused',paused);
    motionButton.setAttribute('aria-label',paused?(en?'Resume animation':'Reanudar animación'):(en?'Pause animation':'Pausar animación'));
    motionButton.setAttribute('aria-pressed',String(paused));
    motionButton.innerHTML=paused?'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 3 11 7-11 7Z" fill="currentColor"/></svg>':'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4v12M14 4v12" stroke="currentColor" stroke-width="2"/></svg>';
    schedule();
  }
  function schedule() {clearTimeout(timer);if(!paused&&visible&&!document.hidden)timer=setTimeout(()=>setView((view+1)%3,false),8000);}
  function setView(index,manual=true){
    view=index;
    views.forEach((id,i)=>{document.getElementById(id).hidden=i!==view;});
    document.querySelectorAll('[data-view]').forEach(b=>{const selected=Number(b.dataset.view)===view;b.setAttribute('aria-selected',String(selected));b.classList.toggle('active',selected);b.tabIndex=selected?0:-1;});
    document.querySelectorAll('[data-step]').forEach(b=>{const selected=Number(b.dataset.step)===view;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
    if(manual)paused=true;
    updateMotion();
  }
  document.querySelectorAll('[data-view],[data-step]').forEach(b=>b.addEventListener('click',()=>setView(Number(b.dataset.view??b.dataset.step))));
  document.querySelector('.demo-steps').addEventListener('keydown',event=>{
    if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?2:(view+(event.key==='ArrowRight'?1:2))%3;
    setView(next);document.querySelector(`[data-view="${next}"]`).focus();
  });
  motionButton.addEventListener('click',()=>{paused=!paused;updateMotion();});
  new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;schedule();},{threshold:.15}).observe(demo);
  document.addEventListener('visibilitychange',schedule);
  // Entering the screenshot gallery pauses automatic view changes so keyboard focus stays stable.
  demo.addEventListener('focusin',event=>{if(event.target!==motionButton){paused=true;updateMotion();}});
  reduced.addEventListener('change',()=>{if(reduced.matches){paused=true;updateMotion();}});
  setView(0,false);

  const canvas=document.querySelector('#universe'),context=canvas.getContext('2d');
  if(!context)return;
  let width=0,height=0,raf=0,inView=false,start=0;
  const dots=Array.from({length:700},(_,i)=>({x:random(),y:random(),angle:random()*Math.PI*2,phase:i*.07,size:random()*.85+.65}));
  function resize(){const bounds=canvas.getBoundingClientRect();width=bounds.width;height=bounds.height;const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);context.setTransform(dpr,0,0,dpr,0,0);draw(performance.now());}
  function draw(time){
    if(!start)start=time;
    const t=reduced.matches?0:(time-start)/1000;
    context.clearRect(0,0,width,height);
    const blend=reduced.matches?.65:(Math.sin(t*.26)+1)/2;
    dots.forEach((dot,i)=>{
      const col=i%35,row=Math.floor(i/35);
      const gridX=(col/34*.88+.06)*width,gridY=(row/19*.76+.1)*height;
      const angle=dot.angle+t*.035;
      const radius=Math.sqrt(dot.x)*.4;
      const cloudX=width*(.5+Math.cos(angle)*radius),cloudY=height*(.48+Math.sin(angle)*radius*.9);
      const x=gridX*(1-blend)+cloudX*blend,y=gridY*(1-blend)+cloudY*blend;
      const lit=(i%17===0)||i>285&&i<315;
      context.fillStyle=lit?'rgba(202,230,171,.9)':`rgba(144,168,120,${.22+dot.y*.38})`;
      context.beginPath();context.arc(x,y,dot.size*(lit?1.3:1),0,Math.PI*2);context.fill();
    });
  }
  function frame(time){draw(time);if(inView&&!document.hidden&&!reduced.matches)raf=requestAnimationFrame(frame);else raf=0;}
  function playUniverse(){if(inView&&!document.hidden&&!reduced.matches&&!raf)raf=requestAnimationFrame(frame);}
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;playUniverse();},{threshold:.05}).observe(canvas);
  document.addEventListener('visibilitychange',playUniverse);
  reduced.addEventListener('change',()=>{if(reduced.matches){cancelAnimationFrame(raf);raf=0;draw(performance.now());}else playUniverse();});
})();
