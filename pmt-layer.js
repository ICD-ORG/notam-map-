/* שכבות איסורים קבועים — פמ״ת פנים ארצי א-17 (עדכון 1/26) + גבולות רשות הטבע והגנים
   נקודה צבעונית לכל אזור; בהתקרבות מופיע האזור המלא כפוליגון שקוף.
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
  const items=[];           // {key,z,bounds,center,dot,poly,buf,rings,bufRings,html}
  const counts={};
  let ready=false;

  map.createPane("pmtPane"); map.getPane("pmtPane").style.zIndex=350;
  const rend=L.canvas({pane:"pmtPane",padding:0.4});

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
  function zmin(bounds){
    const h=(bounds.getNorth()-bounds.getSouth())*111, w=(bounds.getEast()-bounds.getWest())*94, e=Math.max(h,w);
    return e>40?0:e>15?7:e>5?9:e>1.5?10:11;
  }
  function mainRing(rings){ // הטבעת הגדולה — למיקום הנקודה
    let best=rings[0],ba=-1;
    rings.forEach(r=>{const b=bboxOf([r]);const a=(b.getNorth()-b.getSouth())*(b.getEast()-b.getWest());if(a>ba){ba=a;best=r;}});
    return bboxOf([best]).getCenter();
  }
  function popup(z,key){
    const k=KEYS[key];
    let rows="";
    if(z.src==="pmt"){
      const unit=z.maxunit==="AGL"?"מעל פני הקרקע":"";
      rows='<div class="pp-meta">גובה: מ־'+alt(z.min)+' ועד '+alt(z.max,unit)+(z.r?' · רדיוס '+(z.r>=1000?(z.r/1000).toFixed(z.r%1000?2:0).replace(/\.?0+$/,"")+' ק״מ':z.r+' מ׳'):'')+'</div>';
    }else{
      rows='<div class="pp-meta">גובה מירבי: '+alt(z.max)+' מעפ״ש (מהקרקע)'+(key==="NR"?' · קו מקווקו = 150 מ׳ מגבול השמורה':'')+'</div>';
    }
    const note=z.note?'<div class="pp-heb">'+esc(z.note)+'</div>':"";
    const nb=z.nb?'<div class="approx-note" style="margin-top:6px">'+esc(z.nb)+'</div>':"";
    let inpa="";
    if(z.src==="inpa"){
      inpa='<details><summary>כללי רט״ג</summary><div class="pp-heb" style="border:0;padding-top:4px">'+
        'בשמורות טבע: גובה מזערי 300 רגל מעפ״ש ו-150 מ׳ מגבול השמורה; בגנים לאומיים: 500 רגל מעפ״ש. '+
        'אסור נחיתה והמראה בשמורות טבע ובגנים לאומיים. רט״ג מאפשרת אישור חריגים — '+
        '<a href="https://www.parks.org.il/article/tisa/" target="_blank" rel="noopener" style="color:var(--cyan)">טופס בקשה לחריגה</a>.</div></details>';
    }
    return '<div class="pp-bigclose" onclick="closeCurrentPopup()">✕ סגור</div>'+
      '<div class="pp-name">'+esc(z.name)+'</div>'+
      '<span class="pp-id" style="color:'+k.color+'">'+esc(z.id)+'</span> <span class="badge" style="color:'+k.color+';border-color:currentColor">'+esc(k.label)+'</span>'+
      rows+note+nb+inpa+
      '<div class="pp-meta" style="margin-top:8px">מקור: '+esc(z.edition)+'</div>';
  }
  function add(key,z){
    const rings=z.rings; if(!rings||!rings.length) return;
    const bounds=bboxOf(rings), center=z.c?L.latLng(z.c[0],z.c[1]):mainRing(rings), col=KEYS[key].color;
    const it={key,z:zmin(bounds),bounds,center,rings,bufRings:z.buf||null,dot:null,poly:null,buf:null,html:popup(z,key),col};
    const mob=window.matchMedia("(max-width:760px)").matches;
    it.dot=L.circleMarker(center,{renderer:rend,radius:mob?8:6,color:"#0b1220",weight:1.5,fillColor:col,fillOpacity:.95});
    it.dot.bindPopup(it.html);
    items.push(it); counts[key]=(counts[key]||0)+1;
  }
  function build(it){
    it.poly=L.polygon(it.rings,{renderer:rend,color:it.col,weight:2,fillColor:it.col,fillOpacity:.16});
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
        ad(it.poly);ad(it.buf);rm(it.dot);
      }else{ ad(it.dot);rm(it.poly);rm(it.buf); }
    });
  }
  map.on("moveend zoomend",update);
  /* לחיצה על אזור/נקודה: מתמקדים בנקודה שנלחצה, עם מקום לחלון המידע */
  map.on("popupopen",e=>{
    const ll=e.popup.getLatLng(); if(!ll) return;
    const z=Math.max(map.getZoom(),11), el=e.popup.getElement(), h=(el?el.offsetHeight:220)+30;
    map.setView(map.unproject(map.project(ll,z).subtract([0,h/2]),z),z,{animate:true});
  });

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
      b.onclick=()=>{ on.has(k)?on.delete(k):on.add(k); update(); b.className="catbtn"+(on.has(k)?" on":""); b.style.color=on.has(k)?c.color:""; };
      bar.appendChild(b);
    });
  }
  if(typeof renderCatBar==="function"){
    const orig=renderCatBar;
    renderCatBar=function(){ orig.apply(this,arguments); pmtBar(); };
  }

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
