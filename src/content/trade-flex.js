(() => {
  const fr = (document.documentElement.lang || navigator.language || '').startsWith('fr');
  const fmt = n => Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
  let active, customBackground = null;
  function close() { if (active) { active.remove(); active = null; } }
  async function open(page, analysis) {
    close();
    const dialog = document.createElement('dialog');
    dialog.dataset.rn = 'flex';
    dialog.style.cssText = 'padding:0;border:1px solid #394155;border-radius:20px;background:#101421;color:#edf2ff;width:min(900px,94vw);max-height:92vh;';
    const container = document.createElement('div'); dialog.append(container);
    const root = container.attachShadow({mode:'closed'});
    const style = document.createElement('style');
    style.textContent = '*{box-sizing:border-box}section{padding:20px;font:14px/1.5 system-ui}header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}h2{font-size:18px;margin:0}button,a,select,.upload{font:inherit;color:#edf2ff;background:#242d43;border:1px solid #46516b;border-radius:9px;padding:8px 14px;cursor:pointer;text-decoration:none}button:focus-visible,a:focus-visible,select:focus-visible,.upload:focus-within{outline:2px solid #71d9fb}img{display:block;width:100%;border-radius:12px}footer{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-top:14px}p{color:#acb7cc;margin:0}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 16px}.controls label{display:flex;align-items:center;gap:8px}.upload{position:relative;overflow:hidden}.upload input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}.error{color:#ff9aae;margin-bottom:10px}input[type=range]{width:100px;accent-color:#72dfbd}@media(max-width:540px){section{padding:12px}footer{align-items:start;flex-direction:column}.controls{font-size:12px}button,a,select,.upload{padding:7px 10px}}';
    const section = document.createElement('section'), header = document.createElement('header');
    const title = document.createElement('h2'); title.textContent = '🏆 Trade Flex';
    const dismiss = document.createElement('button'); dismiss.textContent = fr ? 'Fermer' : 'Close'; dismiss.onclick = close;
    header.append(title,dismiss);
    const status = document.createElement('p'); status.textContent = fr ? 'Création de ton image…' : 'Creating your image…';
    section.append(header,status); root.append(style,section); document.body.append(dialog); active = dialog;
    dialog.addEventListener('close', () => { dialog.remove(); if (active === dialog) active = null; });
    dialog.showModal();
    try {
      // Snapshot everything before waiting for thumbnails: changing trades must
      // never mix two offers in the exported image. No names or serials exported.
      const sides = ['give','get'].map(role => {
        const side = page.sides.find(s => s.role === role);
        const index = page.sides.indexOf(side);
        return { role, robux: side?.robux || 0, rap: analysis?.[role]?.rap ?? side?.rapTotal,
          value: analysis?.valueAvailable ? analysis?.[role]?.value : null,
          items: (side?.items || []).map((item,i) => ({name:item.name || 'Item', rap:item.rap,
            value:analysis?.pageItems?.[index]?.[i]?.value ?? (analysis?.pageItems?.[index]?.[i]?.noValue ? item.rap : null),
            src:item.card?.querySelector('img:not([data-rn])')?.src})) };
      });
      if (sides.some(s => !page.sides.some(p => p.role === s.role))) throw new Error('sides');
      const images = await Promise.all(sides.flatMap(s => s.items).map(item => new Promise(resolve => {
        if (!item.src || !/^https:\/\/[^/]*rbxcdn\.com\//i.test(item.src)) return resolve(null);
        const img = new Image(); img.crossOrigin = 'anonymous';
        const timer = setTimeout(() => resolve(null),2500);
        img.onload = () => { clearTimeout(timer); resolve(img); };
        img.onerror = () => { clearTimeout(timer); resolve(null); }; img.src = item.src;
      })));
      if (active !== dialog) return;
      const canvas = document.createElement('canvas'); canvas.width=1200;
      const c=canvas.getContext('2d');
      const image=document.createElement('img');image.alt=fr?'Carte récapitulative du trade':'Trade summary card';
      status.replaceWith(image);
      const footer=document.createElement('footer'),hint=document.createElement('p'),download=document.createElement('a');
      hint.textContent=fr?'Clic droit sur l’image → Copier l’image. Pseudos et serials masqués.':'Right-click → Copy image. Names and serials hidden.';
      download.download='ronote-trade-flex.png';download.textContent=fr?'Télécharger':'Download';footer.append(hint,download);section.append(footer);
      const controls=document.createElement('div');controls.className='controls';
      const preset=document.createElement('select');preset.setAttribute('aria-label',fr?'Fond':'Background');
      for(const [value,label] of [['night',fr?'Fond · Nuit':'Background · Night'],['purple',fr?'Fond · Violet':'Background · Purple'],['custom',fr?'Fond · Mon image':'Background · My image']]){const option=document.createElement('option');option.value=value;option.textContent=label;preset.append(option);}
      preset.value=customBackground?'custom':'night';
      const upload=document.createElement('label');upload.className='upload';upload.textContent=fr?'Importer un fond':'Import background';
      const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';file.setAttribute('aria-label',upload.textContent);upload.append(file);
      const metric=document.createElement('select');metric.setAttribute('aria-label',fr?'Résultat mis en avant':'Featured result');
      for(const field of ['value','rap']){const option=document.createElement('option');option.value=field;option.textContent=field.toUpperCase();metric.append(option);}
      metric.value=Number.isFinite(sides[0].value)&&Number.isFinite(sides[1].value)?'value':'rap';
      const shadeLabel=document.createElement('label');shadeLabel.textContent=fr?'Assombrir':'Dim';
      const shade=document.createElement('input');shade.type='range';shade.min='20';shade.max='85';shade.value='55';shade.setAttribute('aria-label',shadeLabel.textContent);shadeLabel.append(shade);
      const error=document.createElement('p');error.className='error';error.setAttribute('role','status');
      controls.append(preset,upload,metric,shadeLabel);section.insertBefore(controls,image);section.insertBefore(error,image);
      const result=field=>{const a=sides[0][field],b=sides[1][field],valid=Number.isFinite(a)&&Number.isFinite(b),delta=b-a;return {valid,delta,color:!valid||delta===0?'#adbed8':delta>0?'#54edb1':'#ff627f',amount:valid?(delta>0?'+':'')+fmt(delta):'—',pct:valid&&a>0?(delta>0?'+':'')+(delta/a*100).toFixed(1)+'%':'—'};};
      function draw(){
        const heights=sides.map(s=>Math.max(1,Math.ceil(s.items.length/4))*302+132);
        canvas.height=268+heights[0]+heights[1]+152;
        const h=canvas.height,hero=result(metric.value);
        const bg=c.createLinearGradient(0,0,1200,h);bg.addColorStop(0,preset.value==='purple'?'#35105a':'#101d30');bg.addColorStop(1,preset.value==='purple'?'#12091f':'#080e19');c.fillStyle=bg;c.fillRect(0,0,1200,h);
        if(preset.value==='custom'&&customBackground){const img=customBackground,scale=Math.max(1200/img.width,h/img.height);c.drawImage(img,(1200-img.width*scale)/2,(h-img.height*scale)/2,img.width*scale,img.height*scale);c.fillStyle=`rgba(5,9,18,${Number(shade.value)/100})`;c.fillRect(0,0,1200,h);}
        const text=(v,x,y,size=22,color='#f1f5ff',weight=600)=>{c.font=`${weight} ${size}px system-ui`;c.fillStyle=color;c.fillText(String(v),x,y);};
        const box=(x,y,w,bh,color,r=18,stroke)=>{c.beginPath();c.roundRect(x,y,w,bh,r);c.fillStyle=color;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke();}};
        const short=(s,w)=>{if(c.measureText(s).width<=w)return s;while(s.length&&c.measureText(s+'…').width>w)s=s.slice(0,-1);return s+'…';};
        // The status is a comparison of the selected metric, never a claim that
        // a pending trade was accepted or that the current value is realized P&L.
        box(8,8,1184,h-16,'rgba(0,0,0,0)',26,hero.color);
        text('RONOTE  /  TRADE FLEX',48,56,17,'#b9c8df');
        text(hero.valid?(hero.delta>0?'WIN':hero.delta<0?'LOSS':'EVEN'):'TRADE',48,138,68,hero.color,800);
        text(fr?'Mon trade, en un regard.':'My trade at a glance.',50,181,20,'#c1cddd',400);
        c.textAlign='right';text(hero.pct,1150,137,76,hero.color,800);text(`${hero.amount} ${metric.value.toUpperCase()}`,1150,179,25);c.textAlign='left';
        let top=222,imageIndex=0;
        sides.forEach((side,index)=>{
          box(32,top,1136,heights[index],'rgba(9,14,25,.76)',22);
          text(index?(fr?'Objets reçus':'Items you received'):(fr?'Objets donnés':'Items you gave'),56,top+43,25);
          if(side.robux){c.textAlign='right';text(`Robux   ${fmt(side.robux)}`,1142,top+43,20,'#b9c8df');c.textAlign='left';}
          if(!side.items.length)text(fr?'Aucun objet':'No items',56,top+110,22,'#aab9cd');
          side.items.forEach((item,i)=>{
            const x=56+(i%4)*278,y=top+65+Math.floor(i/4)*302;
            box(x,y,252,180,'rgba(145,162,199,.14)',14);
            const img=images[imageIndex++];
            if(img){const scale=Math.min(224/img.width,158/img.height);c.drawImage(img,x+(252-img.width*scale)/2,y+(180-img.height*scale)/2,img.width*scale,img.height*scale);}else text('◆',x+107,y+109,40,'#859abb');
            c.font='600 20px system-ui';text(short(item.name,252),x,y+211,20);
            text(`RAP   ${fmt(item.rap)}`,x,y+244,20,'#c2cddd');text(`VALUE   ${fmt(item.value)}`,x,y+274,20,'#78b9ff');
          });
          const bottom=top+heights[index]-25;
          text(`Total RAP   ${fmt(side.rap)}`,56,bottom,23);c.textAlign='right';text(`Total Value   ${fmt(side.value)}`,1142,bottom,23,'#82c3ff');c.textAlign='left';
          top+=heights[index]+16;
          if(index===0){
            ['rap','value'].forEach((field,i)=>{const r=result(field),x=32+i*580;box(x,top,556,78,'rgba(9,14,25,.88)',16,r.color);text(field.toUpperCase(),x+20,top+28,14,'#b1bed2');text(`${r.amount}  (${r.pct})`,x+20,top+59,25,r.color);});
            top+=94;
          }
        });
        text(fr?'Valeurs actuelles · Robux inclus · Identités et serials masqués':'Current values · Robux included · Identities and serials hidden',48,h-27,15,'#a6b5cc',400);
        image.src=canvas.toDataURL('image/png');download.href=image.src;
      }
      let frame;
      const refresh=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(active===dialog)draw();});};
      preset.onchange=()=>{if(preset.value==='custom'&&!customBackground){preset.value='night';file.click();}refresh();};metric.onchange=refresh;shade.oninput=refresh;
      let importId=0;
      file.onchange=async()=>{
        const selected=file.files[0],id=++importId;if(!selected)return;
        if(!['image/png','image/jpeg','image/webp'].includes(selected.type)||selected.size>15*1024*1024){error.textContent=fr?'Choisis un PNG, JPEG ou WebP de moins de 15 Mo.':'Choose a PNG, JPEG or WebP under 15 MB.';return;}
        const url=URL.createObjectURL(selected);
        try{const img=new Image();img.src=url;await img.decode();if(active!==dialog||id!==importId)return;
          // Keep only a scaled local bitmap, never upload the user's image.
          const scaled=document.createElement('canvas'),scale=Math.min(1,2400/Math.max(img.width,img.height));scaled.width=Math.max(1,Math.round(img.width*scale));scaled.height=Math.max(1,Math.round(img.height*scale));scaled.getContext('2d').drawImage(img,0,0,scaled.width,scaled.height);customBackground=scaled;preset.value='custom';error.textContent='';refresh();
        }catch{error.textContent=fr?'Cette image ne peut pas être chargée.':'This image could not be loaded.';}finally{URL.revokeObjectURL(url);file.value='';}
      };
      draw();
    } catch { status.textContent=fr?'Impossible de créer la carte. Attends que les deux offres soient chargées, puis réessaie.':'Could not create the card. Wait for both offers to load and try again.'; }
  }
  globalThis.RoNoteFlex={open,close};
})();
