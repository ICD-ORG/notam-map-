/* שכבות איסורים קבועים — פמ״ת פנים ארצי א-17 (עדכון 1/26) + גבולות רשות הטבע והגנים
   נקודה צבעונית לכל אזור; בהתקרבות מופיע האזור המלא כפוליגון שקוף.
   נתונים: data/pmt-zones.json , data/inpa-zones.json */
(function(){
  if(typeof map==="undefined"||!map||typeof L==="undefined") return;

  const KEYS={
    LLP:{label:"אסורים (LLP)",color:"#ff3b30"},
    LLR:{label:"מוגבלים (LLR)",color:"#ff9500"},
    LLD:{label:"מסוכנים (LLD)",color:"#2ec4b6"},
    LLUP:{label:"בתי כלא (LLU)",color:"#ff2d95"},
    LLUC:{label:"משטרה ומג״ב (LLU)",color:"#ff73c0"},
    LLUM:{label:"בסיסים צבאיים (LLU)",color:"#d4146e"},
    LLUS:{label:"מתקנים ביטחוניים ותשתיות (LLU)",color:"#f04ca4"},
    OBS:{label:"בלונים מעוגנים",color:"#c9a227"},
    NR:{label:"שמורות טבע (רט״ג)",color:"#3ddc84"},
    NP:{label:"גנים לאומיים (רט״ג)",color:"#4da3ff"}
  };
  const VERSION="16.10.2026 · גרסה 4";
  const on=new Set(Object.keys(KEYS));
  const items=[];           // {key,z,bounds,center,dot,poly,buf,rings,bufRings,html}
  const counts={};
  let ready=false;

  map.createPane("pmtPane"); map.getPane("pmtPane").style.zIndex=350;
  const rend=L.canvas({pane:"pmtPane",padding:0.4});

  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const fmt=n=>/^\d+$/.test(n)?Number(n).toLocaleString("en-US"):n;
  function bboxOf(rings){
    let a=90,b=180,c=-90,d=-180;
    rings.forEach(r=>r.forEach(p=>{if(p[0]<a)a=p[0];if(p[0]>c)c=p[0];if(p[1]<b)b=p[1];if(p[1]>d)d=p[1];}));
    return L.latLngBounds([a,b],[c,d]);
  }
  function zmin(bounds){
    const h=(bounds.getNorth()-bounds.getSouth())*111, w=(bounds.getEast()-bounds.getWest())*94, e=Math.max(h,w);
    return e>40?0:e>15?7:e>5?9:e>1.5?10:11;
  }
  function mainRing(rings){ // הטבעת הגדולה — למיקום הנקודה
    let best=rings[0],ba=-1;
    rings.forEach(r=>{const b=bboxOf([r]);const a=(b.getNorth()-b.getSouth())*(b.getEast()-b.getWest());if(a>ba){ba=a;best=r;}});
    return bboxOf([best]).getCenter();
  }
  let UI={gens:{},inpaGen:"",stamp:{},annexE:{t:"",h:[]},sec4:""};
  const pg=p=>"עמ' "+p+(UI.stamp[p]?", עדכון "+UI.stamp[p]:"");
  function popup(z,key){
    const k=KEYS[key], W='style="white-space:normal"', W0='style="white-space:normal;border:0;padding-top:4px"';
    let body="";
    if(z.src==="pmt"){
      body='<div class="pp-heb" '+W+'>'+(z.note||"")+'</div>'+(UI.gens[z.gen]?'<div class="pp-heb" '+W0+'>'+UI.gens[z.gen]+'</div>':"");
    }else{
      const ax=z.ax;
      const q=ax?esc(UI.annexE.t)+" ("+pg(ax[0])+"): <i>"+UI.annexE.h.map((h,i)=>esc(h)+": "+esc(ax[1][i])).join(" · ")+"</i>":"";
      body='<div class="pp-heb" '+W+'>'+q+(z.nb?'<br><span class="mapnote">הערת המפה (אינה מהפמ״ת): '+esc(z.nb)+'</span>':"")+'</div>'+
        '<div class="pp-heb" '+W0+'>'+UI.inpaGen+'</div>'+
        '<div class="pp-heb" '+W0+'><span class="mapnote">הערת המפה (אינה מהפמ״ת): גבולות השמורה על המפה: קובץ רשות הטבע והגנים מ-11/01/2026.</span>'+(key==="NR"?' <span class="mapnote">הערת המפה (אינה מהפמ״ת): הקו המקווקו סביב שמורה — רצועת 150 מ׳ מגבול השמורה.</span>':"")+'</div>';
    }
    return '<div class="pp-bigclose" onclick="closeCurrentPopup()">✕ סגור</div>'+
      '<div class="pp-name">'+esc(z.name)+'</div>'+
      '<span class="pp-id" style="color:'+k.color+'">'+esc(z.id)+'</span> <span class="badge" style="color:'+k.color+';border-color:currentColor">'+esc(k.label)+'</span>'+body;
  }
  function add(key,z){
    const rings=z.rings; if(!rings||!rings.length) return;
    const bounds=bboxOf(rings), center=z.c?L.latLng(z.c[0],z.c[1]):mainRing(rings), col=KEYS[key].color;
    const it={key,approx:!!z.approx,z:zmin(bounds),bounds,center,rings,bufRings:z.buf||null,dot:null,poly:null,buf:null,html:popup(z,key),col};
    const mob=window.matchMedia("(max-width:760px)").matches;
    const uu=/^LLU[PCMS]$/.test(key);
    it.uu=uu;
    it.dot=L.circleMarker(center,{renderer:rend,radius:uu?(mob?10:8):(mob?8:6),color:uu?"#2a0016":"#0b1220",weight:uu?2.4:1.5,fillColor:col,fillOpacity:uu?1:.95});
    if(uu) it.dot.bindTooltip(z.name,{permanent:true,direction:"top",offset:[0,-9],className:"llu-lbl",opacity:1,interactive:false});
    it.dot.bindPopup(it.html);
    items.push(it); counts[key]=(counts[key]||0)+1;
  }
  function build(it){
    it.poly=L.polygon(it.rings,{renderer:rend,color:it.col,weight:it.uu?3.2:2,fillColor:it.col,fillOpacity:it.uu?.38:.16,dashArray:it.approx?"7 5":null});
    it.poly.bindPopup(it.html);
    if(it.bufRings) it.buf=L.polygon(it.bufRings,{renderer:rend,color:it.col,weight:1.4,dashArray:"5 5",fill:false,interactive:false});
  }
  function rm(l){ if(l&&map.hasLayer(l)) map.removeLayer(l); }
  function ad(l){ if(l&&!map.hasLayer(l)) l.addTo(map); }
  function update(){
    if(!ready) return;
    const z=map.getZoom(), view=map.getBounds().pad(0.25);
    items.forEach(it=>{
      const show=on.has(it.key)&&view.intersects(it.bounds);
      if(!show){ rm(it.dot);rm(it.poly);rm(it.buf); return; }
      if(z>=it.z){
        if(!it.poly) build(it);
        ad(it.poly);ad(it.buf);rm(it.dot); if(it.uu) it.poly.bringToFront();
      }else{ ad(it.dot);rm(it.poly);rm(it.buf); if(it.uu) it.dot.bringToFront(); }
    });
  }
  map.on("moveend zoomend",update);
  { const zc=()=>map.getContainer().classList.toggle("zoom-llu",map.getZoom()>=10); map.on("zoomend",zc); zc(); }     // שמות LLU מזום 10

  /* ---- כפתורי סינון: מתווספים לסרגל הקטגוריות הקיים ---- */
  function pmtBar(){
    if(!ready) return;
    const bar=document.getElementById("catBar"); if(!bar) return;
    const sep=document.createElement("div");
    sep.className="pmt-sep"; sep.textContent="איסורים קבועים — פמ״ת א-17 ורשות הטבע והגנים (נקודה = אזור; התקרבו לראות את האזור המלא) · גרסת נתונים "+VERSION;
    bar.appendChild(sep);
    Object.keys(KEYS).forEach(k=>{
      if(!counts[k]) return;
      const c=KEYS[k], b=document.createElement("div");
      b.className="catbtn"+(on.has(k)?" on":""); b.style.color=on.has(k)?c.color:"";
      b.innerHTML='<span class="cdot" style="background:'+c.color+'"></span>'+c.label+' <span class="cnt">('+counts[k]+')</span>';
      b.onclick=()=>{ on.has(k)?on.delete(k):on.add(k); update(); b.className="catbtn"+(on.has(k)?" on":""); b.style.color=on.has(k)?c.color:""; };
      bar.appendChild(b);
    });
    /* כיבוי / הדלקה של כל השכבות (נוט"מים + איסורים קבועים) */
    const mk=(txt,fn)=>{ const b=document.createElement("div"); b.className="catbtn"; b.textContent=txt; b.onclick=fn; bar.appendChild(b); };
    const setAll=onAll=>{
      try{ activeCats=onAll?new Set(Object.keys(CATS)):new Set(); }catch(_){}
      on.clear(); if(onAll) Object.keys(KEYS).forEach(k=>on.add(k));
      update();
      if(typeof renderCatBar==="function") renderCatBar();
      if(typeof renderAll==="function") renderAll();
    };
    mk("🚫 כבה את כל השכבות",()=>setAll(false));
    mk("👁 הדלק את כל השכבות",()=>setAll(true));
  }
  if(typeof renderCatBar==="function"){
    const orig=renderCatBar;
    renderCatBar=function(){ orig.apply(this,arguments); pmtBar(); };
  }

  /* ---- רשימה: אזורים שמופיעים בפמ״ת ללא שרטוט במפה — כלשון הפמ״ת ---- */
  function unmappedBox(pmt,inpa){
    const f=document.querySelector("footer"); if(!f) return;
    const d=document.createElement("details"); d.style.cssText="max-width:900px;margin:0 auto 14px;text-align:right";
    const row=(code,name,html)=>'<details style="margin:4px 0"><summary style="cursor:pointer"><span dir="ltr">'+esc(code)+'</span> · '+esc(name)+'</summary><div class="pp-heb" style="white-space:normal;border:0">'+html+'</div></details>';
    const nc=pmt.nocoord.map(b=>row(b.id,b.name,b.html)).join("");
    const E=pmt.ui.annexE;
    const un=inpa.unmapped.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))).map(u=>{
      const ax=u.ax; const q=ax?esc(E.t)+" ("+pg(ax[0])+"): <i>"+E.h.map((h,i)=>esc(h)+": "+esc(ax[1][i])).join(" · ")+"</i>":"";
      return row(u.id,ax?ax[1][1]:u.name,q+'<br><span class="mapnote">הערת המפה (אינה מהפמ״ת): בטבלת נספח ה׳ בפמ״ת אין מיקום או גבול לאתר זה, ובקובץ רט״ג שבמפה אין לו גבול — לכן הוא אינו מסומן במפה.</span><br><span class="mapnote">הערת המפה (אינה מהפמ״ת): את הגבול המדויק של סגירת רט״ג יש לבדוק באתר רט״ג.</span><div style="margin:8px 0"><a class="extbtn" href="https://www.parks.org.il/" target="_blank" rel="noopener noreferrer" aria-label="אתר רט״ג — נפתח בלשונית חדשה, המפה נשארת פתוחה">אתר רט״ג <span aria-hidden="true">↗</span></a></div>'+pmt.ui.inpaGen);
    }).join("");
    d.innerHTML='<summary style="cursor:pointer;color:var(--amber);font-weight:700">אזורים הרשומים בפמ״ת ואינם מוצגים במפה (אין להם שרטוט או גבולות)</summary>'+
      '<div style="margin-top:8px;line-height:1.7">'+(pmt.nocoord.length?'<b>אזורי LLR ללא שרטוט ('+pmt.nocoord.length+'):</b>'+nc+'<br>':'')+
      '<b>אתרי טבע (נספח ה׳) ללא גבולות ('+inpa.unmapped.length+'):</b>'+un+
      '<br><b>מגבלות קרבה לגבול:</b><div class="pp-heb" style="white-space:normal;border:0">'+pmt.ui.sec4+'</div></div>';
    f.insertBefore(d,f.firstChild);
  }

  Promise.all([fetch("data/pmt-zones.json?v=20261022").then(r=>r.json()),fetch("data/inpa-zones.json?v=20261022").then(r=>r.json())]).then(([pmt,inpa])=>{
    UI=pmt.ui||UI; pmt.zones.forEach(z=>{z.src="pmt";z.edition=pmt.edition;add(z.cat,z);});
    inpa.sites.forEach(z=>{z.src="inpa";z.edition=inpa.edition;z.id=z.id;add(z.kind==="P"?"NP":"NR",z);});
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
