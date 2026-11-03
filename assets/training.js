/* TechCare Training Resources — shared renderer for the staff portal
   (index.html) and admin portal (admin.html). Content lives in
   training-data.js (window.TC_TRAINING). Pure string builders + a thin
   mount() that wires clicks and handout printing. YouTube is LINKED,
   not embedded (portal CSP blocks third-party frames): cards use the
   video's own thumbnail and open the watch page in a new tab. */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function list(items, cls) {
    return '<ul class="' + (cls || "tr-list") + '">' +
      items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>";
  }

  /* ---------- infographic panels (HTML/CSS/SVG — crisp text) ---------- */
  var PANELS = {
    computer: function () {
      return '<div class="tr-diagram"><svg viewBox="0 0 340 218" role="img" aria-label="Labelled picture of a desktop computer">' +
        '<rect x="75" y="14" width="190" height="118" rx="8" fill="#ffffff" stroke="#c7d6ea" stroke-width="2"/>' +
        '<rect x="83" y="22" width="174" height="86" rx="4" fill="#dceeff"/>' +
        '<rect x="92" y="31" width="26" height="22" rx="3" fill="#0087FA"/><rect x="92" y="59" width="26" height="22" rx="3" fill="#FE4600"/>' +
        '<rect x="83" y="108" width="174" height="16" fill="#eef3f9"/><rect x="87" y="111" width="12" height="10" rx="2" fill="#FE4600"/>' +
        '<text x="93" y="119" font-size="7" fill="#fff" font-weight="bold">▦</text>' +
        '<rect x="160" y="132" width="20" height="12" fill="#c7d6ea"/><rect x="128" y="144" width="84" height="6" rx="3" fill="#c7d6ea"/>' +
        '<rect x="95" y="162" width="130" height="34" rx="8" fill="#ffffff" stroke="#c7d6ea" stroke-width="2"/>' +
        '<g fill="#eef3f9"><rect x="103" y="169" width="16" height="8" rx="2"/><rect x="123" y="169" width="16" height="8" rx="2"/><rect x="143" y="169" width="16" height="8" rx="2"/><rect x="163" y="169" width="16" height="8" rx="2"/><rect x="183" y="169" width="16" height="8" rx="2"/><rect x="103" y="181" width="96" height="8" rx="2"/></g>' +
        '<path d="M262 168 q26 -6 30 14" fill="none" stroke="#c7d6ea" stroke-width="2"/>' +
        '<ellipse cx="296" cy="188" rx="14" ry="19" fill="#ffffff" stroke="#c7d6ea" stroke-width="2"/><line x1="296" y1="172" x2="296" y2="184" stroke="#c7d6ea" stroke-width="2"/>' +
        '<circle cx="262" cy="24" r="9" fill="#1758CC"/><text x="262" y="28" font-size="10" fill="#fff" text-anchor="middle" font-weight="bold">1</text>' +
        '<circle cx="89" cy="117" r="9" fill="#1758CC"/><text x="89" y="121" font-size="10" fill="#fff" text-anchor="middle" font-weight="bold">3</text>' +
        '<circle cx="296" cy="158" r="9" fill="#1758CC"/><text x="296" y="162" font-size="10" fill="#fff" text-anchor="middle" font-weight="bold">4</text>' +
        '<circle cx="248" cy="30" r="9" fill="#d92d20"/><text x="248" y="34" font-size="10" fill="#fff" text-anchor="middle" font-weight="bold">×</text>' +
        "</svg>" +
        '<ol class="tr-legend"><li><b>Power button</b> — on the computer box (or laptop edge). One short press.</li>' +
        "<li><b>Desktop</b> — the counter top. Pictures here are shortcuts to programs and files.</li>" +
        "<li><b>Start button</b> — bottom-left. Opens the list of everything.</li>" +
        "<li><b>Mouse</b> — slide to move the arrow; wheel rolls the page.</li>" +
        "<li><b>The ×</b> — top-right corner of a window closes it. Nothing is deleted.</li></ol></div>";
    },
    inbox: function () {
      return '<div class="tr-inbox" role="img" aria-label="Picture of an email inbox with labels">' +
        '<div class="tr-inbox-side"><span class="on">📥 Inbox</span><span>📤 Sent</span><span>🗑️ Trash</span></div>' +
        '<div class="tr-inbox-main">' +
        '<div class="tr-inbox-row"><b>Sarah (daughter)</b><span>Dinner on Sunday?</span><em>← from someone you know</em></div>' +
        '<div class="tr-inbox-row"><b>Your clinic</b><span>Appointment reminder</span><em>← expected mail</em></div>' +
        '<div class="tr-inbox-row warn"><b>“BANK SECURITY!!”</b><span>Verify now or else…</span><em>← junk / scam — delete, don\'t open links</em></div>' +
        '<div class="tr-inbox-actions"><span class="tr-chip">↩ Reply — answer this person</span><span class="tr-chip">✎ New message — start fresh</span><span class="tr-chip">📎 Paperclip — add a photo</span></div>' +
        "</div></div>";
    },
    passphrase: function () {
      return '<div class="tr-pass">' +
        '<div class="tr-pass-row weak"><div class="tr-pass-meta"><b>fluffy2019</b><span>pet + year — guessed in seconds</span></div><div class="tr-bar"><i style="width:12%"></i></div><em>Weak</em></div>' +
        '<div class="tr-pass-row mid"><div class="tr-pass-meta"><b>Calgary!2024</b><span>city + year — still a pattern</span></div><div class="tr-bar"><i style="width:38%"></i></div><em>Meh</em></div>' +
        '<div class="tr-pass-row strong"><div class="tr-pass-meta"><b>purple-tiger-river-7</b><span>four plain words — long beats tricky</span></div><div class="tr-bar"><i style="width:96%"></i></div><em>Strong</em></div>' +
        '<p class="tr-panel-note">Strength comes from <b>length</b>, not scrambled symbols. Four words you can picture beat eight characters you can\'t remember.</p></div>';
    },
    redflags: function () {
      var flags = [
        "<b>Urgent</b> — “act NOW or else.” Real organizations let you think.",
        "<b>Secret</b> — “don't tell your family / the teller.” Always a lie in progress.",
        "<b>Strange payment</b> — gift cards, crypto, wire transfer, cash by courier.",
        "<b>Threats</b> — arrest, account closed, service cut off today.",
        "<b>Too good</b> — you won a contest you never entered.",
        "<b>Asks for codes or passwords</b> — no real bank, agency, or TechCare ever does."
      ];
      return '<div class="tr-redflags"><h4>🚩 The six red flags — if even ONE appears, stop</h4>' +
        list(flags, "tr-flaglist") +
        '<div class="tr-3step"><div><b>1 · STOP</b><span>Hang up. Put it down.</span></div><div><b>2 · BREATHE</b><span>Urgency is the trick.</span></div><div><b>3 · CHECK</b><span>Call the real number, or family first.</span></div></div>' +
        '<p class="tr-panel-note">Report it: <b>Canadian Anti-Fraud Centre — 1-888-495-8501</b> · antifraudcentre-centreantifraude.ca</p></div>';
    },
    stores: function () {
      return '<div class="tr-stores">' +
        '<div class="tr-store"><b>🍎 iPhone → App Store</b><span>Blue icon, white “A” made of tools</span></div>' +
        '<div class="tr-store"><b>🤖 Android → Play Store</b><span>White bag, coloured triangle</span></div>' +
        '<div class="tr-store-rule">🚫 <b>Texts, emails, pop-ups and callers never sell apps.</b> If one offers an app, it\'s a scam — every time.</div>' +
        '<div class="tr-store-checks"><span>✔ Maker = the real company</span><span>✔ 4+ stars</span><span>✔ Lots of downloads</span><span>✔ Permissions make sense</span></div></div>';
    },
    printflow: function () {
      var steps = [["1", "Power & paper", "Light on? Paper in, straight?"], ["2", "Wi-Fi", "Printer back online? Restart it."], ["3", "Right printer", "Name matches the machine at home?"], ["4", "The queue", "Cancel the stuck “Error” job."]];
      return '<div class="tr-flow">' + steps.map(function (s) {
        return '<div class="tr-flow-step"><b>' + s[0] + "</b><h5>" + s[1] + "</h5><span>" + s[2] + "</span></div>";
      }).join('<div class="tr-flow-arrow">→</div>') + "</div>" +
        '<p class="tr-panel-note">Nine times out of ten, the fix is in the first two checks. And click <b>Print once</b> — the printer is thinking.</p>';
    },
    folders: function () {
      var f = [["📥", "Downloads", "The front step", "Everything from the internet lands here first."], ["🗄️", "Documents", "The filing cabinet", "Things you keep: letters, forms, statements."], ["🖼️", "Pictures", "The photo shelf", "Photos from your phone and camera."]];
      return '<div class="tr-folders">' + f.map(function (x) {
        return '<div class="tr-folder"><span class="tr-folder-ic">' + x[0] + "</span><b>" + x[1] + "</b><em>" + x[2] + "</em><span>" + x[3] + "</span></div>";
      }).join("") + "</div>";
    },
    videocall: function () {
      return '<div class="tr-vc">' +
        '<div class="tr-vc-checks"><h4>Before the call</h4>' + list(["Face a window or lamp — light on your face", "Volume up with the side buttons", "Camera dot at the top: nothing covering it", "Phone propped on books, at eye level"], "tr-list") + "</div>" +
        '<div class="tr-vc-btns"><div class="tr-vc-btn ans">●<span>GREEN<br>answers</span></div><div class="tr-vc-btn end">●<span>RED<br>ends</span></div><div class="tr-vc-btn mute">🎙<span>MIC<br>tap = mute</span></div></div></div>';
    },
    backup: function () {
      return '<div class="tr-backup">' +
        '<div class="tr-bu-node">📱<b>Your phone</b><span>where photos are taken</span></div><div class="tr-flow-arrow">→</div>' +
        '<div class="tr-bu-node">☁️<b>Cloud backup</b><span>copies itself on Wi-Fi</span></div><div class="tr-flow-arrow">→</div>' +
        '<div class="tr-bu-node">💛<b>Still safe</b><span>even if the phone is lost</span></div></div>' +
        '<p class="tr-panel-note">One copy is luck. <b>Two copies is a plan.</b> Turn backup on once — it works quietly forever after.</p>';
    },
    urlcheck: function () {
      return '<div class="tr-url">' +
        '<div class="tr-url-row good"><span class="tr-lock">🔒</span><code>www.<b>rbc.com</b>/accounts</code><em>✔ The name before .com is exactly the bank</em></div>' +
        '<div class="tr-url-row bad"><span class="tr-lock">🔒</span><code>www.<b>rbc-secure-login.xyz</b></code><em>✘ Different name, odd ending — a look-alike</em></div>' +
        '<div class="tr-url-row bad"><span class="tr-lock">⚠️</span><code>www.<b>rnbc.com</b>/login</code><em>✘ One sneaky letter swapped (rn looks like m)</em></div>' +
        '<p class="tr-panel-note">Read the name <b>right before .ca or .com</b>. A padlock means private — it does <b>not</b> mean honest.</p></div>';
    }
  };

  /* ---------- views ---------- */
  function moduleCard(m) {
    return '<button type="button" class="tr-card" data-mod="' + esc(m.slug) + '">' +
      '<span class="tr-card-ic">' + esc(m.icon) + "</span>" +
      '<span class="tr-card-main"><b>' + m.n + ". " + esc(m.title) + "</b><span>" + esc(m.tagline) + "</span></span>" +
      '<span class="tr-card-go">›</span></button>';
  }

  function indexHtml(data) {
    return '<div class="card tr-intro"><h3 style="margin-top:0;">Training resources</h3>' +
      "<p>" + esc(data.intro) + "</p>" +
      '<p class="tr-intro-note">Each module has a coach sheet for you, a large-print handout to leave with the client, one picture guide, and short videos to watch together.</p></div>' +
      '<div class="tr-grid">' + data.modules.map(moduleCard).join("") + "</div>";
  }

  function videoCard(v) {
    var id = "";
    var mt = /[?&]v=([\w-]{6,})/.exec(v.url || "");
    if (mt) id = mt[1];
    var thumb = id
      ? '<span class="tr-vid-thumb"><img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="" loading="lazy"><span class="tr-vid-play">▶</span></span>'
      : '<span class="tr-vid-thumb tr-vid-notumb"><span class="tr-vid-play">▶</span></span>';
    return '<a class="tr-vid" href="' + esc(v.url) + '" target="_blank" rel="noopener">' + thumb +
      '<span class="tr-vid-meta"><b>' + esc(v.title) + "</b><span>" + esc(v.by || "") +
      (v.mins ? " · " + esc(v.mins) : "") + " · YouTube ↗</span></span></a>";
  }

  function handoutHtml(m) {
    var steps = m.handout.steps.map(function (s, i) {
      return '<li class="tr-step"><span class="tr-step-n">' + (i + 1) + "</span>" +
        '<div><h5>' + esc(s.h) + "</h5><p>" + esc(s.p) + "</p></div></li>";
    }).join("");
    return '<div class="tr-handout" data-handout>' +
      '<div class="tr-handout-head"><span class="tr-ho-brand">TechCare by WilGlobo · Client handout</span>' +
      "<h3>" + esc(m.icon) + " " + esc(m.title) + "</h3>" +
      '<button type="button" class="small secondary tr-print no-print" data-print>🖨 Print this handout</button></div>' +
      '<p class="tr-ho-intro">' + esc(m.handout.intro) + "</p>" +
      '<ol class="tr-steps">' + steps + "</ol>" +
      (m.handout.tips && m.handout.tips.length
        ? '<div class="tr-ho-tips"><h4>Good to know</h4>' + list(m.handout.tips, "tr-list") + "</div>" : "") +
      '<div class="tr-remember">⭐ ' + esc(m.handout.remember) + "</div>" +
      '<p class="tr-ho-foot">Stuck? That\'s what we\'re for. TechCare by WilGlobo — 403-679-3039 · techcares.ca</p></div>';
  }

  function detailHtml(m, data) {
    var panel = PANELS[m.panel.kind] ? PANELS[m.panel.kind]() : "";
    var coach = '<div class="card tr-coach"><h3 style="margin-top:0;">🧑‍🏫 Coach sheet — for the worker</h3>' +
      "<h4>Teaching goals</h4>" + list(m.coach.goals, "tr-list") +
      '<h4>Say it like this</h4><blockquote class="tr-say">' + esc(m.coach.say) + "</blockquote>" +
      "<h4>Common stumbling points</h4>" + list(m.coach.watchFor, "tr-list") +
      "<h4>Teach-back — ask them to show you</h4>" + list(m.coach.teachBack, "tr-list") +
      '<div class="tr-stop"><b>Stop &amp; escalate:</b> ' + esc(m.coach.stopWhen) + "</div></div>";
    var videos = '<div class="card tr-videos"><h3 style="margin-top:0;">🎬 Watch together (short videos)</h3>' +
      (m.videos && m.videos.length
        ? m.videos.map(videoCard).join("")
        : '<p class="tr-intro-note">Explainer video for this module is being produced in-house — teach from the picture guide and handout meanwhile.</p>') +
      "</div>";
    var sources = (m.sources && m.sources.length)
      ? '<div class="card tr-sources"><h3 style="margin-top:0;">Sources</h3>' + list(m.sources, "tr-list") + "</div>" : "";
    return '<button type="button" class="secondary small tr-back no-print" data-back>← All modules</button>' +
      '<div class="tr-detail-head"><span class="tr-card-ic big">' + esc(m.icon) + "</span><div>" +
      "<h2>" + m.n + ". " + esc(m.title) + "</h2><p>" + esc(m.tagline) + '</p></div><span class="tr-mins">' + esc(m.minutes) + "</span></div>" +
      '<div class="card tr-panelcard">' + panel + "</div>" +
      coach + handoutHtml(m) + videos + sources;
  }

  /* ---------- mount ---------- */
  function mount(root) {
    if (!root || root.dataset.tcMounted) return;
    root.dataset.tcMounted = "1";
    var data = window.TC_TRAINING;
    if (!data || !data.modules) {
      root.innerHTML = '<div class="card"><p class="notice show err">Training content failed to load.</p></div>';
      return;
    }
    function showIndex() { root.innerHTML = indexHtml(data); window.scrollTo(0, 0); }
    function showModule(slug) {
      var m = data.modules.filter(function (x) { return x.slug === slug; })[0];
      if (!m) return showIndex();
      root.innerHTML = detailHtml(m, data);
      window.scrollTo(0, 0);
    }
    root.addEventListener("click", function (ev) {
      var card = ev.target.closest("[data-mod]");
      if (card) { showModule(card.getAttribute("data-mod")); return; }
      if (ev.target.closest("[data-back]")) { showIndex(); return; }
      if (ev.target.closest("[data-print]")) {
        document.body.classList.add("tr-printing");
        var done = function () {
          document.body.classList.remove("tr-printing");
          window.removeEventListener("afterprint", done);
        };
        window.addEventListener("afterprint", done);
        setTimeout(done, 1500);
        window.print();
      }
    });
    showIndex();
  }

  window.TechCareTraining = { mount: mount, _esc: esc, _panels: PANELS, _indexHtml: indexHtml, _detailHtml: detailHtml };
})();
