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
  const VERSION="15.10.2026";
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
      rows='<div class="pp-meta">סגור להטסה: מהקרקע עד '+fmt(z.max)+' רגל מעפ״ש'+(key==="NR"?' · קו מקווקו = 150 מ׳ מגבול השמורה (אינו מהפמ״ת)':'')+'</div>';
    }
    const note=z.note?'<div class="pp-heb">'+(z.src==="inpa"?"":esc(z.note).replace(/\n/g,"<br>"))+'</div>':"";
    const nb=z.nb?'<div class="approx-note" style="margin-top:6px">'+esc(z.nb)+'</div>':"";
    let inpa="";
    if(z.src==="inpa"){
      const typ=z.note||(z.kind==="P"?"גן לאומי":"שמורת טבע");
      inpa='<div class="pp-heb">'+esc(typ)+': סגירת רט״ג מהקרקע ועד '+fmt(z.max)+' רגל מעפ״ש.</div>'+
        '<details><summary>לשון הפמ״ת על סגירות רט״ג</summary><div class="pp-heb" style="border:0;padding-top:4px">'+
        'למען הסר ספק, הגובה המזערי הניתן לטיסה מעל הסגירות הינו הגובה המרבי המצוין לסגירה. רט״ג רשאית לאשר טיסה בסגירות אלו בהתאם לנהליה. במידה והתקבל אישור רט״ג לטיסה בסגירה, האישור ייחשב גם כאישור מטעם רת״א (לא נדרש גם אישור רת״א בנוסף לאישור רט״ג). האחריות לוודא אישור המחזיק בקרקע, טרם הנחיתה, הינה על הטייס. '+
        'סגירות רט״ג בפרק זה הינן הסגירות האוויריות, וגבולותיהן, בחלק מהמקרים, אינם זהים לגבולות הקרקעיים של השמורות והגנים הלאומיים. '+
        '<a href="https://www.parks.org.il/article/tisa/" target="_blank" rel="noopener" style="color:var(--cyan)">לבקשת אישור טיסה — אתר רט״ג (קישור חיצוני, אינו מהפמ״ת)</a>.</div></details>';
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
    const li=a=>a.map(x=>'<span style="display:inline-block;margin:2px 10px 2px 0">'+esc(x.id)+' · '+esc(x.name)+(x.max?' ('+(x.max==="UNL"?"בכל גובה":fmt(x.max)+" רגל"+(x.datum==="AMSL"?" מעל פני הים":""))+')':'')+'</span>').join("");
    const grp=a=>{ const g=new Map(); a.forEach(u=>{ const t=u.note||(u.kind==="P"?"גן לאומי":u.kind==="R"?"שמורת טבע":""); const k=fmt(u.max)+"|"+t; if(!g.has(k)) g.set(k,[]); g.get(k).push(u); });
      return [...g.entries()].map(([k,arr])=>{ const [mx,t]=k.split("|"); return '<br><b>עד '+esc(mx)+' רגל מעפ״ש'+(t?' · '+esc(t):'')+':</b> '+arr.map(x=>esc(x.id)+' · '+esc(x.name)).join(" · "); }).join(""); };
    d.innerHTML='<summary style="cursor:pointer;color:var(--amber);font-weight:700">אזורים הרשומים בפמ״ת ואינם מוצגים במפה (אין להם קואורדינטות/גבולות בפמ״ת או בקובצי רט״ג)</summary>'+
      '<div style="margin-top:8px;line-height:1.7"><b>שטחי אש — בפמ״ת: קואורדינטות מפורטות בפרק ENR5.1 ב-AIP:</b><br>'+li(pmt.nocoord)+
      '<br>אין לבצע טיסה בשטחי אש המיועדים לירי תלול מסלול כל עת שהאזורים פעילים (שטחי האש פעילים במהלך השבוע מיום ראשון/צאת החג בשעה 06:00 עד יום חמישי בשעה 21:00/בערב חג בשעה 14:00 או בהתאם למפורסם מעת לעת ב-NOTAM).'+
      '<br><br><b>אתרי טבע (נספח ה\') ללא גבולות זמינים ('+inpa.unmapped.length+'):</b> גובה הסגירה המרבי (מעפ״ש) וסוג האזור כלשונם בנספח ה\' בפמ״ת.'+grp(inpa.unmapped)+
      '<br><br><b>מגבלות קרבה לגבול (סעיף 4 בפמ״ת):</b> אין לטוס בכל גובה ובמרחק של פחות: מ-6 ק״מ מגבול רצועת עזה (ראה LLP19 בנספח א\'); מ-3 ק״מ מגבול מצרים; ניתן לטוס עד גבול ירדן; מ-6 ק״מ מגבול סוריה; מ-3 ק״מ מגבול לבנון. '+
      'אין לבצע טיסה צפונית לקו הרוחב 33°00\'00"N (קו שבי-ציון ראש פינה) פרט לכלי טיס המקיים קשר אלחוט דיבור דו כיווני עם יחידת הנת"א הרלוונטית ומצויד במכשיר טרנספונדר תקין. איסור זה אינו חל על כטב"מ וטיסן. '+
      'בקשות הנוגעות לכטב"מ/טיסן, יש לקבל אישור מסנכרון חיל אוויר בלבד ללא צורך באישור רת"א במייל הבא: sinhrun5@gmail.com. '+
      'ההגבלות המפורטות בכל סעיף 4 אינן חלות על כלי טיס מאויש בטיסה חקלאית, כלי טיס בטיסת פינוי פצועים, כלי טיס בטיסת כיבוי אש, כלי טיס בטיסת פיזור פיתיונות ובטיסת פיזור זבובים. המרחקים מתעדכנים לעיתים קרובות בפרסומי המידע התעופתי הזמניים (NOTAM). קווי הגבול עצמם אינם מצוירים.'+
      '<br><br><b>לפי פמ״ת ב-09 סעיף 2(א) (עדכון 2/21):</b> "טיסה מעל אזור אסור, מוגבל או מסוכן לטיסה, או טיסה בקרבת הגבול, תבוצע בהתאם להגבלות הקבועות בנוהל א-17."</div>';
    f.insertBefore(d,f.firstChild);
  }

  Promise.all([fetch("data/pmt-zones.json?v=20261016").then(r=>r.json()),fetch("data/inpa-zones.json?v=20261015").then(r=>r.json())]).then(([pmt,inpa])=>{
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
