/* שכבות איסורים קבועים — פמ״ת פנים ארצי א-17 (עדכון 1/26) + גבולות רשות הטבע והגנים
   נקודה צבעונית לכל אזור; בהתקרבות מופיע האזור המלא כפוליגון שקוף.
   לחיצה על המפה פותחת "כרטיס מידע" (InfoCard) אחד — כל האזורים והנוט"מים שחלים בנקודה. הכרטיס הוא אלמנט בתוך מכל המפה
   (לא חלון Leaflet): הוא מוצב בצד שלא מכסה את הנקודה ואת הפקדים, ואף פעם לא מזיז את המפה.
   נתונים: data/pmt-zones.json , data/inpa-zones.json */
(function(){
  if(typeof map==="undefined"||!map||typeof L==="undefined") return;

  /* מזהה גרסה — חייב להיות זהה ל-BUILD ב-index.html (index.html מרענן פעם אחת אם הקובץ הזה ישן) */
  const BUILD="20261004";
  window.PMT_BUILD=BUILD;

  /* ======================= InfoCard — כרטיס מידע צף שלא מזיז את המפה ======================= */
  const InfoCard=(function(){
    let mp=null, el=null, titleEl=null, bodyEl=null, pin=null, anchor=null, forbidFn=null, onClose=null;
    let touchMode=false, lastKey="", natH=0, raf=0, keyBound=false;
    const MARGIN=12, GAP=8;
    function css(){
      if(document.getElementById("infocard-css")) return;
      const s=document.createElement("style"); s.id="infocard-css";
      s.textContent=
      ".infocard{position:absolute;z-index:1200;display:none;flex-direction:column;box-sizing:border-box;cursor:default;touch-action:pan-y;"+
        "background:var(--panel,#121c2e);color:var(--ink,#e9eff9);border:1px solid var(--line,#22304a);border-radius:12px;"+
        "box-shadow:0 10px 34px rgba(0,0,0,.55);direction:rtl;text-align:right;font:13.5px/1.55 'Rubik',system-ui,sans-serif;overflow:hidden}"+
      ".infocard.on{display:flex}"+
      ".infocard .ic-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 6px 6px 12px;min-height:44px;"+
        "border-bottom:1px solid var(--line,#22304a);font-weight:800;font-size:14px;flex:none}"+
      ".infocard .ic-title{min-width:0;overflow-wrap:anywhere}"+
      ".infocard .ic-x{width:40px;height:40px;min-width:40px;padding:0;border:0;border-radius:10px;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer;flex:none;transition:none}"+
      ".infocard .ic-x:hover,.infocard .ic-x:focus-visible{background:rgba(255,255,255,.1);color:#fff;border:0}"+
      ".infocard .ic-body{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:8px 12px 12px;flex:1 1 auto;min-height:0;"+
        "overflow-wrap:anywhere;scrollbar-width:thin;scrollbar-color:#3a4d73 transparent}"+
      ".infocard .ic-body::-webkit-scrollbar{width:6px}.infocard .ic-body::-webkit-scrollbar-thumb{background:#3a4d73;border-radius:99px}"+
      ".ic-pin-wrap{background:transparent;border:0;pointer-events:none}"+
      ".ic-pin{width:22px;height:22px;box-sizing:border-box;border-radius:50%;background:#ff3b30;border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.5),0 2px 10px rgba(0,0,0,.7)}";
      document.head.appendChild(s);
    }
    function ensure(m){
      if(el&&mp===m) return;
      css(); mp=m;
      el=document.createElement("div"); el.className="infocard"; el.setAttribute("role","dialog"); el.setAttribute("aria-label","מה יש כאן");
      el.innerHTML='<div class="ic-head"><span class="ic-title"></span><button type="button" class="ic-x" aria-label="סגור">✕</button></div><div class="ic-body"></div>';
      titleEl=el.querySelector(".ic-title"); bodyEl=el.querySelector(".ic-body");
      el.querySelector(".ic-x").addEventListener("click",()=>hide());
      mp.getContainer().appendChild(el);
      L.DomEvent.disableClickPropagation(el);
      /* גלגלת מעל הכרטיס: לא מזיזה/מזממת את המפה ולא גוללת את הדף (גוללת רק את גוף הכרטיס כשיש מה לגלול) */
      el.addEventListener("wheel",ev=>{
        ev.stopPropagation();
        const b=bodyEl;
        if(!b.contains(ev.target)||b.scrollHeight<=b.clientHeight+1){ ev.preventDefault(); return; }
        if((b.scrollTop<=0&&ev.deltaY<0)||(b.scrollTop+b.clientHeight>=b.scrollHeight-1&&ev.deltaY>0)) ev.preventDefault();
      },{passive:false});
      /* פתיחת פריט: לא מאפסים גלילה; מוודאים שהפריט שנפתח נראה, ומציבים מחדש (הגובה השתנה) באותו צד */
      bodyEl.addEventListener("toggle",ev=>{
        const d=ev.target;
        if(d&&d.open&&d.tagName==="DETAILS"){
          const br=bodyEl.getBoundingClientRect(), sr=(d.querySelector("summary")||d).getBoundingClientRect(), dr=d.getBoundingClientRect();
          if(sr.top<br.top) bodyEl.scrollTop-=br.top-sr.top+4;
          else if(dr.bottom>br.bottom) bodyEl.scrollTop+=Math.min(dr.bottom-br.bottom+4,sr.top-br.top-4);
        }
        place({measure:true,keep:true});
      },true);
      if(!keyBound){ keyBound=true; document.addEventListener("keydown",ev=>{ if(ev.key==="Escape") hide(); }); }
      const sched=()=>{ if(raf||!anchor) return; raf=requestAnimationFrame(()=>{ raf=0; place({keep:true}); }); };
      mp.on("move zoomend",sched);
      window.addEventListener("scroll",sched,{passive:true});   // גלילת הדף משנה את החלק הגלוי של המפה
      mp.on("resize",()=>{
        if(!anchor) return;
        const sz=mp.getSize(), p=mp.latLngToContainerPoint(anchor);
        if(p.x<-4||p.y<-4||p.x>sz.x+4||p.y>sz.y+4) return hide();   /* אחרי סיבוב מסך הנקודה יצאה מהמפה — סוגרים */
        place({measure:true,keep:true});
      });
    }
    /* מלבנים אסורים (פקדים צפים) לפי קואורדינטות המכל; פס דק בתחתית (קרדיט המפה) נחשב שולי תחתון */
    function forbidden(sz){
      const rects=[], strips=[], c=mp.getContainer().getBoundingClientRect();
      (forbidFn?forbidFn():[]).forEach(n=>{
        if(!n) return; const r=n.getBoundingClientRect(); if(!(r.width>0&&r.height>0)) return;
        const q={l:r.left-c.left,t:r.top-c.top,r:r.right-c.left,b:r.bottom-c.top};
        if(q.b>=sz.y-6&&q.b-q.t<=34&&q.r-q.l>80) strips.push(q); else rects.push(q);
      });
      return {rects,strips};
    }
    /* מיקום: בוחרים את הצד הפנוי הטוב ביותר (מגירה תחתונה/עליונה, או עמודה בצד), כך שהכרטיס — גם בגובהו המרבי —
       לא מכסה את הנקודה שנלחצה (ריבוע ביטחון סביבה) ולא את הפקדים, ובתוך גבולות המפה. גובה הכרטיס מוגבל לשטח הפנוי (גלילה פנימית) */
    function place(o){
      o=o||{};
      if(!el||!anchor||!el.classList.contains("on")) return;
      const sz=mp.getSize(), W=sz.x, H=sz.y;
      if(!(W>0&&H>0)) return;
      const p=mp.latLngToContainerPoint(anchor), narrow=W<=760, SM=narrow?8:MARGIN;
      const fb=forbidden(sz), Mb=Math.max(MARGIN,fb.strips.reduce((m,s)=>Math.max(m,H-s.t+4),0)), E=touchMode?30:22;
      /* במחשב המפה יכולה להיחתך בתחתית המסך — הכרטיס מוצב רק בחלק הגלוי שלה */
      const cr=mp.getContainer().getBoundingClientRect(), vt=Math.max(0,-cr.top), vb=Math.min(H,window.innerHeight-cr.top), vis=vb-vt>=60;
      const x0=SM, x1=W-SM, y0=Math.max(MARGIN,vis?vt+MARGIN:0), y1=Math.min(H-Mb,vis?vb-MARGIN:H);
      const cw0=Math.max(160,narrow?x1-x0:Math.min(360,x1-x0));
      const st=bodyEl.scrollTop;   // המדידה (בלי הגבלת גובה) מאפסת גלילה — משחזרים בסוף
      if(o.measure||!natH){
        el.style.width=cw0+"px"; el.style.maxHeight="none"; el.style.left="0px"; el.style.top="0px"; el.style.right=el.style.bottom="auto";
        natH=el.offsetHeight;
      }
      const prefTB=Math.max(130,Math.round((vis?vb-vt:H)*0.42));                 /* בנייד: מגירה עד 42% מגובה המפה */
      const wantH=Math.max(60,Math.min(natH,narrow?prefTB:y1-y0));
      const minCap=Math.min(wantH,110);
      const boxes=[
        {s:"t",x0,y0,x1,y1:Math.min(y1,p.y-E)}, {s:"b",x0,y0:Math.max(y0,p.y+E),x1,y1},
        {s:"l",x0,y0,x1:Math.min(x1,p.x-E),y1}, {s:"r",x0:Math.max(x0,p.x+E),y0,x1,y1}
      ];
      const cands=[];
      boxes.forEach(b=>{
        const bw=b.x1-b.x0, bh=b.y1-b.y0;
        if(bw<120||bh<48) return;
        const tb=b.s==="t"||b.s==="b";
        const cw=Math.min(bw,tb&&narrow?bw:360);
        const capMax=Math.max(48,tb&&narrow?Math.min(bh,prefTB):bh);
        const xs=tb?(cw<bw-1?[{a:"l",x:b.x0},{a:"r",x:b.x1-cw}]:[{a:"c",x:b.x0}]):[{a:b.s,x:b.s==="l"?b.x0:b.x1-cw}];
        const tops=tb?[b.s==="t"]:[true,false];
        xs.forEach(xx=>tops.forEach(top=>{
          const c={s:b.s,a:xx.a,x:xx.x,cw,cap:Math.min(capMax,bh),top,edge:top?b.y0:b.y1,key:b.s+xx.a+(top?"T":"B")};
          cands.push(c);
        }));
      });
      /* מקצרים את הגובה המרבי כדי לא לחפוף פקדים; אם לא אפשר — המועמד פסול */
      cands.forEach(c=>{
        c.ok=true;
        for(let k=0;k<3&&c.ok;k++){
          const t=c.top?c.edge:c.edge-c.cap, b=c.top?c.edge+c.cap:c.edge;
          const f=fb.rects.find(f=>f.r>c.x-GAP&&f.l<c.x+c.cw+GAP&&f.b>t-GAP&&f.t<b+GAP);
          if(!f) break;
          const nc=c.top?f.t-GAP-c.edge:c.edge-(f.b+GAP);
          if(nc<48||(c.top&&f.t<=c.edge)||(!c.top&&f.b>=c.edge)){
            /* הפקד נוגע בקצה שאליו מעוגן הכרטיס (למשל כפתורי הזום בפינה, במחשב עם חלון צר): מצרים את הכרטיס הצידה כדי לפנות אותו */
            const left=(f.l+f.r)/2<c.x+c.cw/2, nx=left?f.r+GAP:c.x, nw=left?c.cw-(f.r+GAP-c.x):f.l-GAP-c.x;
            if(nw>=200&&nw<c.cw){ c.x=nx; c.cw=nw; continue; }
            c.ok=false;
          }else c.cap=nc;
        }
        const t=c.top?c.edge:c.edge-c.cap;
        c.eff=Math.min(c.cap,wantH)/wantH;
        const dist=Math.hypot(c.x+c.cw/2-p.x,t+c.cap/2-p.y);
        const tb=c.s==="t"||c.s==="b";
        c.good=c.ok&&c.cap>=minCap&&c.cw>=(tb?200:240);
        c.score=c.eff*100+Math.min(1,c.cw/cw0)*20+(narrow?{b:14,t:12,l:0,r:0}[c.s]:{l:8,r:8,t:3,b:3}[c.s])+dist/(W+H)*6+(o.keep&&c.key===lastKey?70:0);
      });
      const pick=a=>a.reduce((m,c)=>(!m||c.score>m.score)?c:m,null);
      let best=pick(cands.filter(c=>c.good))||pick(cands.filter(c=>c.ok))||pick(cands);
      if(!best){   /* מסך זעיר: פינה רחוקה מהנקודה, גובה מצומצם */
        const top=p.y>H/2;
        best={x:x0,cw:Math.max(120,x1-x0),cap:Math.max(48,Math.min(H-2*MARGIN,120)),top,edge:top?y0:y1,key:"fb"};
      }
      lastKey=best.key;
      el.style.width=best.cw+"px"; el.style.maxHeight=Math.floor(best.cap)+"px";
      el.style.left=best.x+"px"; el.style.right="auto";
      if(best.top){ el.style.top=best.edge+"px"; el.style.bottom="auto"; }
      else{ el.style.bottom=(H-best.edge)+"px"; el.style.top="auto"; }
      if(bodyEl.scrollTop!==st) bodyEl.scrollTop=st;
    }
    function setPin(ll){
      if(pin){ mp.removeLayer(pin); pin=null; }
      pin=L.marker(ll,{interactive:false,keyboard:false,zIndexOffset:1000,icon:L.divIcon({className:"ic-pin-wrap",html:'<div class="ic-pin"></div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(mp);
    }
    /* opts: {title, touch, forbid:()=>[nodes], onClose}; html: מחרוזת HTML מהימנה (כל מחרוזות הנתונים עברו esc) */
    function show(m,latlng,html,opts){
      ensure(m); opts=opts||{};
      anchor=latlng; forbidFn=opts.forbid||null; onClose=opts.onClose||null; touchMode=!!opts.touch; lastKey="";
      titleEl.textContent=opts.title||"";
      bodyEl.innerHTML=html; bodyEl.scrollTop=0;
      el.classList.add("on"); mp.getContainer().classList.add("pop-open");
      setPin(latlng);
      place({measure:true});
      return el;
    }
    function hide(){
      if(!el||!el.classList.contains("on")) return;
      el.classList.remove("on"); if(mp) mp.getContainer().classList.remove("pop-open");
      if(pin){ mp.removeLayer(pin); pin=null; }
      anchor=null; natH=0;
      const f=onClose; onClose=null; if(f) try{f();}catch(e){}
    }
    return {show,hide,place,isOpen:()=>!!(el&&el.classList.contains("on")),body:()=>bodyEl,anchor:()=>anchor,el:()=>el};
  })();
  window.InfoCard=InfoCard;

  /* ======================= שכבות פמ"ת / רט"ג ======================= */
  const KEYS={
    LLP:{label:"אסורים (LLP)",color:"#ff3b30"},
    LLR:{label:"מוגבלים (LLR)",color:"#ff9500"},
    LLD:{label:"מסוכנים (LLD)",color:"#2ec4b6"},
    LLU:{label:"אסורים לכטב״מ (LLU)",color:"#e8eefc"},
    OBS:{label:"בלונים מעוגנים",color:"#c9a227"},
    NR:{label:"שמורות טבע (רט״ג)",color:"#3ddc84"},
    NP:{label:"גנים לאומיים (רט״ג)",color:"#4da3ff"}
  };
  const VERSION="02.10.2026";
  const on=new Set(Object.keys(KEYS));
  const items=[];           // {key,d,ext,area,bounds,center,rings,bufRings,dot,poly,buf,col,bb,cx,cy,P,PB}
  const counts={};
  let ready=false, byArea=[];

  const COARSE=window.matchMedia("(pointer:coarse)").matches;
  const CAN_HOVER=window.matchMedia("(hover:hover) and (pointer:fine)").matches;
  const PX_POLY=12, PX_DOT=36;   // פוליגון מופיע מ-12px, והנקודה נעלמת כשהוא ≥36px (שטח קטן נשאר נגיש)
  const MAXN=40;                 // מקסימום פריטים בכרטיס
  /* קנבס אחד משותף לכל הצורות (גם נוט"מים מ-index.html): סדר הציור נקבע ב-reorder() ולא לפי סדר ההוספה */
  const REND=window.mapCanvas||L.canvas({padding:0.1});

  /* esc: כל מחרוזת נתונים שנכנסת ל-HTML עוברת כאן */
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const fmt=n=>/^\d+$/.test(n)?Number(n).toLocaleString("en-US"):n;
  function alt(v,unit){
    if(v==="UNL") return "ללא הגבלה";
    if(v==="GND"||v==="SFC") return "קרקע (GND)";
    if(v==="MSL/GND") return "קרקע/פני הים";
    if(v==="MSL") return "פני הים";
    if(/^\(-\)/.test(v)) return v.replace("(-)","מינוס ")+" רגל";
    return fmt(v)+" רגל"+(unit?" "+unit:" מעל פני הים");
  }
  /* קואורדינטות DMS בתוך טקסט עברי מתהפכות — עוטפים כל זוג ב-<bdi dir="ltr"> (שאר הטקסט עובר esc) */
  const COORD_RX=/\d{1,3}°\d{2}'\d{2}(?:\.\d+)?"[NS]\s?\d{1,3}°\d{2}'\d{2}(?:\.\d+)?"[EW]/g;
  function bidiHtml(s){
    s=String(s==null?"":s); let out="", i=0, m; COORD_RX.lastIndex=0;
    while((m=COORD_RX.exec(s))!==null){ out+=esc(s.slice(i,m.index))+'<bdi dir="ltr">'+esc(m[0])+'</bdi>'; i=m.index+m[0].length; }
    return out+esc(s.slice(i));
  }
  const plural=(n,one,many)=>n===1?one:n+" "+many;
  function bboxOf(rings){
    let a=90,b=180,c=-90,d=-180;
    rings.forEach(r=>r.forEach(p=>{if(p[0]<a)a=p[0];if(p[0]>c)c=p[0];if(p[1]<b)b=p[1];if(p[1]>d)d=p[1];}));
    return L.latLngBounds([a,b],[c,d]);
  }
  function mainRing(rings){ // הטבעת הגדולה — למיקום הנקודה
    let best=rings[0],ba=-1;
    rings.forEach(r=>{const b=bboxOf([r]);const a=(b.getNorth()-b.getSouth())*(b.getEast()-b.getWest());if(a>ba){ba=a;best=r;}});
    return bboxOf([best]).getCenter();
  }
  const mpp=(z,lat)=>156543.03392*Math.cos(lat*Math.PI/180)/Math.pow(2,z);   // מטר לפיקסל
  /* ---- היררכיה חזותית לפי זום: בזום נמוך (≤8) הכול קטן ושקט — נקודה קטנה לכל אתר, שמורות/גנים (מאות) עוד יותר קטנות ושקופות למחצה (שלא יקדמו על
     פני האיסורים), וכל זה גדל עם ההתקרבות עד הגודל המלא בזום ≥11. ההחלקה ליניארית בין זום 8 ל-11 (זום שלם בלבד, אז אין קפיצות באמצע תנועה) ---- */
  const isNat=k=>k==="NR"||k==="NP";
  const Z_LO=8, Z_HI=11;
  const zt=z=>Math.max(0,Math.min(1,(z-Z_LO)/(Z_HI-Z_LO)));
  const mix=(a,b,t)=>a+(b-a)*t;
  const dotRadius=(k,z)=>{ const t=zt(z); return isNat(k)?mix(2,COARSE?7:5,t):mix(3,COARSE?8:6,t); };
  /* נקודה: רדיוס, מסגרת כהה דקה (עבה רק בהתקרבות) ושקיפות (NR/NP בלבד) */
  const dotStyle=(k,z)=>{ const t=zt(z); return isNat(k)
    ?{radius:dotRadius(k,z),weight:mix(.6,1,t),fillOpacity:mix(.6,.95,t),opacity:mix(.6,1,t)}
    :{radius:dotRadius(k,z),weight:mix(1,1.5,t),fillOpacity:.95,opacity:1}; };
  /* פוליגון: אזורי רט"ג בזום נמוך — קו דק ומילוי עמום; האיסורים (פמ"ת) תמיד בעוצמה מלאה */
  const polyStyle=(k,z)=>{ const t=zt(z); return isNat(k)
    ?{weight:mix(1.2,2,t),opacity:mix(.7,1,t),fillOpacity:mix(.08,.16,t)}
    :{weight:2,opacity:1,fillOpacity:.16}; };
  /* מגבלת גודל מינימלי לציור פוליגון (בפיקסלים של הצד הארוך): בזום ≤8 צורה קטנה מ-16px (איסורים) / 24px (שמורות וגנים) נשארת נקודה בלבד —
     אחרת נקודה+קו מתאר עבה מתמזגים לכתם. בזום 9 — 12/18px, ומזום 10 — 12px כמו קודם. הנקודה נשארת תמיד עד PX_DOT, ולכן אין רגע שבו אתר "נעלם".
     זה ציור בלבד: בדיקות הפגיעה (collect) משתמשות בגיאומטריה המלאה ובקבועים PX_POLY/PX_DOT כמו קודם */
  const polyMin=(k,z)=>z>=10?PX_POLY:isNat(k)?(z<=8?24:18):(z<=8?16:PX_POLY);

  /* ---- מרקטור יחידתי (0..1) — בדיקות פגיעה מדויקות בפיקסלים, בלי תלות בצורות המצוירות/המפושטות ---- */
  const DEG=Math.PI/180;
  const mx=lng=>(lng+180)/360;
  const my=lat=>{ const s=Math.sin(Math.max(-85.0511,Math.min(85.0511,lat))*DEG); return 0.5-Math.log((1+s)/(1-s))/(4*Math.PI); };
  function prep(rings){
    return rings.map(r=>{ const a=new Float64Array(r.length*2); for(let i=0;i<r.length;i++){ a[2*i]=mx(r[i][1]); a[2*i+1]=my(r[i][0]); } return a; });
  }
  /* even-odd (כמו המילוי של Leaflet) + מרחק מינימלי לקצה בפיקסלים; S = גודל העולם בפיקסלים בזום הנוכחי */
  function ringsTest(P,px,py,S,wantDist){
    let inside=false, d=Infinity;
    for(const a of P){
      const n=a.length/2;
      let xj=a[2*(n-1)]*S, yj=a[2*(n-1)+1]*S;
      for(let i=0;i<n;i++){
        const xi=a[2*i]*S, yi=a[2*i+1]*S;
        if((yi>py)!==(yj>py)&&px<(xj-xi)*(py-yi)/(yj-yi)+xi) inside=!inside;
        if(wantDist){
          const dx=xj-xi, dy=yj-yi, l=dx*dx+dy*dy;
          let t=l?((px-xi)*dx+(py-yi)*dy)/l:0; t=t<0?0:t>1?1:t;
          const q=Math.hypot(px-(xi+t*dx),py-(yi+t*dy)); if(q<d) d=q;
        }
        xj=xi; yj=yi;
      }
    }
    return {inside,d};
  }

  /* ---- תוכן הכרטיס לאזור קבוע (בלי כותרת — היא נבנית לפי מספר הפריטים) ---- */
  function bodyHtml(it){
    const z=it.d;
    let rows="";
    if(z.src==="pmt"){
      const unit=z.maxunit==="AGL"?"מעל פני הקרקע":"", r=Number(z.r);
      rows='<div class="pp-meta">גובה: מ־'+esc(alt(z.min))+' ועד '+esc(alt(z.max,unit))+(r>0?' · רדיוס '+(r>=1000?(r/1000).toFixed(r%1000?2:0).replace(/\.?0+$/,"")+' ק״מ':r+' מ׳'):'')+'</div>';
    }else{
      rows='<div class="pp-meta">סגור להטסה: מהקרקע ועד '+esc(alt(z.max,"מעפ״ש"))+(it.key==="NR"?' · קו מקווקו = 150 מ׳ מגבול השמורה':'')+'</div>';
    }
    const note=z.note?'<div class="pp-heb">'+esc(z.note)+'</div>':"";
    const nb=z.nb?'<div class="approx-note" style="margin-top:6px">'+esc(z.nb)+'</div>':"";
    let inpa="";
    if(z.src==="inpa"){
      inpa='<div class="pp-meta"><b>כללי רט״ג:</b> גובה מזערי להטסה — בשמורות טבע 300 רגל מעפ״ש (ו-150 מ׳ מגבול השמורה), בגנים לאומיים 500 רגל מעפ״ש. '+
        'אסור נחיתה והמראה. אפשר לבקש חריגה: '+
        '<a href="https://www.parks.org.il/article/tisa/" target="_blank" rel="noopener" style="color:var(--cyan)">טופס בקשה לחריגה</a>.</div>';
    }
    return rows+note+nb+inpa+'<div class="pp-meta" style="margin-top:8px">מקור: '+esc(z.edition)+'</div>';
  }
  function add(key,z){
    const rings=z.rings; if(!rings||!rings.length) return;
    const bounds=bboxOf(rings), center=z.c?L.latLng(z.c[0],z.c[1]):mainRing(rings), col=KEYS[key].color;
    const h=(bounds.getNorth()-bounds.getSouth())*111320, w=(bounds.getEast()-bounds.getWest())*111320*Math.cos(center.lat*Math.PI/180);
    const it={key,d:z,ext:Math.max(h,w),area:h*w,bounds,center,rings,bufRings:z.buf||null,dot:null,poly:null,buf:null,col,dz:null,pz:null,
      bb:[mx(bounds.getWest()),my(bounds.getNorth()),mx(bounds.getEast()),my(bounds.getSouth())],cx:mx(center.lng),cy:my(center.lat),P:null,PB:null};
    it.dot=L.circleMarker(center,{renderer:REND,color:"#0b1220",fillColor:col,interactive:false,...dotStyle(key,8)});
    items.push(it); counts[key]=(counts[key]||0)+1;
  }
  /* גרסה מפושטת של הטבעות (סטייה עד ~120 מ' = פחות מפיקסל בזום ≤10): מורידה ~75% מהנקודות שמוקרנות ומצוירות בכל תזוזה/זום ארצי.
     בדיקות הפגיעה תמיד משתמשות בטבעות המלאות */
  const LOW_Z=10;
  function simplify(r,tol){
    const c=Math.cos(r[0][0]*DEG), n=r.length; if(n<8) return r;
    /* צורות צרות (רצועות חוף וכד'): רוחב ממוצע = 2·שטח/היקף; מתחת ל-800 מ' לא מפשטים — אחרת הרצועה עלולה להתכווץ לקו */
    let A=0,P=0;
    for(let i=0,j=n-1;i<n;j=i++){ const x1=r[i][1]*c*111320,y1=r[i][0]*111320,x2=r[j][1]*c*111320,y2=r[j][0]*111320; A+=x2*y1-x1*y2; P+=Math.hypot(x1-x2,y1-y2); }
    if(P<=0||Math.abs(A)/P<800) return r;
    const keep=new Uint8Array(n); keep[0]=keep[n-1]=1;
    const st=[[0,n-1]];
    while(st.length){
      const [a,b]=st.pop(), ax=r[a][1]*c, ay=r[a][0], dx=r[b][1]*c-ax, dy=r[b][0]-ay, l=dx*dx+dy*dy;
      let md=-1, mi=-1;
      for(let k=a+1;k<b;k++){
        const px=r[k][1]*c-ax, py=r[k][0]-ay;
        const t=l?Math.max(0,Math.min(1,(px*dx+py*dy)/l)):0, d=Math.hypot(px-t*dx,py-t*dy);
        if(d>md){ md=d; mi=k; }
      }
      if(md>tol){ keep[mi]=1; st.push([a,mi],[mi,b]); }
    }
    const out=[]; for(let i=0;i<n;i++) if(keep[i]) out.push(r[i]);
    return out.length>=4?out:r;
  }
  const lowRings=it=>it.low||(it.low=it.rings.map(r=>simplify(r,120/111320)));
  function build(it,z){
    /* אתרים קטנים וצרים לא מפושטים (smoothFactor נמוך) כדי שהצורה שלהם נשארת שלמה גם בזום ארצי */
    const sf=it.ext>30000?1.5:0.4;
    it.polyLow=z<=LOW_Z;
    it.pz=z;
    it.poly=L.polygon(it.polyLow?lowRings(it):it.rings,{renderer:REND,color:it.col,fillColor:it.col,smoothFactor:sf,interactive:false,...polyStyle(it.key,z)});
    if(it.bufRings) it.buf=L.polygon(it.bufRings,{renderer:REND,color:it.col,weight:1.4,dashArray:"5 5",fill:false,smoothFactor:sf,interactive:false});
  }
  function rm(l){ if(l&&map.hasLayer(l)) map.removeLayer(l); }
  /* סדר ציור (למטה→למעלה): נוט"ם משוער < שמורות/גנים < פמ"ת < נוט"ם מדויק < נקודות שמורות/גנים < נקודות LLP/LLR/LLD/LLU/בלונים (האיסורים תמיד מעל הרקע של רט"ג);
     בכל קבוצה גדולים למטה וקטנים מעל. קנבס יחיד, ולכן הסדר נקבע כאן ב-bringToFront (גם נוט"מים מ-index.html) */
  function reorder(){
    const seq=[], area=l=>l._area||0, approx=[], exact=[];
    (typeof window.notamLayers==="function"?window.notamLayers():[]).forEach(x=>{ (x.item.parsed&&x.item.parsed.approx?approx:exact).push(x.layer); });
    approx.sort((a,b)=>area(b)-area(a)).forEach(l=>seq.push(l));
    [true,false].forEach(nat=>byArea.forEach(it=>{ if(isNat(it.key)===nat){ seq.push(it.poly); seq.push(it.buf); } }));
    exact.sort((a,b)=>area(b)-area(a)).forEach(l=>seq.push(l));
    [true,false].forEach(nat=>items.forEach(it=>{ if(isNat(it.key)===nat) seq.push(it.dot); }));
    seq.forEach(l=>{ if(l&&map.hasLayer(l)) l.bringToFront(); });
  }
  window.pmtReorder=reorder;
  function update(){
    if(!ready) return;
    const z=map.getZoom(), view=map.getBounds().pad(0.12);   // רק מה שהקנבס (padding 0.1) באמת מצייר
    let added=false;
    const ad=l=>{ if(l&&!map.hasLayer(l)){ l.addTo(map); added=true; } };
    items.forEach(it=>{
      if(!on.has(it.key)||!view.intersects(it.bounds)){ rm(it.dot);rm(it.poly);rm(it.buf); return; }
      const px=it.ext/mpp(z,it.center.lat);
      if(px>=polyMin(it.key,z)){
        if(!it.poly) build(it,z);
        else{
          if(it.polyLow!==(z<=LOW_Z)){ it.polyLow=z<=LOW_Z; it.poly.setLatLngs(it.polyLow?lowRings(it):it.rings); }
          if(it.pz!==z){ it.pz=z; it.poly.setStyle(polyStyle(it.key,z)); }
        }
        ad(it.poly);
      }else rm(it.poly);
      if(px<PX_DOT){ if(it.dz!==z){ it.dz=z; it.dot.setStyle(dotStyle(it.key,z)); } ad(it.dot); }else rm(it.dot);
      if(it.buf&&z>=11&&px>=PX_POLY) ad(it.buf); else rm(it.buf);   // קווי חיץ 150 מ' — רק מזום 11 ובתוך הפריים
    });
    if(added) reorder();
  }
  map.on("moveend",update);

  /* ---- "מה יש כאן": כל מה שחל בנקודה — אזורים קבועים (פוליגון שמכיל / קרוב עד 10px, במגע 16px), נוט"מים, נוט"ם משוער אחרון ---- */
  /* דירוג בתוך קבוצה: 0 = נקודה שנלחצה (נקודת האתר בקרבת האצבע/העכבר, הקרובה ראשונה) · 1 = האזור מכיל את הנקודה (קטן לפני גדול) · 2 = קרוב בלבד */
  const cmp=(a,b)=>(a.group-b.group)||(a.rank-b.rank)||(a.rank===1?a.area-b.area:a.dist-b.dist);
  function collect(ll,touch,focus){
    const R=touch?16:10, z=map.getZoom(), S=256*Math.pow(2,z), cx=mx(ll.lng), cy=my(ll.lat), px=cx*S, py=cy*S, tu=R/S, out=[];
    items.forEach(it=>{
      if(!on.has(it.key)) return;
      const ext=it.ext/mpp(z,it.center.lat);
      const dDot=ext<PX_DOT?Math.hypot((cx-it.cx)*S,(cy-it.cy)*S):Infinity;
      const bb=it.bb, nearBox=!(cx<bb[0]-tu||cx>bb[2]+tu||cy<bb[1]-tu||cy>bb[3]+tu);
      let inside=false, dEdge=Infinity, inBuf=false;
      if(nearBox){
        if(!it.P) it.P=prep(it.rings);
        const r=ringsTest(it.P,px,py,S,true); inside=r.inside; dEdge=inside?0:r.d;
        if(!inside&&it.bufRings&&z>=11&&ext>=PX_POLY){ if(!it.PB) it.PB=prep(it.bufRings); inBuf=ringsTest(it.PB,px,py,S,false).inside; }
      }
      const dNear=Math.min(dEdge,dDot);
      if(!(inside||inBuf||dNear<=R)) return;
      const near=!inside&&!inBuf;
      out.push({id:it.d.id,name:it.d.name,color:it.col,tag:KEYS[it.key].label,group:0,area:it.area,near,inBuf,approx:false,
        rank:dDot<=R?0:(inside||inBuf)?1:2,dist:near?dNear:dDot,body:()=>bodyHtml(it)});
    });
    if(typeof window.notamStackEntries==="function") window.notamStackEntries(map.latLngToLayerPoint(ll),R).forEach(e=>out.push(e));
    if(focus&&!out.some(e=>e.id===focus)&&typeof window.notamEntryById==="function"){ const e=window.notamEntryById(focus); if(e) out.push(e); }
    out.sort(cmp);
    if(focus){ const i=out.findIndex(e=>e.id===focus); if(i>0) out.unshift(out.splice(i,1)[0]); }
    return out;
  }
  function badges(e){
    return '<span class="badge" style="color:'+e.color+';border-color:currentColor">'+esc(e.tag)+'</span>'+
      (e.approx?' <span class="badge appr">מיקום משוער</span>':'')+
      (e.near?' <span class="badge appr">בקרבת הנקודה</span>':'')+
      (e.inBuf?' <span class="badge appr">ברצועת 150 מ׳ מהגבול</span>':'');
  }
  function cardHtml(list,focus){
    if(list.length===1){
      const e=list[0];
      return '<div class="stk"><span class="pp-id" style="color:'+e.color+'">'+esc(e.id)+'</span> '+badges(e)+e.body()+'</div>';
    }
    const open=focus?list.findIndex(e=>e.id===focus):0;
    return '<div class="stk">'+list.map((e,i)=>'<details class="stk-it"'+(i===(open<0?0:open)?' open':'')+'><summary><span class="pp-id" style="color:'+e.color+'">'+esc(e.id)+'</span> · <span class="stk-nm">'+esc(e.name)+'</span> '+badges(e)+'</summary>'+e.body()+'</details>').join("")+'</div>';
  }
  /* פקדים שהכרטיס לא יכסה: כפתורי זום וקרדיט המפה (מקרא צף אין במפה הזו; מגירת הסינון סוגרת את הכרטיס) */
  const forbidNodes=()=>Array.from(map.getContainer().querySelectorAll(".leaflet-control-zoom,.leaflet-control-attribution,.leaflet-control-layers"));
  const cardClosed=()=>{ if(typeof clearSelected==="function") clearSelected(); };
  /* opts: {touch, focus, heading, intro, allowEmpty, keepSelection} — מחזיר true אם נפתח כרטיס */
  function openStack(ll,opts){
    opts=opts||{};
    if(!map||!ll||map._animatingZoom) return false;
    const touch=opts.touch==null?COARSE:!!opts.touch;
    const all=collect(ll,touch,opts.focus);
    if(!all.length&&!opts.allowEmpty) return false;
    const list=all.slice(0,MAXN), more=all.length-list.length;
    let html=opts.intro||"";
    if(list.length) html+=cardHtml(list,opts.focus);
    else html+='<div class="pp-meta">אין אזורים או נוט״מים שחלים בנקודה זו (בשכבות המסומנות). אין בכך אישור טיסה — יש לבדוק במקורות הרשמיים.</div>';
    if(more>0) html+='<div class="pp-meta">ועוד '+more+' — התקרבו כדי לראות אותם.</div>';
    const cnt=list.length?" — "+plural(all.length,"אזור אחד","אזורים"):"";
    const title=opts.heading?opts.heading+cnt:list.length===1?list[0].name:"מה יש כאן"+cnt;
    InfoCard.show(map,ll,html,{title:title,touch,forbid:forbidNodes,onClose:()=>{ cardClosed(); }});
    return true;
  }
  window.pmtOpenStack=openStack;
  map.on("click",e=>{
    if(typeof window.pmtClickGuard==="function"&&window.pmtClickGuard(e)) return;   // מגירת סינון פתוחה: ההקשה רק סוגרת אותה
    if(map._animatingZoom) return;
    const oe=e.originalEvent, pt=oe&&oe.pointerType;
    if(typeof clearSelected==="function") clearSelected();
    if(!openStack(e.latlng,{touch:pt?pt!=="mouse":COARSE})) InfoCard.hide();   // נקודה ריקה: סוגרת ולא מזיזה כלום
  });

  /* ---- שם בריחוף (מחשב בלבד): מאזין אחד על המפה, throttle, וטולטיפ יחיד לאזור העליון בנקודה ---- */
  if(CAN_HOVER){
    const tip=L.tooltip({direction:"top",offset:[0,-10],opacity:.97,className:"hover-tip"});
    const box=map.getContainer();
    let last=0,tmr=0,pend=null,lastKey="";
    const hide=()=>{ if(map.hasLayer(tip)) map.removeLayer(tip); lastKey=""; box.classList.remove("hit"); };
    const stop=()=>{ clearTimeout(tmr); tmr=0; pend=null; hide(); };   // מנקים גם טיימר ממתין — אחרת הטולטיפ נתקע מעל הכרטיס/הפקדים
    const run=e=>{
      if(map._animatingZoom||(map.dragging&&map.dragging.moving())) return hide();
      const t=e.originalEvent&&e.originalEvent.target;
      if(t&&t.closest&&t.closest(".infocard,.leaflet-control")) return hide();
      const a=InfoCard.anchor();   // ליד עוגן הכרטיס הפתוח לא מציגים טולטיפ (הכרטיס כבר מציג את אותו מידע)
      if(a&&map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(e.latlng))<30) return hide();
      const list=collect(e.latlng,false);
      if(!list.length) return hide();
      const top=list[0], key=top.id+"|"+list.length;
      if(key!==lastKey){
        lastKey=key;
        tip.setContent('<b style="color:'+top.color+'">'+esc(top.name)+'</b> · <span class="mono">'+esc(top.id)+'</span>'+(list.length>1?' <span class="tip-more">+'+(list.length-1)+'</span>':''));
      }
      tip.setLatLng(e.latlng); if(!map.hasLayer(tip)) tip.addTo(map);
      box.classList.add("hit");
    };
    map.on("mousemove",e=>{
      const t=e.originalEvent&&e.originalEvent.target;
      if(t&&t.closest&&t.closest(".infocard,.leaflet-control")){ stop(); return; }
      pend=e; if(tmr) return;
      tmr=setTimeout(()=>{ tmr=0; last=performance.now(); if(pend) run(pend); },Math.max(0,60-(performance.now()-last)));
    });
    map.on("mouseout movestart zoomstart click",stop);
  }

  /* ---- כפתורי סינון: מתווספים לסרגל הקטגוריות הקיים ---- */
  function pmtBar(){
    if(!ready) return;
    const bar=document.getElementById("catBar"); if(!bar) return;
    const sep=document.createElement("div");
    sep.className="pmt-sep"; sep.innerHTML='<span class="sep-long">איסורים קבועים — פמ״ת א-17 ורשות הטבע והגנים (נקודה = אזור; התקרבו לראות את האזור המלא)</span><span class="sep-short">איסורים קבועים — פמ״ת ורט״ג</span>';
    bar.appendChild(sep);
    Object.keys(KEYS).forEach(k=>{
      if(!counts[k]) return;
      const c=KEYS[k], b=document.createElement("div");
      b.className="catbtn"+(on.has(k)?" on":""); b.style.color=on.has(k)?c.color:"";
      b.innerHTML='<span class="cdot" style="background:'+c.color+'"></span>'+c.label+' <span class="cnt">('+counts[k]+')</span>';
      b.onclick=()=>{ on.has(k)?on.delete(k):on.add(k); update(); b.className="catbtn"+(on.has(k)?" on":""); b.style.color=on.has(k)?c.color:""; if(typeof updateFilterCount==="function") updateFilterCount(); };
      bar.appendChild(b);
    });
    if(typeof updateFilterCount==="function") updateFilterCount();
  }
  if(typeof renderCatBar==="function"){
    const orig=renderCatBar;
    renderCatBar=function(){ orig.apply(this,arguments); pmtBar(); };
  }
  /* סופר גם את שכבות הפמ"ת/רט"ג במונה הסינון: {on, total} */
  window.pmtLayerCount=()=>({on:Object.keys(KEYS).filter(k=>counts[k]&&on.has(k)).length,total:Object.keys(KEYS).filter(k=>counts[k]).length});

  /* ---- רשימה: אזורים שמופיעים בפמ״ת ללא קואורדינטות ---- */
  function unmappedBox(pmt,inpa){
    const f=document.querySelector("footer"); if(!f) return;
    const d=document.createElement("details"); d.style.cssText="max-width:900px;margin:0 auto 14px;text-align:right";
    const li=a=>a.map(x=>'<span style="display:inline-block;margin:2px 10px 2px 0">'+esc(x.id)+' · '+esc(x.name)+'</span>').join("");
    d.innerHTML='<summary style="cursor:pointer;color:var(--amber);font-weight:700">אזורים הרשומים בפמ״ת ואינם מוצגים במפה (אין להם קואורדינטות/גבולות בפמ״ת או בקובצי רט״ג)</summary>'+
      '<div style="margin-top:8px;line-height:1.7"><b>שטחי אש — הקואורדינטות מפורטות בפרק ENR 5.1 ב-AIP ולא בפמ״ת:</b><br>'+li(pmt.nocoord)+
      '<br><br><b>אתרי טבע (נספח ה\') ללא גבולות זמינים ('+inpa.unmapped.length+'):</b><br>'+li(inpa.unmapped)+
      '<br><br><b>מגבלות קרבה לגבול (סעיף 4 בפמ״ת):</b> אין טיסה בכל גובה ומרחק של פחות מ-6 ק״מ מגבול רצועת עזה (LLP19), 3 ק״מ מגבול מצרים, 6 ק״מ מגבול סוריה ו-3 ק״מ מגבול לבנון; ניתן לטוס עד גבול ירדן; וצפונית לקו הרוחב 33°00\'00"N (קו שבי-ציון–ראש פינה) אלא באישור מתאים. קווי הגבול עצמם אינם מצוירים.</div>';
    f.insertBefore(d,f.firstChild);
  }

  const getJson=u=>fetch(u).then(r=>{ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); });
  Promise.all([getJson("data/pmt-zones.json?v="+BUILD),getJson("data/inpa-zones.json?v="+BUILD)]).then(([pmt,inpa])=>{
    pmt.zones.forEach(z=>{z.src="pmt";z.edition=pmt.edition;add(z.cat,z);});
    inpa.sites.forEach(z=>{z.src="inpa";z.edition=inpa.edition;add(z.kind==="P"?"NP":"NR",z);});
    byArea=items.slice().sort((a,b)=>b.area-a.area);
    ready=true; update(); unmappedBox(pmt,inpa);
    if(typeof renderCatBar==="function") renderCatBar();
    const sub=document.querySelector(".brand .sub");
    if(sub) sub.appendChild(document.createTextNode(" · גרסת שכבות פמ״ת "+VERSION));
  }).catch(err=>{
    /* מציג את התקלה במקום להיכשל בשקט — כדי שאפשר יהיה לראות מה קרה בטלפון */
    const bar=document.getElementById("catBar");
    const box=document.createElement("div"); box.className="pmt-sep"; box.style.color="var(--amber)";
    box.textContent="⚠ שכבות הפמ״ת לא נטענו ("+((err&&err.message)||"שגיאה")+"). נסו לרענן; אם זה חוזר — שלחו צילום מסך. ";
    const rb=document.createElement("button"); rb.type="button"; rb.textContent="נסה שוב"; rb.onclick=()=>location.reload(); box.appendChild(rb);
    (bar&&bar.parentNode?bar.parentNode:document.body).insertBefore(box,bar||null);
  });
})();
