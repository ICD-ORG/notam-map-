/* שכבות איסורים קבועים — פמ״ת פנים ארצי א-17 (עדכון 1/26) + גבולות רשות הטבע והגנים
   נקודה צבעונית לכל אזור; בהתקרבות מופיע האזור המלא כפוליגון שקוף.
   לחיצה על המפה פותחת חלון "מה יש כאן" אחד — כל האזורים והנוט"מים שחלים בנקודה (חלון חופשי, לא קשור לשכבה).
   נתונים: data/pmt-zones.json , data/inpa-zones.json */
(function(){
  if(typeof map==="undefined"||!map||typeof L==="undefined") return;

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
  const items=[];           // {key,d,ext,area,bounds,center,rings,bufRings,dot,poly,buf,col}
  const counts={};
  let ready=false, byArea=[];

  const COARSE=window.matchMedia("(pointer:coarse)").matches;
  const CAN_HOVER=window.matchMedia("(hover:hover) and (pointer:fine)").matches;
  const PX_POLY=12, PX_DOT=36;   // פוליגון מופיע מ-12px, והנקודה נעלמת כשהוא ≥36px (שטח קטן נשאר נגיש)
  const MAXN=40, CHROME=33;      // מקסימום פריטים בחלון; שוליים+מסגרת של חלון Leaflet (רוחב תוכן + CHROME = רוחב החלון)

  /* סדר ציור קבוע (לא תלוי בסדר הטעינה): נוט"ם משוער < פמ"ת < שמורות/גנים < נוט"ם מדויק < נקודות */
  const mkPane=(n,z)=>{ const p=map.getPane(n)||map.createPane(n); p.style.zIndex=z; };
  mkPane("pmtPane",350); mkPane("inpaPane",360); mkPane("pmtDotPane",390);
  const tol=COARSE?8:4;
  const rendPmt=L.canvas({pane:"pmtPane",padding:0.4,tolerance:tol});
  const rendInpa=L.canvas({pane:"inpaPane",padding:0.4,tolerance:tol});
  const rendDot=L.canvas({pane:"pmtDotPane",padding:0.4});

  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const fmt=n=>/^\d+$/.test(n)?Number(n).toLocaleString("en-US"):n;
  function alt(v,unit){
    if(v==="UNL") return "ללא הגבלה";
    if(v==="GND"||v==="SFC") return "קרקע (GND)";
    if(v==="MSL/GND") return "קרקע/פני הים";
    if(v==="MSL") return "פני הים";
    if(/^\(-\)/.test(v)) return v.replace("(-)","מינוס ")+" רגל";
    return fmt(v)+" רגל"+(unit?" "+unit:" מעל פני הים");
  }
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
  const dotRadius=z=>COARSE?(z<=8?5:z===9?6:8):(z<=8?4:z===9?5:6);            // נקודות קטנות יותר בזום נמוך — פחות בלגן

  /* ---- תוכן החלון לאזור קבוע (בלי כותרת — היא נבנית לפי מספר הפריטים) ---- */
  function bodyHtml(it){
    const z=it.d;
    let rows="";
    if(z.src==="pmt"){
      const unit=z.maxunit==="AGL"?"מעל פני הקרקע":"";
      rows='<div class="pp-meta">גובה: מ־'+alt(z.min)+' ועד '+alt(z.max,unit)+(z.r?' · רדיוס '+(z.r>=1000?(z.r/1000).toFixed(z.r%1000?2:0).replace(/\.?0+$/,"")+' ק״מ':z.r+' מ׳'):'')+'</div>';
    }else{
      rows='<div class="pp-meta">סגור להטסה: מהקרקע ועד '+alt(z.max,"מעפ״ש")+(it.key==="NR"?' · קו מקווקו = 150 מ׳ מגבול השמורה':'')+'</div>';
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
    const it={key,d:z,ext:Math.max(h,w),area:h*w,bounds,center,rings,bufRings:z.buf||null,dot:null,poly:null,buf:null,col};
    it.dot=L.circleMarker(center,{renderer:rendDot,radius:dotRadius(8),color:"#0b1220",weight:1.5,fillColor:col,fillOpacity:.95,interactive:false});
    items.push(it); counts[key]=(counts[key]||0)+1;
  }
  function build(it){
    const rend=(it.key==="NR"||it.key==="NP")?rendInpa:rendPmt;
    it.poly=L.polygon(it.rings,{renderer:rend,color:it.col,weight:2,fillColor:it.col,fillOpacity:.16,smoothFactor:2,interactive:false});
    if(it.bufRings) it.buf=L.polygon(it.bufRings,{renderer:rend,color:it.col,weight:1.4,dashArray:"5 5",fill:false,smoothFactor:2,interactive:false});
  }
  function rm(l){ if(l&&map.hasLayer(l)) map.removeLayer(l); }
  function ad(l){ if(l&&!map.hasLayer(l)) l.addTo(map); }
  /* קטנים מעל גדולים: אחרי הוספת פוליגונים מסדרים מחדש לפי שטח יורד (ללא מחיקה והוספה) */
  function reorder(){
    byArea.forEach(it=>{ if(it.poly&&map.hasLayer(it.poly)) it.poly.bringToFront(); });
  }
  function update(){
    if(!ready) return;
    const z=map.getZoom(), view=map.getBounds().pad(0.25), r=dotRadius(z);
    let added=false;
    items.forEach(it=>{
      if(!on.has(it.key)||!view.intersects(it.bounds)){ rm(it.dot);rm(it.poly);rm(it.buf); return; }
      const px=it.ext/mpp(z,it.center.lat);
      if(px>=PX_POLY){
        if(!it.poly) build(it);
        if(!map.hasLayer(it.poly)){ it.poly.addTo(map); added=true; }
      }else rm(it.poly);
      if(px<PX_DOT){ if(it.dot.options.radius!==r) it.dot.setRadius(r); ad(it.dot); }else rm(it.dot);
      if(it.buf&&z>=11&&px>=PX_POLY) ad(it.buf); else rm(it.buf);   // קווי חיץ 150 מ' — רק מזום 11 ובתוך הפריים
    });
    if(added) reorder();
  }
  map.on("moveend",update);

  /* ---- "מה יש כאן": כל מה שחל בנקודה — אזורים קבועים (פוליגון שמכיל / נקודה קרובה), נוט"מים, נוט"ם משוער אחרון ---- */
  const cmp=(a,b)=>(a.group-b.group)||((a.dot?1:0)-(b.dot?1:0))||(a.dot?a.dist-b.dist:a.area-b.area);
  function collect(ll,touch,focus){
    const pt=map.latLngToLayerPoint(ll), R=touch?20:12, out=[];
    items.forEach(it=>{
      if(!on.has(it.key)) return;
      let hit=false, isDot=false, dist=0;
      try{
        if(it.poly&&map.hasLayer(it.poly)) hit=it.poly._containsPoint(pt)||(it.buf&&map.hasLayer(it.buf)&&it.buf._containsPoint(pt));
        if(!hit){   // קרבה לנקודת האזור (גם כשהפוליגון כבר מוצג — מרכז הצורה לא תמיד בתוכה)
          const dp=(it.dot&&map.hasLayer(it.dot)&&it.dot._point)||(it.poly&&map.hasLayer(it.poly)?map.latLngToLayerPoint(it.center):null);
          if(dp){ dist=pt.distanceTo(dp); if(dist<=R){ hit=true; isDot=true; } }
        }
      }catch(e){ hit=false; }
      if(!hit) return;
      out.push({id:it.d.id,name:it.d.name,color:it.col,tag:KEYS[it.key].label,group:0,area:it.area,dist,dot:isDot,approx:false,body:()=>bodyHtml(it)});
    });
    if(typeof window.notamStackEntries==="function") window.notamStackEntries(pt).forEach(e=>out.push(e));
    if(focus&&!out.some(e=>e.id===focus)&&typeof window.notamEntryById==="function"){ const e=window.notamEntryById(focus); if(e) out.push(e); }
    out.sort(cmp);
    if(focus){ const i=out.findIndex(e=>e.id===focus); if(i>0) out.unshift(out.splice(i,1)[0]); }
    return out;
  }
  function badges(e){
    return '<span class="badge" style="color:'+e.color+';border-color:currentColor">'+esc(e.tag)+'</span>'+
      (e.approx?' <span class="badge appr">מיקום משוער</span>':'');
  }
  function stackEl(list,more,focus){
    const el=document.createElement("div"); el.className="stk";
    if(list.length===1){
      const e=list[0];
      el.innerHTML='<div class="pp-name stk-top">'+esc(e.name)+'</div><span class="pp-id" style="color:'+e.color+'">'+esc(e.id)+'</span> '+badges(e)+e.body();
      return el;
    }
    const open=focus?list.findIndex(e=>e.id===focus):0;
    el.innerHTML='<div class="stk-head stk-top">מה יש כאן — '+list.length+(more?'+':'')+' אזורים</div>'+
      list.map((e,i)=>'<details class="stk-it"'+(i===(open<0?0:open)?' open':'')+'><summary><span class="pp-id" style="color:'+e.color+'">'+esc(e.id)+'</span> · <span class="stk-nm">'+esc(e.name)+'</span> '+badges(e)+'</summary>'+e.body()+'</details>').join("")+
      (more?'<div class="pp-meta">ועוד '+more+' — התקרבו כדי לראות אותם.</div>':'');
    return el;
  }
  /* חלון חופשי (לא bindPopup): מוצב בתוך גבולות המפה בלי להזיז אותה אופקית; autoPan של Leaflet רק אם הגובה לא נכנס */
  function openStack(ll,opts){
    opts=opts||{};
    if(!map||!ll||map._animatingZoom) return false;
    const touch=opts.touch==null?COARSE:!!opts.touch;
    const all=collect(ll,touch,opts.focus);
    if(!all.length) return false;
    const list=all.slice(0,MAXN), el=stackEl(list,all.length-list.length,opts.focus);
    const size=map.getSize(), ax=map.latLngToContainerPoint(ll).x;
    const padL=COARSE?12:50, padR=12;      // במחשב: מקום לכפתורי הזום בפינה השמאלית העליונה
    const W=Math.max(200,Math.min(340,size.x-padL-padR-CHROME)), Wt=W+CHROME;
    let lo=Math.max(padL,ax+24-Wt), hi=Math.min(size.x-padR-Wt,ax-24);
    if(lo>hi){ lo=ax+24-Wt; hi=ax-24; }
    const dx=Math.min(hi,Math.max(lo,ax-Wt/2))-(ax-Wt/2);
    /* החלק הגלוי של המפה במסך (במחשב נמוך המפה יכולה להיחתך בתחתית הדף) */
    const mr=map.getContainer().getBoundingClientRect(), vTop=Math.max(0,-mr.top), vBot=Math.min(size.y,window.innerHeight-mr.top);
    const maxH=Math.max(140,Math.min(Math.round(window.innerHeight*0.5),Math.round((vBot-vTop)*0.55)));   // עד חצי מגובה המסך, גלילה פנימית
    const pop=L.popup({className:"stk-popup",minWidth:W,maxWidth:W,maxHeight:maxH,offset:L.point(dx,7),autoPan:false,
      autoPanPaddingTopLeft:[8,12+vTop],autoPanPaddingBottomRight:[8,24+(size.y-vBot)],closeOnClick:true}).setLatLng(ll).setContent(el);
    pop.openOn(map);
    const c=pop.getElement();
    if(c){
      const t=c.querySelector(".leaflet-popup-tip-container"); if(t) t.style.left=(c.offsetWidth/2-dx)+"px";
      /* ברירת מחדל: החלון נפתח מעל הנקודה. אם למעלה אין מקום ולמטה יש — הופכים אותו מתחת לנקודה (בלי להזיז את המפה);
         אם אין מקום באף צד — autoPan של Leaflet מזיז במינימום הנדרש */
      const ay=map.latLngToContainerPoint(ll).y, h=c.offsetHeight, top=ay+7-parseFloat(getComputedStyle(c).marginBottom||0)-h;
      const needUp=Math.max(0,vTop+12-top), needDown=Math.max(0,ay+16+h-(vBot-24));
      const flip=needUp>0&&needDown<needUp;
      if(flip) c.classList.add("stk-below");
      /* מיקום מחדש (גם כשפותחים/סוגרים פריט וגובה החלון משתנה): החלון המהופך נעוג בקצה העליון שלו */
      const relayout=()=>{
        pop.options.autoPan=false; pop.update();
        if(flip) pop.options.offset=L.point(dx,16+c.offsetHeight);
        pop.options.autoPan=true; pop.update();
      };
      relayout();
      c.addEventListener("toggle",relayout,true);   // התוכן הוא אלמנט (לא מחרוזת), לכן מצב ה-details נשמר ב-update
    }
    return true;
  }
  window.pmtOpenStack=openStack;
  map.on("click",e=>{
    const oe=e.originalEvent, pt=oe&&oe.pointerType;
    openStack(e.latlng,{touch:pt?pt!=="mouse":COARSE});
  });

  /* ---- שם בריחוף (מחשב בלבד): מאזין אחד על המפה, throttle, וטולטיפ יחיד לאזור העליון בנקודה ---- */
  if(CAN_HOVER){
    const tip=L.tooltip({direction:"top",offset:[0,-10],opacity:.97,className:"hover-tip"});
    const box=map.getContainer();
    let last=0,tmr=0,pend=null,lastKey="";
    const hide=()=>{ if(map.hasLayer(tip)) map.removeLayer(tip); lastKey=""; box.classList.remove("hit"); };
    const run=e=>{
      if(map._animatingZoom||(map.dragging&&map.dragging.moving())) return hide();
      const t=e.originalEvent&&e.originalEvent.target;
      if(t&&t.closest&&t.closest(".leaflet-popup,.leaflet-control")) return hide();
      const pp=map._popup;   // ליד עוגן החלון הפתוח לא מציגים טולטיפ (החלון כבר מציג את אותו מידע)
      if(pp&&map.hasLayer(pp)&&map.latLngToContainerPoint(pp.getLatLng()).distanceTo(map.latLngToContainerPoint(e.latlng))<30) return hide();
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
      pend=e; if(tmr) return;
      tmr=setTimeout(()=>{ tmr=0; last=performance.now(); run(pend); },Math.max(0,60-(performance.now()-last)));
    });
    map.on("mouseout movestart zoomstart popupopen",hide);
  }

  /* ---- כפתורי סינון: מתווספים לסרגל הקטגוריות הקיים ---- */
  function pmtBar(){
    if(!ready) return;
    const bar=document.getElementById("catBar"); if(!bar) return;
    const sep=document.createElement("div");
    sep.className="pmt-sep"; sep.textContent="איסורים קבועים — פמ״ת א-17 ורשות הטבע והגנים (נקודה = אזור; התקרבו לראות את האזור המלא)";
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

  Promise.all([fetch("data/pmt-zones.json?v=20261002").then(r=>r.json()),fetch("data/inpa-zones.json?v=20261002").then(r=>r.json())]).then(([pmt,inpa])=>{
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
    box.textContent="⚠ שכבות הפמ״ת לא נטענו ("+((err&&err.message)||"שגיאה")+"). נסו לרענן; אם זה חוזר — שלחו צילום מסך.";
    (bar&&bar.parentNode?bar.parentNode:document.body).insertBefore(box,bar||null);
  });
})();
