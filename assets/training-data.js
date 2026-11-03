/* TechCare Training Resources — content pack (source of truth).
   Plain-language coaching modules for Calgary seniors + the workers who
   teach them. Mirrored in markdown at
   techcare-operations/files/training-resources/.
   Videos: every URL below was opened and verified (title, channel,
   duration) before being listed — see `verified` dates in README.md. */
window.TC_TRAINING = {
  intro: "Ten short lessons for everyday tech. Teach one module at a time, let the client do the clicking, and leave the printed handout behind.",
  modules: [
    {
      n: 1, slug: "computer-basics", icon: "🖥️", title: "Computer basics",
      tagline: "Turning on, clicking around, and opening programs — calmly.",
      minutes: "15–20 minutes of a visit",
      coach: {
        goals: [
          "Client can turn the computer on and off the safe way",
          "Client can use the mouse (or touchpad) without fear — click, double-click, scroll",
          "Client can find and open one program they use, and close it again",
          "Client knows the desktop is just a table top: things sit on it, nothing breaks"
        ],
        say: "Try this framing: “Think of the computer like a kitchen. The desktop is the counter where you keep the things you use most. Programs are appliances — you turn one on when you need it, and turn it off when you're done. Tapping and clicking can't break anything. The worst that happens is we close it and start again.”",
        watchFor: [
          "Double-clicking everything (most things need one click; files and programs on the desktop need two)",
          "Holding the power button to shut down — teach Start menu → Power → Shut down instead",
          "Fear of the “wrong click” — narrate that almost everything can be undone or closed",
          "Mouse speed too fast — slow it down in Settings if they keep overshooting"
        ],
        teachBack: [
          "“Show me how you'd turn it on and open your email.”",
          "“If you clicked something by mistake, show me how you'd close it.” (the X, top corner)",
          "“Where would you look for a program you can't see?” (Start menu / search)"
        ],
        stopWhen: "Stop and reassure if the client gets flustered — two or three new ideas per visit is plenty. If the machine itself is misbehaving (very slow, strange pop-ups), switch to troubleshooting and flag it on the job notes."
      },
      panel: { kind: "computer" },
      handout: {
        intro: "Your computer is hard to break. Clicking something by mistake is fine — you can always close it and start again. Go slowly. Nothing is in a hurry.",
        steps: [
          { h: "Turning it on", p: "Press the power button once — a short press, don't hold it. Wait a minute or two. A picture or your name will appear. If it asks for a PIN or password, type it and press Enter." },
          { h: "Turning it off the safe way", p: "Click the Start button (bottom-left corner, looks like a window). Click Power, then Shut down. Never just hold the power button — that is only for emergencies." },
          { h: "Using the mouse", p: "Rest your hand on the mouse and move it — the arrow on screen follows. One click chooses something. Two quick clicks (double-click) open things on the desktop. The little wheel rolls the page up and down." },
          { h: "Opening a program", p: "Double-click its picture on the desktop, or click Start and find its name in the list. A window opens — that is the program, ready to use." },
          { h: "Closing a program", p: "Click the X in the top-right corner of its window. Closing a window never deletes anything — the program is still there for next time." },
          { h: "If the screen freezes", p: "Wait one full minute — computers often catch up. If nothing moves, hold the power button for 10 seconds to force it off, wait 30 seconds, and turn it on again. Then tell us at your next visit." }
        ],
        tips: [
          "The desktop is the “counter top” you see first. Pictures on it are shortcuts — the real thing lives inside the computer.",
          "Laptop instead? The flat pad below the keyboard does the mouse's job. Slide one finger to move the arrow, tap once to click.",
          "Bigger text: hold the Ctrl key and tap + a few times. Ctrl and – makes it smaller again."
        ],
        remember: "One click chooses. Two clicks open. The X closes. You can't break it by clicking."
      },
      videos: [
              {
                      "title": "Windows Basics: Getting Started with the Desktop",
                      "by": "GCFGlobal / LearnFree",
                      "mins": "",
                      "url": "https://www.youtube.com/watch?v=_jvp61NwGT8"
              },
              {
                      "title": "Computer Basics: Buttons and Ports on a Computer",
                      "by": "GCFGlobal / LearnFree",
                      "mins": "about 2 min",
                      "url": "https://www.youtube.com/watch?v=yq9qzw8p7FI"
              }
      ]
    },
    {
      n: 2, slug: "email-basics", icon: "✉️", title: "Email basics",
      tagline: "Reading, replying, writing, and clearing out the junk.",
      minutes: "15–20 minutes of a visit",
      coach: {
        goals: [
          "Client can open the inbox and read a message",
          "Client can reply to a message",
          "Client can write and send a brand-new email, including an address, a subject, and a message",
          "Client can attach one photo and delete junk mail confidently"
        ],
        say: "Frame email as paper mail that arrives instantly: “The inbox is your mailbox. The sender's name is on the envelope, the subject line is what's written on the outside, and Reply is writing back on the same card. Junk mail goes straight in the bin here too — that's what Delete is for.”",
        watchFor: [
          "Tapping Reply All when they mean Reply — show the difference once, kindly",
          "Emails that look like they're from the bank or CRA — teach them to never click links in those (see Module 4)",
          "Hundreds of unread junk messages burying real mail — sort by sender together and delete in batches",
          "Attachments: they may fear opening any; teach that photos/PDFs from people they know are fine, surprises are not"
        ],
        teachBack: [
          "“Show me how you'd write a new email to your daughter.”",
          "“This message is junk. Show me how you'd get rid of it.”",
          "“How would you send me that photo of the garden?”"
        ],
        stopWhen: "If you find messages the client can't identify asking for money, passwords, or gift cards, stop teaching and switch to Module 4 (scams) — flag it on the job notes."
      },
      panel: { kind: "inbox" },
      handout: {
        intro: "Email is just mail that arrives in seconds. These steps work in Gmail, Outlook, and most other email programs — the buttons may sit in slightly different spots, but the names are the same.",
        steps: [
          { h: "Reading your mail", p: "Open your email program. Your Inbox lists your messages, newest first. Click a message once to read it. Bold messages are unread. Use the scroll wheel (or slide a finger) to read to the bottom." },
          { h: "Replying", p: "With the message open, click Reply. The address is filled in for you. Click in the big white box, type your answer, then click Send. The other person gets it right away." },
          { h: "Writing a new email", p: "Click New message (or Compose). In the To box, type the person's email address — it must be exact, like mary.smith@gmail.com. Add a Subject — a few words about what it's about. Type your message in the big box, then click Send." },
          { h: "Adding a photo (attachment)", p: "While writing, click the paperclip 📎. Find your photo (Pictures folder is a good first guess), click it, then Open. You'll see the photo's name under your message. Now click Send." },
          { h: "Deleting junk", p: "Click the little square beside messages you don't want, then click Delete (trash can). Gone for good after 30 days. Mail from stores you never signed up for? Delete it — you don't need to open it first." },
          { h: "Staying safe", p: "Never click links or open attachments in messages you weren't expecting — even if they look like your bank, Canada Post, or the CRA. Real mail from people you know is fine. When in doubt, call the person and ask. (See the Scams handout.)" }
        ],
        tips: [
          "Reply = answer that person. Reply All = answer everyone who got the message. When unsure, choose Reply.",
          "Sent mail is saved in the Sent folder — handy proof of what you wrote.",
          "Made a typo in an address? The email bounces back to you with a notice. Nothing bad happens — just fix the address and resend."
        ],
        remember: "New message → address, subject, message → Send. Junk goes in Delete, no opening needed."
      },
      videos: []
    },
    {
      n: 3, slug: "passwords", icon: "🔑", title: "Passwords made simple",
      tagline: "Strong passwords you can actually remember — and keep safe.",
      minutes: "15 minutes of a visit",
      coach: {
        goals: [
          "Client understands a passphrase (3–4 random words) beats a short complicated password",
          "Client has ONE safe system: a written password book kept at home, or a password manager — their choice",
          "Client knows the two golden rules: a different password for email and banking, and never share a texted code with anyone",
          "Client knows TechCare will never ask for their password or a code"
        ],
        say: "Keep it concrete: “A password is the key to a door. Short keys are easy to copy, so we use a long one made of plain words — like purple-tiger-river-7. It's long, so it's strong, and it's made of real words, so you can remember it. And we never use the house key for the bank — your email and your banking each get their own.”",
        watchFor: [
          "One password reused everywhere (especially email = banking) — fix email and banking first if time is short",
          "Passwords on sticky notes stuck to the monitor — move them into a book kept in a drawer instead",
          "Family members or callers asking for codes — rehearse the sentence “I don't share codes. I'll call you back.”",
          "Confusing the computer's login PIN with account passwords — draw the difference on paper"
        ],
        teachBack: [
          "“Tell me in your own words why 'fluffy2019' is weak but 'purple-tiger-river-7' is strong.”",
          "“Someone phones saying they're from your bank and asks for the code that was just texted to you. What do you do?”",
          "“Where will your passwords live from now on?”"
        ],
        stopWhen: "Never write a client's real passwords into job notes, texts, or this portal. If you set up a password manager, the client types the master password themselves. If you suspect an account is already compromised, escalate to Wilton the same day."
      },
      panel: { kind: "passphrase" },
      handout: {
        intro: "A good password is long and easy for YOU to remember — not short and hard. Real words strung together beat scrambled symbols every time.",
        steps: [
          { h: "Make a passphrase", p: "Pick 3 or 4 words that don't normally go together, and join them: purple-tiger-river-7, coffee-garden-train-42, maple-sled-otter-9. Length is what makes it strong — 15 letters or more." },
          { h: "Use a different one for email and banking", p: "Your email and your bank each get their very own passphrase — never the same. If one is ever stolen, the other stays safe. Other accounts can share a second passphrase if you must." },
          { h: "Keep them in ONE safe place", p: "A small notebook kept in a drawer at home is fine — burglars are not after passwords, hackers are, and hackers can't reach a paper book. Or ask us about a password manager: one master passphrase remembers all the rest." },
          { h: "Never share a code", p: "Banks, the CRA, the police, and TechCare will NEVER phone or text asking for a code, a password, or your PIN. If anyone asks — for any reason — hang up. It is always a scam. (See the Scams handout.)" },
          { h: "Let the computer remember the small stuff", p: "It's fine for your browser to remember passwords for shopping and news sites on your home computer. Keep email and banking typed by hand, or in your password manager." }
        ],
        tips: [
          "Changing a weak password? Add a word before you change the whole thing: purple-tiger-river-lake-7 is stronger than starting over with something you'll forget.",
          "Two-step verification (a code texted to your phone) is a good second lock on email and banking — ask us to help turn it on.",
          "Forgot a password? Use “Forgot password” on the real website and follow the email it sends you. Never pay a stranger who offers to “recover” it."
        ],
        remember: "Long words, different for email and banking, written in one safe place. Codes are for your eyes only — always."
      },
      videos: [
              {
                      "title": "Get Cyber Safe | Create a strong password",
                      "by": "Get Cyber Safe · Government of Canada",
                      "mins": "2:49",
                      "url": "https://www.youtube.com/watch?v=YeUFL3GTFT0"
              },
              {
                      "title": "Get Cyber Safe | Password Manager",
                      "by": "Get Cyber Safe · Government of Canada",
                      "mins": "",
                      "url": "https://www.youtube.com/watch?v=tthbSeHagDc"
              }
      ]
    },
    {
      n: 4, slug: "scams", icon: "🛡️", title: "Staying protected from scams",
      tagline: "Spot the tricks, slow down, and check — every single time.",
      minutes: "20 minutes of a visit — the most important module",
      coach: {
        goals: [
          "Client can name the four big local scams: CRA/government, “grandchild in trouble”, bank “investigator”, and fake tech support",
          "Client can spot the shared red flags: urgency, secrecy, unusual payment (gift cards, crypto, wire, courier cash), threats",
          "Client has a plan and says it out loud: hang up, call the real number, ask family first",
          "Client knows where to report: Canadian Anti-Fraud Centre, 1-888-495-8501"
        ],
        say: "Anchor it in one sentence: “Scammers sell fear and hurry. Real organizations never need you to panic.” Walk through the red-flag panel together, then role-play: you phone pretending to be “the CRA” — let them practise hanging up and calling a family member. Practising once, kindly, builds the reflex.",
        watchFor: [
          "Shame — clients who have already sent money may hide it. Say plainly: it happens to smart people, and reporting quickly helps",
          "AI voice cloning: a familiar voice is no longer proof — teach a family code word or a personal question only the real person knows",
          "Caller ID means nothing (numbers can be faked), and courts never send couriers to collect bail cash",
          "“Tech support” pop-ups with a phone number are always fake — real companies never lock your screen and ask you to call"
        ],
        teachBack: [
          "“A caller says your grandson is in jail and needs bail money by courier, and not to tell his parents. Walk me through what you do.”",
          "“Your bank texts: 'Suspicious charge — click here.' What's your next move?” (Open the bank's own app or call the number on the card — never the link.)",
          "“Who do you call to report a scam?” (Canadian Anti-Fraud Centre, 1-888-495-8501.)"
        ],
        stopWhen: "If the client has sent money or shared banking details recently, stop teaching: help them call their bank's real number now, then local police (non-emergency) and the Anti-Fraud Centre, and escalate to Wilton the same day. Note only facts on the job record — never account numbers."
      },
      panel: { kind: "redflags" },
      handout: {
        intro: "Scammers are professional actors. They sound official, kind, or terrified — on purpose. Your protection is simple: slow down and check. Nothing genuine is ever ruined by waiting a day.",
        steps: [
          { h: "The CRA / government scam", p: "A call, text, or email says you owe taxes, your SIN is “compromised”, or you'll be arrested. THE TRUTH: The CRA never threatens arrest by phone, never demands gift cards, crypto, or wire transfers, and never asks for passwords by text or email. Hang up. If you're worried, call the CRA at the number on their real website or on your tax papers." },
          { h: "The “grandchild in trouble” scam", p: "“Grandma? It's me — I'm in trouble, please don't tell Mom.” Then a “lawyer” asks for bail money, sometimes collected by a courier. THE TRUTH: courts never send couriers for cash. Hang up and call your grandchild — or their parents — at the number you already have. Ask a question only the real person could answer." },
          { h: "The bank “investigator” scam", p: "“This is your bank's fraud department. Your account is compromised — move your money to a safe account / don't tell the teller.” THE TRUTH: no bank will ever ask you to move money, withdraw cash for an investigation, or lie to bank staff. Hang up and call the number on the back of your bank card." },
          { h: "The fake tech-support scam", p: "A pop-up freezes your screen: “VIRUS DETECTED — call Microsoft now”, or a stranger phones about “your computer”. THE TRUTH: real companies never do this. Don't call the number. Hold the power button 10 seconds to shut down, wait, restart. If money was requested, it was a scam — close the page." },
          { h: "Phishing texts and emails", p: "“Your package couldn't be delivered”, “Your Netflix payment failed”, “Click to claim your refund”. THE TRUTH: the link leads to a fake page that steals passwords. Never click. Go to the real website or app yourself, the way you normally would." },
          { h: "If you're ever unsure — the 3-step rule", p: "1) STOP — hang up or put the message down. 2) BREATHE — urgency is the trick; real problems wait. 3) CHECK — call the real number (on your card, bill, or tax papers) or ask a family member first. Then report it: Canadian Anti-Fraud Centre, 1-888-495-8501." }
        ],
        tips: [
          "Set a family code word. If a “grandchild” calls in a panic, ask for the word. No word, no money — hang up and check.",
          "A familiar voice can be faked by computer now. Voice alone is not proof — the code word and a call-back are.",
          "Keep this handout by the phone. Reading the red flags out loud to a caller is a perfectly good way to end the call.",
          "Free reading: “The Little Black Book of Scams” (Competition Bureau Canada) — a short, friendly booklet listing the 12 most common scams. Ask us and we'll print one for you."
        ],
        remember: "Urgent + secret + strange payment = scam. Hang up, breathe, check with the real number."
      },
      videos: [
              {
                      "title": "Emergency scams",
                      "by": "Competition Bureau Canada",
                      "mins": "1:24",
                      "url": "https://www.youtube.com/watch?v=yThlYtjnF7w"
              },
              {
                      "title": "The Little Black Book of Scams: Service Scams",
                      "by": "Competition Bureau Canada",
                      "mins": "2:03",
                      "url": "https://www.youtube.com/watch?v=gffwF2GsESk"
              }
      ],
      sources: [
        "Canadian Anti-Fraud Centre — antifraudcentre-centreantifraude.ca · 1-888-495-8501 (report fraud)",
        "Competition Bureau Canada — “The Little Black Book of Scams”, 2nd edition (2018), via ised-isde.canada.ca"
      ]
    },
    {
      n: 5, slug: "phone-apps", icon: "📱", title: "Phone apps, safely",
      tagline: "Getting apps from the one safe place — and removing the rest.",
      minutes: "15 minutes of a visit",
      coach: {
        goals: [
          "Client can open the official store (App Store on iPhone, Play Store on Android) and find an app by name",
          "Client can check an app before installing: who made it, star rating, number of downloads, recent reviews",
          "Client can update apps and delete an app they don't want",
          "Client knows the rule: never install an app from a text, email, pop-up, or a caller"
        ],
        say: "Use the shop analogy: “Apps come from one official shop — the App Store or Play Store. It's like buying medicine from the pharmacy instead of from a stranger's trunk. Same app name can appear in both places, but only the shop copy is checked. If a text message ever offers you an app, that's the stranger's trunk.”",
        watchFor: [
          "Look-alike apps with similar names/logos — check the maker/publisher line together",
          "Permission surprises (a flashlight app wanting contacts) — teach “if it doesn't make sense, don't install”",
          "Auto-renewing free trials — check Subscriptions together if they mention charges",
          "Side-loaded apps a family member or scammer installed — remove anything they can't identify, and flag scam-linked ones on the job notes"
        ],
        teachBack: [
          "“Show me where apps come from on your phone.”",
          "“Before installing, what three things will you check?” (maker, stars, downloads/reviews)",
          "“Show me how you'd delete an app you don't use.”"
        ],
        stopWhen: "If you find remote-access apps (AnyDesk, TeamViewer) the client doesn't recognize or that a “support” caller had them install, treat it as a scam indicator: remove them, and escalate per Module 4 before continuing."
      },
      panel: { kind: "stores" },
      handout: {
        intro: "Apps (programs for your phone) come from one official shop on your phone. That shop checks what it sells. Everywhere else is risky — no exceptions.",
        steps: [
          { h: "Open the shop", p: "iPhone: tap App Store (blue with a white “A”). Android: tap Play Store (white bag with a coloured triangle). This is the only place to get apps." },
          { h: "Find an app", p: "Tap Search (magnifying glass), type the app's exact name, and tap Search. Several look-alikes may appear — that's normal. Slow down for the next step." },
          { h: "Check before you install", p: "Look at three things: the MAKER (it should be the real company — e.g., a banking app made by the bank), the STARS (4 stars or more is a good sign), and DOWNLOADS (lots of people using it). If anything feels off, don't install — ask us first." },
          { h: "Install", p: "Tap Get (iPhone) or Install (Android). You may need your Apple ID or Google password, or your fingerprint/face. Wait for it to finish, then tap Open." },
          { h: "Keep apps updated", p: "In the shop, tap your picture (top corner), then look for Update All. Updates fix holes that scammers use. Turning on automatic updates means you never have to think about it — ask us to switch it on." },
          { h: "Delete an app", p: "Press and hold the app's picture until a menu pops up. Tap Remove App (iPhone) or Uninstall (Android). Deleting is safe — you can always get it again from the shop." }
        ],
        tips: [
          "Never install an app from a text message, email, website pop-up, or anyone who phones you. Real companies will always send you to the shop instead.",
          "An app that asks for things it doesn't need — a flashlight wanting your contacts — is a bad sign. Delete it.",
          "“Free” apps that suddenly ask for payment details for a “trial” will charge when the trial ends. Check Subscriptions in the shop if a surprise charge appears."
        ],
        remember: "Apps only from the official shop. Check the maker, the stars, the downloads. Texts never sell apps."
      },
      videos: [
              {
                      "title": "How to Download & Install WhatsApp Mobile App (Full Guide)",
                      "by": "Tech Life Unity",
                      "mins": "",
                      "url": "https://www.youtube.com/watch?v=we938IpxCkA"
              },
              {
                      "title": "How to Use ChatGPT on Your Phone: A Gentle Guide for Complete Beginners",
                      "by": "Tech Without Tears",
                      "mins": "",
                      "url": "https://www.youtube.com/watch?v=ZMRQlO0TKxE"
              }
      ]
    },
    {
      n: 6, slug: "printing", icon: "🖨️", title: "Printing without the headache",
      tagline: "Printing from a computer or phone, and the four checks when it won't.",
      minutes: "10–15 minutes of a visit",
      coach: {
        goals: [
          "Client can print a page from the computer (Ctrl+P / File → Print, choose the printer, check the preview)",
          "Client can print one photo or page from their phone",
          "Client can run the four checks in order when nothing prints: power & paper, Wi-Fi, the right printer, the queue"
        ],
        say: "Demystify the queue: “Printing is like mailing a letter. Your computer puts the page in an outbox — the print queue. The printer collects from the outbox one page at a time. Most 'broken printer' problems are a letter stuck in the outbox, or the printer quietly off or out of paper.”",
        watchFor: [
          "Five copies of the same page queued from repeated clicking — clear the queue together once",
          "Two similar printer names (an old one and the real one) — set the right one as default",
          "Printer asleep vs off vs unplugged — the little power light is the first clue",
          "Ink warnings that block printing even for black-and-white on some models — note the model in job notes if it recurs"
        ],
        teachBack: [
          "“Show me how you'd print this email.”",
          "“Nothing printed. Talk me through your four checks.”",
          "“How can you tell the page will look right before you print?” (the preview)"
        ],
        stopWhen: "If the printer shows hardware errors (grinding, flashing error codes) or repeated paper jams, stop the lesson and log it as a repair item rather than wrestling with it."
      },
      panel: { kind: "printflow" },
      handout: {
        intro: "Printing feels mysterious, but it's a simple chain: you send a page, it waits in line, the printer prints it. When nothing happens, one link in the chain needs attention — usually the first one.",
        steps: [
          { h: "Print from a computer", p: "Open what you want to print. Hold Ctrl and tap P (or click File, then Print). Check the preview looks right, make sure YOUR printer's name is chosen, then click Print." },
          { h: "Print from a phone", p: "Open the photo or page. Tap Share (a square with an arrow), then Print. Choose your printer and tap Print. Phone and printer must be on the same Wi-Fi." },
          { h: "Check 1 — Power and paper", p: "Is the printer's light on? Is there paper, loaded straight? Is a lid or tray half-open? Fix and wait a minute — printers wake up slowly." },
          { h: "Check 2 — Wi-Fi", p: "Most home printers use Wi-Fi. If your internet was down or the router restarted, the printer may have lost its connection. Turning the printer off, counting to 30, and turning it on again fixes this surprisingly often." },
          { h: "Check 3 — The right printer", p: "On the print screen, read the printer's name. Computers often list an old printer or “Print to PDF”. Pick the one that matches the machine in your home." },
          { h: "Check 4 — The waiting line (queue)", p: "On the computer, search for “Printers” in Settings and open your printer's queue. If an old job says Error, cancel it — one stuck page blocks everything behind it. Then print one test page." }
        ],
        tips: [
          "Click Print once, then wait. Printers think before they move — five clicks means five copies.",
          "Save ink: for everyday pages, choose “Black & white” or “Draft” in the print window.",
          "Printing a boarding pass or ticket? Print two copies — one for your bag, one for the fridge. Low-tech backup, zero stress."
        ],
        remember: "Power & paper, Wi-Fi, right printer, stuck queue — in that order. Click Print once and wait."
      },
      videos: [
              {
                      "title": "Word 2013: Printing Documents",
                      "by": "GCFLearnFree",
                      "mins": "2:02",
                      "url": "https://www.youtube.com/watch?v=L7qB3cP6euA"
              },
              {
                      "title": "How to fix an HP printer that only prints in color ink",
                      "by": "HP Support",
                      "mins": "about 6 min",
                      "url": "https://www.youtube.com/watch?v=1vnHpazqH5Q"
              }
      ]
    },
    {
      n: 7, slug: "documents-files", icon: "📄", title: "Opening & saving documents",
      tagline: "PDFs, Word files, and finding things again without the hunt.",
      minutes: "15 minutes of a visit",
      coach: {
        goals: [
          "Client can open a PDF and a Word document, and knows the programs remember recent files",
          "Client knows the three home folders: Documents (kept things), Downloads (things that just arrived), Pictures",
          "Client can save a document with a name they'll recognize, and find it again two ways (Recent, and Search)"
        ],
        say: "The filing-cabinet analogy works: “Downloads is the front step — every parcel lands there. Documents is the filing cabinet — where things you care about live. Nothing is wrong with the front step, but you wouldn't store your tax papers there.” Then practise one full trip: download → open → save-as into Documents with a real name.",
        watchFor: [
          "Attachments saved nowhere-findable because defaults were never shown — open File Explorer/Finder together and favourite the main folders",
          "File names like 'document(47).pdf' — teach the rename habit at save time",
          "Scare-ware 'your PDF reader is out of date' pop-ups — real updates never arrive as web-page warnings (ties to Module 4)",
          "Double-extension trick files (invoice.pdf.exe) in email attachments — do not open; see Module 4"
        ],
        teachBack: [
          "“Your bank statement just downloaded. Where is it right now, and how do you open it?”",
          "“Move it into your filing cabinet and give it a name Future-You will understand.”",
          "“Show me two ways to find a file you saved last week.”"
        ],
        stopWhen: "If important folders are a true maze (thousands of unsorted files), don't attempt a full reorganization inside a teaching visit — agree a simple folder set, move today's files, and book it as its own job if they want the rest done."
      },
      panel: { kind: "folders" },
      handout: {
        intro: "Every file on your computer lives in a folder, like papers in a filing cabinet. Once you know the three main folders, you can find almost anything.",
        steps: [
          { h: "Opening a PDF", p: "PDFs are the most common document — bank statements, tickets, forms. Double-click one and it opens in a reader program. Scroll with the wheel. To print it, hold Ctrl and tap P." },
          { h: "Opening a Word document", p: "Double-click it and Word (or a free look-alike) opens. You can read it without changing anything. If you do change it, remember to save (Ctrl + S) before closing." },
          { h: "Meet the three folders", p: "DOWNLOADS: everything that arrives from the internet lands here first. DOCUMENTS: your filing cabinet — things you keep. PICTURES: photos from your phone and camera. Find them in File Explorer (the yellow folder on the taskbar) or Finder on a Mac." },
          { h: "Saving with a good name", p: "When you save, choose Documents as the place, and name it like a folder label: 'House insurance 2026' beats 'document3'. Future-You will say thank you." },
          { h: "Finding a file again — way 1: Recent", p: "Open the program you used (Word, your PDF reader) and look for Recent or Open Recent. Your last files are listed, newest first." },
          { h: "Finding a file again — way 2: Search", p: "Click the magnifying glass near Start (or the top-right of Finder on a Mac) and type a word from the file's name. Wait a few seconds — the computer looks everywhere." }
        ],
        tips: [
          "Something arrived as an email attachment? Open it to read, then use Save As to file it in Documents — attachments are hard to find again inside old emails.",
          "One folder per big topic (Taxes, House, Health, Family) inside Documents keeps the cabinet tidy without any fuss.",
          "Never open files ending in .exe that arrive by email — those are programs, not documents, and a common scam delivery."
        ],
        remember: "Downloads is the front step. Documents is the filing cabinet. Save with real names, find with Recent or Search."
      },
      videos: [
              {
                      "title": "Windows Basics: Finding Files on Your Computer",
                      "by": "GCFLearnFree",
                      "mins": "3:11",
                      "url": "https://www.youtube.com/watch?v=GtGVItw89NM"
              },
              {
                      "title": "Word 2013: Saving and Sharing Documents",
                      "by": "GCFLearnFree",
                      "mins": "3:59",
                      "url": "https://www.youtube.com/watch?v=QZhgurTl6V0"
              }
      ]
    },
    {
      n: 8, slug: "video-calls", icon: "📹", title: "Video calls with family",
      tagline: "Seeing the grandkids — FaceTime, WhatsApp, and Zoom made calm.",
      minutes: "15 minutes of a visit (do a real practice call)",
      coach: {
        goals: [
          "Client can ANSWER a video call confidently (the green button, camera on)",
          "Client can START a call to one favourite contact in the app their family actually uses",
          "Client knows the three checks if it goes wrong: volume up, camera not covered, Wi-Fi on",
          "Client has one contact starred/favourited so starting takes two taps"
        ],
        say: "Teach by doing: make a real call together — you step into the hallway with your phone and call them. Practise answering first (that's the scary direction), then starting one. Say the quiet part out loud: “You will not break the call. The worst button hangs up, and we just call back.”",
        watchFor: [
          "Camera covered by a case edge or finger — the classic 'I can hear you but you're black'",
          "Volume at zero or sound coming from the wrong place — show the volume buttons mid-call",
          "App confusion: family on WhatsApp while client opens FaceTime — pick ONE app as 'our family app' and put it on the home screen",
          "Holding the phone too close/low — a stack of books as a stand transforms the experience"
        ],
        teachBack: [
          "“I'm calling you — show me how you answer.” (do it live)",
          "“Now you call me back.”",
          "“Your granddaughter can't hear you. What do you check first?” (volume, then mute button)"
        ],
        stopWhen: "If calls consistently fail (weak Wi-Fi corner of the house, ancient device), make a note for a Wi-Fi/device check rather than drilling an app that can't succeed here."
      },
      panel: { kind: "videocall" },
      handout: {
        intro: "A video call is a phone call with a window. You talk the same way — the only new parts are answering with the camera on, and knowing three little checks if something's off.",
        steps: [
          { h: "Answering a call", p: "When the phone rings with a video call, tap the GREEN button (or “Accept”). Hold the phone at arm's length, a little above your eyes. Smile — you're on TV. Talk normally." },
          { h: "Starting a call — FaceTime (iPhone/iPad)", p: "Open FaceTime, tap the + or New FaceTime, type the person's name, tap their name, then tap the video camera picture. That's it." },
          { h: "Starting a call — WhatsApp (any phone)", p: "Open WhatsApp, tap Chats, tap the person's name, then tap the VIDEO CAMERA picture at the top. (The phone picture beside it is voice-only.)" },
          { h: "Starting a call — Zoom", p: "You usually don't start Zoom calls — family sends you a link by email or text. At the agreed time, tap the link and then “Join”. If it asks, allow the camera and microphone. That's the only tricky part, and it's a one-tap answer." },
          { h: "If they can't hear you", p: "Check the microphone picture on screen — if it has a line through it, tap it once (you were muted). Turn the volume UP with the side buttons. Speak toward the bottom of the phone." },
          { h: "If you can't see them (or they can't see you)", p: "Is a finger or the case covering the little camera dot at the top? Is the camera picture on screen crossed out? Tap it once. Still dark? End the call and start again — that fixes most things." },
          { h: "Ending the call", p: "Tap the RED button. Then say goodbye out loud anyway — someone always forgets to hang up, and it's never a problem." }
        ],
        tips: [
          "Prop the phone against books at eye level — your arms get tired and the picture steadies.",
          "Sit facing a window or lamp. Light on your face means family can actually see you.",
          "One family app is enough. Put it on the first home screen, big and easy to tap."
        ],
        remember: "Green answers, red ends. Can't hear: volume and mute. Can't see: camera covered. When stuck, hang up and call back."
      },
      videos: [
              {
                      "title": "How to Make Video Calls",
                      "by": "WhatsApp (official)",
                      "mins": "",
                      "url": "https://www.youtube.com/watch?v=QkvlYq9TazU"
              }
      ]
    },
    {
      n: 9, slug: "photos", icon: "📸", title: "Photos: take, find, share, keep",
      tagline: "Your camera roll, your albums, and copies that keep photos safe.",
      minutes: "15 minutes of a visit",
      coach: {
        goals: [
          "Client can take a photo and find it again in the Photos app",
          "Client can share one photo with a family member (text or email)",
          "Client understands photos should live in TWO places, and backup is switched on",
          "Client can delete a blurry duplicate — and knows deleted photos wait 30 days"
        ],
        say: "The shoebox analogy lands: “Your phone is a shoebox of photos that never gets full in a drawer — but a shoebox can be lost. So we keep a second shoebox (the cloud backup) that fills itself. You never carry it; it's just there if the phone is lost.” Verify backup status on-device during the visit — it's the highest-value 2 minutes in this module.",
        watchFor: [
          "Backup OFF or stalled on a full free tier — check iCloud/Google storage and explain the small monthly cost if they're out of space",
          "Photos living only in text-message threads (hard to find, easy to lose) — teach saving to Photos",
          "Storage-full warnings ignored for months — clear the biggest videos/duplicates together",
          "Sharing to the wrong person in a hurry — slow down at the name-check step, always"
        ],
        teachBack: [
          "“Take a photo of the garden, then find it and show me.”",
          "“Send that photo to your son.”",
          "“If your phone fell in the lake tomorrow, tell me why your photos would still be okay.”"
        ],
        stopWhen: "If the photo library holds the only copies of precious family photos AND backup is off or failing, treat turning it on as the visit's top priority and confirm it starts uploading before you leave (on Wi-Fi)."
      },
      panel: { kind: "backup" },
      handout: {
        intro: "Your phone's camera is wonderful — and its photos deserve a safety copy. This lesson covers taking, finding, sharing, and the automatic backup that protects them all.",
        steps: [
          { h: "Take a photo", p: "Open Camera. Point at your subject, tap the person or thing on screen to focus, then tap the big round button. Hold still for one breath after the click." },
          { h: "Find your photos", p: "Open Photos (iPhone: the colourful flower; Android: the colourful pinwheel). Newest photos are at the bottom or top — tap one to see it big. Pinch or double-tap to zoom in." },
          { h: "Share a photo", p: "With the photo open, tap Share (square with an arrow). Choose Messages or Mail, pick the person — READ THE NAME before sending — write a line if you like, and send." },
          { h: "Delete a photo", p: "Open it, tap the trash can, confirm. Deleted photos sit in “Recently Deleted” for 30 days before vanishing — so a mistake isn't a disaster. Go there to undo a delete." },
          { h: "Turn on automatic backup — iPhone", p: "Settings → tap your name at the top → iCloud → Photos → turn ON “iCloud Photos”. Photos copy themselves whenever you're on Wi-Fi." },
          { h: "Turn on automatic backup — Android", p: "Open Google Photos → tap your picture (top corner) → Photos settings → Backup → turn ON. Same idea: copies make themselves on Wi-Fi." }
        ],
        tips: [
          "Two copies rule: photos on the phone + photos in the backup = safe. One copy is luck, not a plan.",
          "The free backup space fills up after a few years of photos. A small monthly plan (often $1–$3) is normal — ask us before paying anything if you're unsure it's genuine.",
          "Favourite your best shots with the heart ♥ — they gather in a Favourites album, easy to show visitors."
        ],
        remember: "Photos app to find them, Share to send them, backup ON to keep them. Check the name before you send."
      },
      videos: [
              {
                      "title": "How to Use Google Photos (Beginner's Guide)",
                      "by": "",
                      "mins": "about 8 min",
                      "url": "https://www.youtube.com/watch?v=LruVDHMFIok"
              },
              {
                      "title": "Back Up Phone Photos Before You Lose Them — iPhone & Android",
                      "by": "Tech Without the Headache",
                      "mins": "",
                      "url": "https://www.youtube.com/watch?v=bYo2Z4H-8DY"
              }
      ]
    },
    {
      n: 10, slug: "internet-basics", icon: "🌐", title: "Internet basics & safe browsing",
      tagline: "Wi-Fi, the browser, searching — and spotting a fake website.",
      minutes: "15–20 minutes of a visit",
      coach: {
        goals: [
          "Client can tell whether they're on Wi-Fi and reconnect to their home network",
          "Client can open the browser, type a website address or a search, and get where they meant to go",
          "Client can read a web address like a street sign: real name first, padlock on, spelling exact",
          "Client knows: if a page demands urgent payment or a password “right now”, close the tab and call for help"
        ],
        say: "Explain Wi-Fi as radio: “Wi-Fi is invisible radio between your device and the little router box. No radio bars means no road to the internet — apps will look broken when they're really just disconnected.” For addresses: “The real name of a website is the part right before .ca or .com — read addresses right-to-left at the dots, like a street address.”",
        watchFor: [
          "Address vs search confusion — typing full questions into the address bar is fine in modern browsers; reassure, don't correct harshly",
          "Look-alike addresses in texts/emails (rbc-secure-login.xyz) — tie back to Module 4: never arrive at banking via a link",
          "Browser warning pages ('Your connection is not private') — teach STOP, don't teach the 'proceed anyway' button",
          "Dozens of stale tabs and pop-up tabs from ads — show Close All and the X on tabs; install nothing offered by a web page"
        ],
        teachBack: [
          "“Show me if you're on Wi-Fi right now, and which network is yours.”",
          "“Find tomorrow's weather in Calgary using a search.”",
          "“Read this address to me — is it really your bank? How do you know?”"
        ],
        stopWhen: "If the home Wi-Fi itself is broken (router lights wrong, no device connects), that's an infrastructure fix, not a lesson — log it and, if the ISP is the issue, offer the 'we call them together' service."
      },
      panel: { kind: "urlcheck" },
      handout: {
        intro: "The internet reaches your home through Wi-Fi — invisible radio from a little router box. Your browser (Safari, Chrome, or Edge) is the car you drive on it. Here's how to drive safely.",
        steps: [
          { h: "Check your Wi-Fi", p: "Look for the fan-shaped Wi-Fi symbol at the top of the screen. No symbol (or an X) means no connection. To reconnect: open Settings → Wi-Fi → tap YOUR home network's name. The password is often on a sticker on the router." },
          { h: "Open the browser and go somewhere", p: "Tap Safari, Chrome, or Edge. Tap the address bar at the top, type where you want to go — like cbc.ca — and tap Go/Enter. The page loads in a few seconds." },
          { h: "Searching instead", p: "Don't know the address? Type plain words in the same bar — “Calgary weather tomorrow” — and tap Go. Results appear as a list; the top results are often ads (labelled “Ad” or “Sponsored”). Scroll past them to the real results." },
          { h: "Read a web address like a street sign", p: "The real owner's name sits right before .ca or .com. yourbank.ca is the bank. yourbank-secure-login.xyz is NOT — it's a stranger renting a similar sign. Check spelling letter by letter; scammers swap one letter." },
          { h: "The padlock", p: "A small padlock 🔒 beside the address means the connection is private. No padlock on a page asking for passwords or payment? Leave. (A padlock alone doesn't prove a site is honest — the name check matters more.)" },
          { h: "If a page scares you — close it", p: "“Your computer is infected!”, “You won!”, “Pay now or else” — close the tab (the X on the tab) or close the browser entirely. Real problems never arrive as shouting web pages. If it keeps coming back, tell us." }
        ],
        tips: [
          "Bookmark your bank, email, and news (star ☆ or “Add Bookmark”) — bookmarks always take you to the real address, never a fake.",
          "Type your bank's address yourself or use its official app. Never arrive at banking through a text or email link.",
          "Public Wi-Fi (coffee shops, airports) is fine for news and maps — save banking for home."
        ],
        remember: "Check the fan, read the name before .ca, look for the padlock, and close anything that shouts."
      },
      videos: [
              {
                      "title": "Computer Basics: Connecting to the Internet",
                      "by": "GCFGlobal",
                      "mins": "about 4 min",
                      "url": "https://www.youtube.com/watch?v=93-3zmVvCGU"
              },
              {
                      "title": "Internet Safety: Your Browser's Security Features",
                      "by": "GCFGlobal / GCFLearnFree",
                      "mins": "",
                      "url": "https://www.youtube.com/watch?v=2ZZQlgV2Gus"
              }
      ]
    }
  ]
};
