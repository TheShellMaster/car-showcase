"use strict";
(function(){
  var c = document.createElement("canvas");
  var gl = null;
  try{ gl = c.getContext("webgl2", {failIfMajorPerformanceCaveat:false}) || c.getContext("webgl", {failIfMajorPerformanceCaveat:false}) || c.getContext("experimental-webgl", {failIfMajorPerformanceCaveat:false}); }catch(e){}
  if(gl) return;
  var b = document.body;
  if(b) b.className += (b.className ? " " : "") + "no-webgl";
  var loader = document.getElementById("loader");
  if(!loader) return;
  var ua = navigator.userAgent || "";
  var isChrome = /Chrome|Chromium|Edg|OPR|Brave/.test(ua) && !/Firefox/.test(ua);
  var isFirefox = /Firefox/.test(ua);
  var isSafari = /Safari/.test(ua) && !/Chrome/.test(ua) && !/Chromium/.test(ua);
  var steps = "";
  if(isChrome){
    steps = "<ol><li>Ouvrez <code>chrome://settings/system</code> <button type=\"button\" class=\"nogl-copy\" data-copy=\"chrome://settings/system\">Copier</button> \u2192 \u00ab Utiliser l\u2019acc\u00e9l\u00e9ration graphique si disponible \u00bb \u2192 Activ\u00e9 \u2192 <strong>Relancer</strong></li><li>Si rien ne change : <code>chrome://flags/#ignore-gpu-blocklist</code> <button type=\"button\" class=\"nogl-copy\" data-copy=\"chrome://flags/#ignore-gpu-blocklist\">Copier</button> \u2192 Enabled \u2192 Relancer</li><li>V\u00e9rifiez <code>chrome://gpu</code> <button type=\"button\" class=\"nogl-copy\" data-copy=\"chrome://gpu\">Copier</button> (WebGL doit \u00eatre \u00ab Hardware accelerated \u00bb)</li></ol>";
  } else if(isFirefox){
    steps = "<ol><li>Ouvrez <code>about:config</code> <button type=\"button\" class=\"nogl-copy\" data-copy=\"about:config\">Copier</button> \u2192 <code>webgl.disabled</code> = false, <code>webgl.force-enabled</code> = true</li><li>V\u00e9rifiez <code>about:support</code> <button type=\"button\" class=\"nogl-copy\" data-copy=\"about:support\">Copier</button> \u2192 WebGL doit \u00eatre activ\u00e9</li></ol>";
  } else if(isSafari){
    steps = "<ol><li>Safari \u2192 R\u00e9glages \u2192 Avanc\u00e9 \u2192 cocher \u00ab Afficher le menu D\u00e9veloppement \u00bb</li><li>Menu D\u00e9veloppement \u2192 Fonctionnalit\u00e9s exp\u00e9rimentales \u2192 WebGL activ\u00e9</li><li>Sinon mettez \u00e0 jour iOS/macOS (Safari 15+ requis)</li></ol>";
  } else {
    steps = "<p>Installez <a href=\"https://www.google.com/chrome/\">Chrome</a> ou <a href=\"https://www.mozilla.org/firefox/\">Firefox</a> \u00e0 jour.</p>";
  }
  var html = "<div class=\"nogl\"><h2>Ce navigateur ne peut pas afficher la 3D</h2><p>L\u2019acc\u00e9l\u00e9ration graphique (WebGL) est d\u00e9sactiv\u00e9e. Le site fonctionne, mais votre navigateur refuse de dessiner la voiture.</p>" + steps + "<p><a href=\"status.html\">Voir le diagnostic complet</a> \u2014 <a href=\"docs.html#depannage\">D\u00e9pannage</a></p></div>";
  loader.innerHTML = html;
  var btns = loader.querySelectorAll(".nogl-copy");
  for(var i=0;i<btns.length;i++){
    (function(btn){
      btn.onclick = function(){
        var txt = btn.getAttribute("data-copy");
        try{
          if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt); btn.textContent="Copi\u00e9"; setTimeout(function(){btn.textContent="Copier";},1500); return; }
        }catch(e){}
        var ta=document.createElement("textarea"); ta.value=txt; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta); ta.select(); try{document.execCommand("copy"); btn.textContent="Copi\u00e9"; setTimeout(function(){btn.textContent="Copier";},1500);}catch(e){} document.body.removeChild(ta);
      };
    })(btns[i]);
  }
})();
