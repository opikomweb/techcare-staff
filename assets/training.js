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
    mouse: function () {
      return '<div class="tr-diagram"><svg viewBox="0 0 340 200" role="img" aria-label="Labelled picture of a computer mouse">' +
        '<ellipse cx="150" cy="98" rx="52" ry="80" fill="#ffffff" stroke="#c7d6ea" stroke-width="2"/>' +
        '<path d="M150 22 v58" stroke="#c7d6ea" stroke-width="2"/>' +
        '<path d="M99 78 h102" stroke="#c7d6ea" stroke-width="2"/>' +
        '<rect x="141" y="34" width="18" height="34" rx="9" fill="#dceeff" stroke="#1758CC" stroke-width="2"/>' +
        '<path d="M150 18 q4 -12 18 -12" fill="none" stroke="#c7d6ea" stroke-width="2"/>' +
        '<circle cx="118" cy="52" r="10" fill="#1758CC"/><text x="118" y="56" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">1</text>' +
        '<circle cx="150" cy="51" r="10" fill="#1758CC"/><text x="150" y="55" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">2</text>' +
        '<circle cx="182" cy="52" r="10" fill="#1758CC"/><text x="182" y="56" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">3</text>' +
        '<g font-size="12" fill="#21314a"><text x="216" y="46">1 · Left button — "do it"</text>' +
        '<text x="216" y="66">2 · Wheel — scroll the page</text>' +
        '<text x="216" y="86">3 · Right button — "options"</text></g>' +
        '<g font-size="11.5" fill="#21314a"><text x="30" y="188">One click opens most things. Two quick clicks open files on the desktop.</text></g>' +
        '</svg><p class="tr-panel-note">Almost everything is the <b>left button</b>. The right button never breaks anything — it just shows a list of choices.</p></div>';
    },
    keyboard: function () {
      var key = function (x, y, w, label, hot) {
        return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="24" rx="5" fill="' + (hot ? "#dceeff" : "#eef3f9") + '" stroke="' + (hot ? "#1758CC" : "#c7d6ea") + '" stroke-width="' + (hot ? 2 : 1) + '"/><text x="' + (x + w / 2) + '" y="' + (y + 16) + '" font-size="10.5" fill="#21314a" text-anchor="middle">' + label + '</text>';
      };
      var badge = function (x, y, n) {
        return '<circle cx="' + x + '" cy="' + y + '" r="8" fill="#1758CC"/><text x="' + x + '" y="' + (y + 4) + '" font-size="10" fill="#fff" text-anchor="middle" font-weight="bold">' + n + '</text>';
      };
      return '<div class="tr-diagram"><svg viewBox="0 0 340 208" role="img" aria-label="Labelled picture of the important keys on a keyboard">' +
        '<rect x="14" y="12" width="312" height="118" rx="10" fill="#ffffff" stroke="#c7d6ea" stroke-width="2"/>' +
        key(24, 24, 44, "Esc", true) + key(76, 24, 30, "Q") + key(112, 24, 30, "W") + key(148, 24, 30, "E") + key(184, 24, 30, "R") + key(220, 24, 30, "T") + key(262, 24, 54, "⌫ Back", true) +
        key(24, 56, 52, "Caps", true) + key(84, 56, 30, "A") + key(120, 56, 30, "S") + key(156, 56, 30, "D") + key(192, 56, 30, "F") + key(228, 56, 30, "G") + key(262, 56, 54, "Enter ↵", true) +
        key(24, 88, 62, "Shift ⇧", true) + key(94, 88, 30, "Z") + key(130, 88, 30, "X") + key(166, 88, 112, "Space — the wide bar", true) + key(284, 88, 32, "← →", true) +
        badge(46, 24, 1) + badge(289, 24, 2) + badge(220, 56, 3) + badge(222, 88, 4) + badge(50, 56, 5) +
        '<g font-size="11.5" fill="#21314a">' +
        '<text x="16" y="152">1 · Esc — back out / cancel</text><text x="180" y="152">2 · Backspace — erase one letter</text>' +
        '<text x="16" y="172">3 · Enter — go / send / new line</text><text x="180" y="172">4 · Space — the big bar, one tap per word gap</text>' +
        '<text x="16" y="192">5 · Caps Lock — ALL CAPITALS on/off (a light shows when it is on — the usual culprit when a password "stops working")</text></g>' +
        '</svg><p class="tr-panel-note">Only a handful of keys matter day to day. If typing looks wrong, check <b>Caps Lock first</b>.</p></div>';
    },
    compose: function () {
      return '<div class="tr-diagram"><svg viewBox="0 0 340 216" role="img" aria-label="Labelled picture of a new email window">' +
        '<rect x="30" y="12" width="280" height="178" rx="10" fill="#ffffff" stroke="#c7d6ea" stroke-width="2"/>' +
        '<rect x="30" y="12" width="280" height="30" rx="10" fill="#1758CC"/><text x="44" y="32" font-size="12" fill="#fff" font-weight="bold">New message</text>' +
        '<text x="44" y="66" font-size="12" fill="#21314a">To:</text><rect x="86" y="54" width="210" height="18" rx="4" fill="#eef3f9"/>' +
        '<text x="44" y="94" font-size="12" fill="#21314a">Subject:</text><rect x="86" y="82" width="210" height="18" rx="4" fill="#eef3f9"/>' +
        '<rect x="44" y="110" width="252" height="44" rx="4" fill="#f7fafd" stroke="#eef3f9"/><text x="52" y="128" font-size="11" fill="#7a8aa0">Write your message here…</text>' +
        '<rect x="44" y="162" width="76" height="20" rx="10" fill="#0087FA"/><text x="82" y="176" font-size="11.5" fill="#fff" text-anchor="middle" font-weight="bold">Send ➤</text>' +
        '<text x="238" y="176" font-size="15" fill="#1758CC">📎</text>' +
        '<circle cx="86" cy="63" r="9" fill="#1758CC"/><text x="86" y="67" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">1</text>' +
        '<circle cx="86" cy="91" r="9" fill="#1758CC"/><text x="86" y="95" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">2</text>' +
        '<circle cx="238" cy="158" r="9" fill="#1758CC"/><text x="238" y="162" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">3</text>' +
        '<circle cx="82" cy="172" r="9" fill="#FE4600"/><text x="82" y="176" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">4</text>' +
        '<g font-size="11.5" fill="#21314a"><text x="30" y="206">1 · Who it goes to   2 · What it is about   3 · 📎 Attach a photo or file   4 · Send</text></g>' +
        '</svg><p class="tr-panel-note">Four parts, always in the same order: <b>To → Subject → write → Send</b>. The paperclip 📎 is how photos and documents ride along.</p></div>';
    },
    router: function () {
      var light = function (x, label, color, n) {
        return '<circle cx="' + x + '" cy="86" r="9" fill="' + color + '"/><text x="' + x + '" y="112" font-size="9.5" fill="#21314a" text-anchor="middle">' + label + '</text>' +
          '<circle cx="' + x + '" cy="60" r="8" fill="#1758CC"/><text x="' + x + '" y="64" font-size="10" fill="#fff" text-anchor="middle" font-weight="bold">' + n + '</text>';
      };
      return '<div class="tr-diagram"><svg viewBox="0 0 340 226" role="img" aria-label="Labelled picture of a home internet router and its lights">' +
        '<rect x="52" y="66" width="236" height="58" rx="10" fill="#21314a"/>' +
        '<rect x="70" y="30" width="6" height="38" rx="3" fill="#21314a"/><rect x="264" y="30" width="6" height="38" rx="3" fill="#21314a"/>' +
        light(96, "Power", "#37c978", 1) + light(150, "Internet", "#37c978", 2) + light(204, "Wi-Fi", "#37c978", 3) + light(252, "Devices", "#37c978", 4) +
        '<g font-size="11.5" fill="#21314a">' +
        '<text x="16" y="146">1 · Power — on means the box has power</text>' +
        '<text x="16" y="166">2 · Internet — steady light = connected to your provider</text>' +
        '<text x="16" y="186">3 · Wi-Fi — blinking is normal; it means talking to your devices</text>' +
        '<text x="16" y="206">4 · Devices — lights for things plugged in with a cable</text></g>' +
        '</svg><p class="tr-panel-note">Internet light <b>off or red</b>? Unplug the box, count to 30, plug it back in, wait a full 2 minutes. Still red — the problem is your provider\'s, and it is fine to call them (or us).</p></div>';
    },
    wifidata: function () {
      return '<div class="tr-diagram"><svg viewBox="0 0 340 190" role="img" aria-label="Wi-Fi compared with mobile data on a phone">' +
        '<rect x="30" y="14" width="120" height="150" rx="12" fill="#ffffff" stroke="#c7d6ea" stroke-width="2"/>' +
        '<path d="M62 62 a40 40 0 0 1 56 0" fill="none" stroke="#0087FA" stroke-width="5" stroke-linecap="round"/><path d="M72 76 a26 26 0 0 1 36 0" fill="none" stroke="#0087FA" stroke-width="5" stroke-linecap="round"/><circle cx="90" cy="90" r="5" fill="#0087FA"/>' +
        '<text x="90" y="126" font-size="12" fill="#21314a" text-anchor="middle" font-weight="bold">Wi-Fi</text>' +
        '<text x="90" y="144" font-size="10.5" fill="#21314a" text-anchor="middle">at home = included,</text><text x="90" y="158" font-size="10.5" fill="#21314a" text-anchor="middle">no data used</text>' +
        '<rect x="190" y="14" width="120" height="150" rx="12" fill="#ffffff" stroke="#c7d6ea" stroke-width="2"/>' +
        '<g stroke="#FE4600" stroke-width="5" stroke-linecap="round"><line x1="228" y1="92" x2="228" y2="52"/><line x1="242" y1="92" x2="242" y2="64"/><line x1="256" y1="92" x2="256" y2="76"/><line x1="270" y1="92" x2="270" y2="86"/></g>' +
        '<text x="250" y="126" font-size="12" fill="#21314a" text-anchor="middle" font-weight="bold">Mobile data (LTE / 5G)</text>' +
        '<text x="250" y="144" font-size="10.5" fill="#21314a" text-anchor="middle">away from home = counts</text><text x="250" y="158" font-size="10.5" fill="#21314a" text-anchor="middle">against your phone plan</text>' +
        '</svg><p class="tr-panel-note">The <b>fan shape means free</b> (your home internet). The <b>bars with LTE/5G</b> mean your phone plan\'s data — fine for maps and messages, costly for long videos.</p></div>';
    },
    speed: function () {
      var row = function (y, w, label, need, color) {
        return '<rect x="16" y="' + y + '" width="' + w + '" height="22" rx="6" fill="' + color + '"/><text x="24" y="' + (y + 15) + '" font-size="11.5" fill="#fff" font-weight="bold">' + label + '</text><text x="' + (24 + w) + '" y="' + (y + 15) + '" font-size="11.5" fill="#21314a">' + need + '</text>';
      };
      return '<div class="tr-diagram"><svg viewBox="0 0 340 176" role="img" aria-label="How much internet speed everyday activities need">' +
        row(14, 74, "Email, news", "≈ 5 Mbps", "#0087FA") +
        row(46, 108, "Video call with family", "≈ 10 Mbps", "#0087FA") +
        row(78, 150, "Movie in HD", "≈ 25 Mbps", "#1758CC") +
        row(110, 205, "4K movie, or several people at once", "≈ 50–100 Mbps", "#1758CC") +
        '<text x="16" y="158" font-size="11.5" fill="#21314a">Most one- or two-person senior homes are happy at 25–75 Mbps.</text>' +
        '</svg><p class="tr-panel-note">Speed is sold in "Mbps". Buying 500 or 1,000 Mbps for email and one TV is like buying a bus to go grocery shopping — <b>it works, but you pay for seats you never use</b>.</p></div>';
    },
    bill: function () {
      return '<div class="tr-diagram"><svg viewBox="0 0 340 236" role="img" aria-label="Labelled picture of a typical internet and phone bill">' +
        '<rect x="66" y="10" width="208" height="168" rx="8" fill="#ffffff" stroke="#c7d6ea" stroke-width="2"/>' +
        '<rect x="66" y="10" width="208" height="26" rx="8" fill="#1758CC"/><text x="80" y="28" font-size="12" fill="#fff" font-weight="bold">Your monthly bill</text>' +
        '<g font-size="11" fill="#21314a">' +
        '<text x="80" y="58">Internet plan</text><text x="248" y="58" text-anchor="end">$85.00</text>' +
        '<text x="80" y="80">Promo discount (ends Mar 2027!)</text><text x="248" y="80" text-anchor="end">−$25.00</text>' +
        '<text x="80" y="102">Box rental (modem)</text><text x="248" y="102" text-anchor="end">$10.00</text>' +
        '<text x="80" y="124">TV package add-on</text><text x="248" y="124" text-anchor="end">$28.00</text>' +
        '<text x="80" y="146">Home phone</text><text x="248" y="146" text-anchor="end">$15.00</text>' +
        '<text x="80" y="166" font-weight="bold">Total</text><text x="248" y="166" text-anchor="end" font-weight="bold">$113 + tax</text></g>' +
        '<circle cx="66" cy="69" r="9" fill="#FE4600"/><text x="66" y="73" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">1</text>' +
        '<circle cx="66" cy="102" r="9" fill="#1758CC"/><text x="66" y="106" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">2</text>' +
        '<circle cx="66" cy="135" r="9" fill="#1758CC"/><text x="66" y="139" font-size="11" fill="#fff" text-anchor="middle" font-weight="bold">3</text>' +
        '<g font-size="11.5" fill="#21314a">' +
        '<text x="16" y="198">1 · Circle the END DATE of every discount — the bill jumps when it expires</text>' +
        '<text x="16" y="216">2 · Rentals and add-ons are where bills quietly grow   3 · Anything you don\'t use can go</text></g>' +
        '</svg><p class="tr-panel-note">Bring your last two bills to a visit. We read them line by line together and mark anything you are <b>paying for but not using</b>.</p></div>';
    },
    switchsteps: function () {
      return '<div class="tr-backup">' +
        '<div class="tr-bu-node">🗓️<b>1 · Check</b><span>contract end date + any fees</span></div><div class="tr-flow-arrow">→</div>' +
        '<div class="tr-bu-node">🔍<b>2 · Choose</b><span>the new plan that fits</span></div><div class="tr-flow-arrow">→</div>' +
        '<div class="tr-bu-node">🔢<b>3 · They move your number</b><span>the NEW provider does it</span></div><div class="tr-flow-arrow">→</div>' +
        '<div class="tr-bu-node">✅<b>4 · Test</b><span>then cancel / return old box</span></div></div>' +
        '<p class="tr-panel-note"><b>Never cancel the old service first.</b> If you cancel before the switch, you can lose your phone number. The new provider moves everything — you just say yes.</p>';
    },
    rights: function () {
      return '<div class="tr-url">' +
        '<div class="tr-url-row good"><span class="tr-lock">✔</span><code>You can <b>cancel anytime</b></code><em>For phone contracts, the most you can owe is the unpaid balance of your phone — not big penalties</em></div>' +
        '<div class="tr-url-row good"><span class="tr-lock">✔</span><code>You keep <b>your number</b></code><em>Switching companies does not change your phone number</em></div>' +
        '<div class="tr-url-row good"><span class="tr-lock">✔</span><code>You get a <b>trial period</b></code><em>15 days to change your mind on a new phone contract — 30 days if you have a disability</em></div>' +
        '<div class="tr-url-row good"><span class="tr-lock">✔</span><code>Your phone must be <b>unlocked</b></code><em>Free — so it can work with any company</em></div>' +
        '<div class="tr-url-row good"><span class="tr-lock">✔</span><code>There is a <b>free complaints office</b></code><em>The CCTS (ccts-cprst.ca · 1-888-221-1687) if the company won\'t fix a billing problem</em></div>' +
        '<p class="tr-panel-note">These are Canadian rules (the CRTC\'s Internet and Wireless Codes). A company that says otherwise is wrong — write down what they said and tell us.</p></div>';
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
      '<p class="tr-intro-note">Each module has a coach sheet for you, a large-print handout to leave with the client, picture guides, and short videos to watch together.</p></div>' +
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
    var kinds = m.panels && m.panels.length ? m.panels : (m.panel ? [m.panel.kind] : []);
    var panel = kinds.map(function (k) { return PANELS[k] ? PANELS[k]() : ""; }).filter(Boolean).join('<div style="height:10px"></div>');
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
